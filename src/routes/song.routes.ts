import { Router, Request, Response } from 'express';
import { getSongMetadata, enqueueDownload, createSong } from '../controllers/song.controller';
import Song from '../models/Song';
import mongoose from 'mongoose';
import { GridFSBucket, ObjectId } from 'mongodb';
import { searchYouTube, getVideoDetails } from '../services/youtube.service';
import redisClient from '../config/redis';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const router = Router();

// ─── Cookie Setup ─────────────────────────────────────────────────────────────
// Write YouTube cookies from base64 env var to a temp file on startup.
// This allows yt-dlp to authenticate as a real browser session.
const COOKIE_PATH = '/tmp/youtube-cookies.txt';

function ensureCookieFile(): boolean {
  const b64 = process.env.YT_COOKIES_BASE64;
  if (!b64) {
    console.warn('[Cookies] YT_COOKIES_BASE64 not set — yt-dlp may be blocked by YouTube');
    return false;
  }
  try {
    fs.writeFileSync(COOKIE_PATH, Buffer.from(b64, 'base64').toString('utf-8'));
    console.log('[Cookies] YouTube cookie file written to', COOKIE_PATH);
    return true;
  } catch (e) {
    console.error('[Cookies] Failed to write cookie file:', e);
    return false;
  }
}

const hasCookies = ensureCookieFile();

