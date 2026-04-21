import { Router, Request, Response } from 'express';
import { getSongMetadata, enqueueDownload, createSong } from '../controllers/song.controller';
import Song from '../models/Song';
import mongoose from 'mongoose';
import { GridFSBucket, ObjectId } from 'mongodb';
import { searchYouTube, getVideoDetails } from '../services/youtube.service';
import redisClient from '../config/redis';
import { exec } from 'child_process';
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
      '-f bestaudio',
      '-g',                    // --get-url: just print the URL, don't download
      '--no-check-certificates',
      '--no-warnings',
      '--force-ipv4',
      `"${ytUrl}"`,
    ].filter(Boolean).join(' ');

    exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[yt-dlp] stderr: ${stderr}`);
        return reject(new Error(stderr || error.message));
      }
      const url = stdout.trim().split('\n')[0]; // first line is the URL
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
  try {
    const id = req.params.id as string;
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
    console.error('[Stream] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

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
