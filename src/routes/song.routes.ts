import { Router, Request, Response } from 'express';
import { getSongMetadata, enqueueDownload, syncLocalKnot, getLocalKnot } from '../controllers/song.controller';
import Song from '../models/Song';
import mongoose from 'mongoose';
import { GridFSBucket, ObjectId } from 'mongodb';
import { searchYouTube, getVideoDetails, getStreamUrl } from '../services/youtube.service';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const router = Router();

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

const IN_MEMORY_CACHE = new Map<string, { url: string, expires: number }>();

/**
 * Get stream URL for a YouTube video.
 * REPLACED REDIS: Now uses ONLY in-memory cache to stay under Upstash limits.
 */
router.get('/:id/stream-url', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const clientStreamUrl = req.query.stream_url as string;
  
  console.log(`[Backend] Requesting stream URL for video: ${id}`);
  
  try {
    // If client already provided a URL, use it and don't call YouTube!
    if (clientStreamUrl && clientStreamUrl.startsWith('http')) {
      console.log(`[Stream] Using client-provided URL for ${id}`);
      res.json({ streamUrl: clientStreamUrl, cached: false, source: 'client' });
      return;
    }

    const cacheKey = `stream:${id}`;

    // Check in-memory cache
    const memCache = IN_MEMORY_CACHE.get(cacheKey);
    if (memCache && memCache.expires > Date.now()) {
      console.log(`[Stream] In-memory cache hit for ${id}`);
      res.json({ streamUrl: memCache.url, cached: true });
      return;
    }

    const streamUrl = await getStreamUrl(id);

    // Save to in-memory cache
    IN_MEMORY_CACHE.set(cacheKey, { url: streamUrl, expires: Date.now() + 4 * 60 * 60 * 1000 });

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
 * HTTP audio proxy.
 * REPLACED REDIS: Redis calls removed to avoid request limit errors.
 */
router.get('/:id/stream', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const clientStreamUrl = req.query.stream_url as string;
  
  console.log(`[Stream] Proxying audio for video: ${id}`);

  try {
    let audioUrl: string | null = null;

    // 1. Check client-provided URL first
    if (clientStreamUrl && clientStreamUrl.startsWith('http')) {
        audioUrl = clientStreamUrl;
        console.log(`[Stream] Proxying client-provided URL for ${id}`);
    }

    // 2. Check in-memory cache
    if (!audioUrl) {
      const cacheKey = `stream:${id}`;
      const memCache = IN_MEMORY_CACHE.get(cacheKey);
      if (memCache && memCache.expires > Date.now()) {
        audioUrl = memCache.url;
        console.log(`[Stream] In-memory cache hit for ${id}`);
      }
    }

    // 3. Fallback to fresh lookup
    if (!audioUrl) {
      audioUrl = await getStreamUrl(id);
      console.log(`[Stream] Got fresh URL for ${id}`);
      IN_MEMORY_CACHE.set(`stream:${id}`, { url: audioUrl, expires: Date.now() + 4 * 60 * 60 * 1000 });
    }

    // Proxy the HTTP request
    proxyAudioUrl(audioUrl, req, res, async () => {
      console.log(`[Stream] URL expired for ${id}, retrying...`);
      IN_MEMORY_CACHE.delete(`stream:${id}`);
      const freshUrl = await getStreamUrl(id);
      IN_MEMORY_CACHE.set(`stream:${id}`, { url: freshUrl, expires: Date.now() + 4 * 60 * 60 * 1000 });
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
 * Proxy an audio URL to the Express response
 */
function proxyAudioUrl(
  url: string,
  req: Request,
  res: Response,
  onRetry?: () => void,
  redirectCount: number = 0
) {
  if (redirectCount > 3) {
    res.status(502).json({ error: 'Too many redirects' });
    return;
  }

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

  if (req.headers.range) {
    options.headers['Range'] = req.headers.range;
  }

  const proxyReq = mod.request(options, (upstream: any) => {
    const statusCode = upstream.statusCode || 200;
    const contentType = upstream.headers['content-type'] || '';
    
    if ([301, 302, 307, 308].includes(statusCode) && upstream.headers.location) {
      upstream.resume();
      proxyAudioUrl(upstream.headers.location, req, res, onRetry, redirectCount + 1);
      return;
    }

    if ((statusCode === 403 || contentType.includes('text/html')) && onRetry) {
      upstream.resume();
      onRetry();
      return;
    }

    res.status(statusCode);
    const forward = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forward) {
      if (upstream.headers[h]) {
        res.setHeader(h, upstream.headers[h]);
      }
    }
    upstream.pipe(res);
  });

  proxyReq.on('error', (err: Error) => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to connect to audio source' });
    }
  });

  req.on('close', () => {
    proxyReq.destroy();
  });

  proxyReq.end();
}

router.get('/:id/details', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    let song = await Song.findOne({ youtube_id: id });
    if (song) {
      res.json(song);
      return;
    }
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

router.get('/downloads/:gridfs_id', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!mongoose.connection.db) {
      res.status(500).json({ error: 'DB not connected' });
      return;
    }
    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'audio_buffers' });
    const downloadStream = bucket.openDownloadStream(new ObjectId(req.params.gridfs_id as string));
    res.set('Content-Type', 'application/octet-stream');
    downloadStream.pipe(res);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/trending', async (req: Request, res: Response): Promise<void> => {
  try {
    const songs = await Song.find().sort({ play_count: -1 }).limit(20);
    res.json(songs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/feed', async (req: Request, res: Response): Promise<void> => {
  try {
    const recentlyAdded = await Song.find().sort({ createdAt: -1 }).limit(10);
    const popular = await Song.find().sort({ play_count: -1 }).limit(10);
    const knottedSongs = await Song.find({ 'nodes.0': { $exists: true } }).sort({ updatedAt: -1 }).limit(10);
    res.json({ recentlyAdded, popular, knottedSongs });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/knotted', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    const filter: any = { 'nodes.0': { $exists: true } };
    if (q && q.trim().length > 0) {
      filter.$or = [
        { title: { $regex: q.trim(), $options: 'i' } },
        { artist: { $regex: q.trim(), $options: 'i' } },
      ];
    }
    const songs = await Song.find(filter).sort({ updatedAt: -1 }).limit(50);
    res.json(songs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

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

router.get('/local/all-knotted', async (_req: Request, res: Response): Promise<void> => {
  try {
    const songs = await Song.find({ source: 'local', 'nodes.0': { $exists: true } });
    res.json(songs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/local/sync', syncLocalKnot);
router.get('/local/:local_id', getLocalKnot);
router.get('/:id', getSongMetadata);
router.post('/:id/download', enqueueDownload);

export default router;