// ─── Helper: extract stream URL via yt-dlp CLI ───────────────────────────────
function getStreamUrl(videoId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const cookieFlag = hasCookies ? `--cookies ${COOKIE_PATH}` : '';

    const command = [
      'yt-dlp',
      cookieFlag,
      '-f "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/b[protocol!*=m3u8]"',
      '-g',                    // --get-url: just print the URL, don't download
      '--no-check-certificates',
      '--no-warnings',
      '--force-ipv4',
      `"${ytUrl}"`,
    ].filter(Boolean).join(' ');

    console.log(`[yt-dlp] Executing: ${command}`);
    exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[yt-dlp] Error for ${videoId}:`, error.message);
        console.error(`[yt-dlp] stderr: ${stderr}`);
        return reject(new Error(stderr || error.message));
      }
      const url = stdout.trim().split('\n')[0]; // first line is the URL
      console.log(`[yt-dlp] Successfully extracted URL for ${videoId}`);
      if (!url || !url.startsWith('http')) {
        return reject(new Error('yt-dlp returned invalid URL'));
      }
      resolve(url);
    });
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * YouTube search — uses YouTube Data API v3
 */
router.get('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      res.json([]);
      return;
    }

    const results = await searchYouTube(q.trim(), 20);

    // Enrich with local knot data
    const youtubeIds = results.map((r) => r.youtube_id);
    const localSongs = await Song.find({ youtube_id: { $in: youtubeIds } });
    const localMap = new Map(localSongs.map((s) => [s.youtube_id, s]));

    const enriched = results.map((r) => {
      const local = localMap.get(r.youtube_id);
      return {
        ...r,
        has_knots: !!local && local.nodes.length > 0,
        play_count: local?.play_count || 0,
        local_id: local?._id || null,
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error('[Search] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Get stream URL for a YouTube video via yt-dlp CLI.
 * Caches in Redis for 4 hours (YouTube URLs expire ~6h).
 */
router.get('/:id/stream-url', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  console.log(`[Backend] Requesting stream URL for video: ${id}`);
  try {
    const cacheKey = `stream:${id}`;

    // Check Redis cache first
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        console.log(`[Stream] Cache hit for ${id}`);
        res.json({ streamUrl: cached, cached: true });
        return;
      }
    } catch (e) {
      // Redis might be down, continue without cache
    }

    const streamUrl = await getStreamUrl(id);

    // Cache in Redis for 4 hours
    try {
      await redisClient.setex(cacheKey, 4 * 60 * 60, streamUrl);
    } catch (e) {
      // Ignore Redis errors
    }

    // Also ensure song exists in our DB
    const existing = await Song.findOne({ youtube_id: id as string });
    if (!existing) {
      const details = await getVideoDetails(id as string);
      if (details) {
        await Song.create({
          youtube_id: id as string,
          title: details.title,
          artist: details.artist,
          thumbnail: details.thumbnail,
          duration_ms: details.duration_ms,
        });
      }
    }

    res.json({ streamUrl, cached: false });
  } catch (error) {
    console.error('[Stream URL] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * HTTP audio proxy — fetches the direct YouTube URL via yt-dlp, then proxies
 * the actual HTTP audio through the backend using Node's native http modules.
 * This ensures:
 * 1. No IP-locking (request comes from server IP)
 * 2. Proper Content-Length / Accept-Ranges headers for TrackPlayer/ExoPlayer
 * 3. Seek support via Range header forwarding
 */
router.get('/:id/stream', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  console.log(`[Stream] Proxying audio for video: ${id}`);

  try {
    // Step 1: Get the direct audio URL (from cache or yt-dlp)
    const cacheKey = `stream:${id}`;
    let audioUrl: string | null = null;

    try {
      audioUrl = await redisClient.get(cacheKey);
      if (audioUrl) console.log(`[Stream] Cache hit for ${id}`);
    } catch (e) {
      // Redis down, continue
    }

    if (!audioUrl) {
      audioUrl = await getStreamUrl(id);
      console.log(`[Stream] Got fresh URL for ${id}, length=${audioUrl.length}`);
      try {
        await redisClient.setex(cacheKey, 4 * 60 * 60, audioUrl);
      } catch (e) { /* ignore */ }
    }

    // Step 2: Proxy the HTTP request using Node's native modules
    proxyAudioUrl(audioUrl, req, res, async () => {
      // On failure (expired URL), clear cache and retry once
      console.log(`[Stream] URL expired for ${id}, retrying...`);
      try { await redisClient.del(cacheKey); } catch (e) { /* ignore */ }
      const freshUrl = await getStreamUrl(id);
      try { await redisClient.setex(cacheKey, 4 * 60 * 60, freshUrl); } catch (e) { /* ignore */ }
      proxyAudioUrl(freshUrl, req, res);
    });
  } catch (error) {
    console.error('[Stream] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: (error as Error).message });
    }
  }
});

/**
 * Proxy an audio URL to the Express response using Node's native http/https modules.
 * Forwards Range headers for seeking. Calls onRetry() if the upstream returns 403.
 */
function proxyAudioUrl(
  url: string,
  req: Request,
  res: Response,
  onRetry?: () => void
) {
  const mod = url.startsWith('https') ? require('https') : require('http');
  const parsedUrl = new URL(url);

  const options: any = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  };

  // Forward Range header for seeking
  if (req.headers.range) {
    options.headers['Range'] = req.headers.range;
    console.log(`[Stream] Forwarding Range: ${req.headers.range}`);
  }

  const proxyReq = mod.request(options, (upstream: any) => {
    console.log(`[Stream] Upstream status: ${upstream.statusCode}, content-type: ${upstream.headers['content-type']}, content-length: ${upstream.headers['content-length']}`);

    if (upstream.statusCode === 403 && onRetry) {
      upstream.resume(); // drain the response
      onRetry();
      return;
    }

    // Forward status and headers
    res.status(upstream.statusCode || 200);

    const forward = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forward) {
      if (upstream.headers[h]) {
        res.setHeader(h, upstream.headers[h]);
      }
    }

    // Pipe the upstream Node.js stream directly to Express response
    upstream.pipe(res);

    upstream.on('error', (err: Error) => {
      console.error('[Stream] Upstream read error:', err.message);
      if (!res.destroyed) res.end();
    });
  });

  proxyReq.on('error', (err: Error) => {
    console.error('[Stream] Proxy request error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to connect to audio source' });
    }
  });

  req.on('close', () => {
    proxyReq.destroy();
  });

  proxyReq.end();
}


/**
 * Get video details / ensure song in DB
 */
router.get('/:id/details', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    // Check local DB first
    let song = await Song.findOne({ youtube_id: id });
    if (song) {
      res.json(song);
      return;
    }

    // Fetch from YouTube
    const details = await getVideoDetails(id as string);
    if (!details) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    song = await Song.create({
      youtube_id: id as string,
      title: details.title,
      artist: details.artist,
      thumbnail: details.thumbnail,
      duration_ms: details.duration_ms,
    });

    res.json(song);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Download a GridFS-stored audio file
 */
router.get('/downloads/:gridfs_id', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!mongoose.connection.db) {
      res.status(500).json({ error: 'DB not connected' });
      return;
    }

    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'audio_buffers',
    });

    const downloadStream = bucket.openDownloadStream(new ObjectId(req.params.gridfs_id as string));

    res.set('Content-Type', 'application/octet-stream');
    downloadStream.pipe(res);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Trending songs (by play count)
 */
router.get('/trending', async (req: Request, res: Response): Promise<void> => {
  try {
    const songs = await Song.find().sort({ play_count: -1 }).limit(20);
    res.json(songs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Home feed — recently added + popular
 */
router.get('/feed', async (req: Request, res: Response): Promise<void> => {
  try {
    const recentlyAdded = await Song.find().sort({ createdAt: -1 }).limit(10);
    const popular = await Song.find().sort({ play_count: -1 }).limit(10);
    res.json({ recentlyAdded, popular });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Increment play count
 */
router.post('/:id/play', async (req: Request, res: Response): Promise<void> => {
  try {
    const song = await Song.findOneAndUpdate(
      { youtube_id: req.params.id },
      { $inc: { play_count: 1 } },
      { new: true }
    );
    if (!song) {
      res.status(404).json({ error: 'Song not found' });
      return;
    }
    res.json({ play_count: song.play_count });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/', createSong);
router.get('/:id', getSongMetadata);
router.post('/:id/download', enqueueDownload);

export default router;
