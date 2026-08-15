import { Router, Request, Response } from 'express';
import { getSongMetadata, enqueueDownload, syncLocalKnot, getLocalKnot } from '../controllers/song.controller';
import { protect, AuthRequest } from '../middleware/auth';
import Song from '../models/Song';
import mongoose from 'mongoose';
import { GridFSBucket, ObjectId } from 'mongodb';
import { storageDBConnection } from '../config/db';
import { searchYouTube, getVideoDetails, getStreamUrl } from '../services/youtube.service';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PagalworldService } from '../services/pagalworld.service';
import { PagalfreeService } from '../services/pagalfree.service';
import { JiosaavnService } from '../services/jiosaavn.service';
import { LyricsService } from '../services/lyrics.service';
import { streamPagalworld, streamPagalfree, streamJiosaavn } from '../controllers/stream.controller';


const router = Router();

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * Pagalworld search
 */
router.get('/pagalworld/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      res.json([]);
      return;
    }
    console.log(`[Pagalworld Search] Query: "${q}"`);
    const results = await PagalworldService.searchSongs(q.trim());
    console.log(`[Pagalworld Search] Found ${results.length} results`);
    res.json(results);
  } catch (error) {
    console.error('[Pagalworld Search] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Pagalworld metadata extraction
 */
router.get('/pagalworld/metadata', async (req: Request, res: Response): Promise<void> => {
  try {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: 'URL is required' });
      return;
    }
    const metadata = await PagalworldService.getSongMetadata(url);
    if (!metadata) {
      res.status(404).json({ error: 'Metadata not found' });
      return;
    }
    res.json(metadata);
  } catch (error) {
    console.error('[Pagalworld Metadata] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Pagalfree search
 */
router.get('/pagalfree/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      res.json([]);
      return;
    }
    console.log(`[Pagalfree Search] Query: "${q}"`);
    const results = await PagalfreeService.searchSongs(q.trim());
    console.log(`[Pagalfree Search] Found ${results.length} results`);
    res.json(results);
  } catch (error) {
    console.error('[Pagalfree Search] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Pagalfree metadata extraction
 */
router.get('/pagalfree/metadata', async (req: Request, res: Response): Promise<void> => {
  try {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: 'URL is required' });
      return;
    }
    const metadata = await PagalfreeService.getSongMetadata(url);
    if (!metadata) {
      res.status(404).json({ error: 'Metadata not found' });
      return;
    }
    res.json(metadata);
  } catch (error) {
    console.error('[Pagalfree Metadata] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Pagalworld audio proxy
 */
router.get('/pagalworld/stream', streamPagalworld);

/**
 * Pagalfree audio proxy
 */
router.get('/pagalfree/stream', streamPagalfree);

/**
 * JioSaavn search
 */
router.get('/jiosaavn/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      res.json([]);
      return;
    }
    console.log(`[JioSaavn Search] Query: "${q}"`);
    const results = await JiosaavnService.searchSongs(q.trim());
    console.log(`[JioSaavn Search] Found ${results.length} results`);
    res.json(results);
  } catch (error) {
    console.error('[JioSaavn Search] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * JioSaavn combined search — songs, albums, artists, top result in one call
 */
router.get('/jiosaavn/search/all', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      res.json({ topQuery: null, songs: [], albums: [], artists: [] });
      return;
    }
    console.log(`[JioSaavn SearchAll] Query: "${q}"`);
    const results = await JiosaavnService.searchAll(q.trim());
    console.log(`[JioSaavn SearchAll] songs=${results.songs.length} albums=${results.albums.length} artists=${results.artists.length}`);
    res.json(results);
  } catch (error) {
    console.error('[JioSaavn SearchAll] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * JioSaavn album search (paginated) — movie soundtracks are albums
 */
router.get('/jiosaavn/search/albums', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      res.json([]);
      return;
    }
    const page = parseInt(req.query.page as string) || 1;
    const results = await JiosaavnService.searchAlbums(q.trim(), page);
    res.json(results);
  } catch (error) {
    console.error('[JioSaavn Album Search] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * JioSaavn artist search (paginated)
 */
router.get('/jiosaavn/search/artists', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      res.json([]);
      return;
    }
    const page = parseInt(req.query.page as string) || 1;
    const results = await JiosaavnService.searchArtists(q.trim(), page);
    res.json(results);
  } catch (error) {
    console.error('[JioSaavn Artist Search] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * JioSaavn album details — full track list
 */
router.get('/jiosaavn/album', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }
    const album = await JiosaavnService.getAlbumDetails(token);
    if (!album) {
      res.status(404).json({ error: 'Album not found' });
      return;
    }
    res.json(album);
  } catch (error) {
    console.error('[JioSaavn Album] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * JioSaavn artist details — top songs, albums, singles
 */
router.get('/jiosaavn/artist', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }
    const songCount = parseInt(req.query.songs as string) || 20;
    const albumCount = parseInt(req.query.albums as string) || 10;
    const artist = await JiosaavnService.getArtistDetails(token, songCount, albumCount);
    if (!artist) {
      res.status(404).json({ error: 'Artist not found' });
      return;
    }
    res.json(artist);
  } catch (error) {
    console.error('[JioSaavn Artist] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * JioSaavn metadata extraction
 */
router.get('/jiosaavn/metadata', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }
    const metadata = await JiosaavnService.getSongMetadata(token);
    if (!metadata) {
      res.status(404).json({ error: 'Metadata not found' });
      return;
    }
    res.json(metadata);
  } catch (error) {
    console.error('[JioSaavn Metadata] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * JioSaavn audio proxy
 */
router.get('/jiosaavn/stream', streamJiosaavn);

/**
 * Robust Synced Lyrics Resolver
 */
router.get('/lyrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const { youtube_id, jiosaavn_token, title, artist, duration_ms, lang } = req.query;
    
    console.log(`[Backend Lyrics] Requesting lyrics for: youtube_id=${youtube_id}, jiosaavn_token=${jiosaavn_token}, title=${title}, artist=${artist}, lang=${lang}`);
    
    const lyrics = await LyricsService.resolveLyrics({
      youtube_id: youtube_id as string || undefined,
      jiosaavn_token: jiosaavn_token as string || undefined,
      title: title as string || undefined,
      artist: artist as string || undefined,
      duration_ms: duration_ms ? parseInt(duration_ms as string, 10) : undefined,
      lang: lang as string || undefined,
    });
    
    res.json(lyrics);
  } catch (error) {
    console.error('[Backend Lyrics] Error resolving lyrics:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});


/**
 * YouTube download URL - Returns direct download link for YouTube audio
 */
router.get('/youtube/download', async (req: Request, res: Response): Promise<void> => {
  try {
    const youtube_id = req.query.youtube_id as string;
    if (!youtube_id) {
      res.status(400).json({ error: 'youtube_id is required' });
      return;
    }

    console.log(`[YouTube Download] Getting download URL for: ${youtube_id}`);
    
    // Get the stream URL (this is the direct audio URL)
    const streamUrl = await getStreamUrl(youtube_id);
    
    res.json({ 
      downloadUrl: streamUrl,
      youtube_id: youtube_id
    });
  } catch (error) {
    console.error('[YouTube Download] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

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

    // --- PRE-WARM CACHE (Background) ---
    // Only pre-warm the top 3 results to avoid hitting rate limits too fast
    const top3 = results.slice(0, 3);
    setTimeout(async () => {
      console.log(`[Backend] Pre-warming stream cache for top 3 search results...`);
      for (const r of top3) {
        try {
          const cacheKey = `stream:${r.youtube_id}`;
          if (!IN_MEMORY_CACHE.has(cacheKey) || IN_MEMORY_CACHE.get(cacheKey)!.expires < Date.now()) {
            const url = await getStreamUrl(r.youtube_id);
            IN_MEMORY_CACHE.set(cacheKey, { url, expires: Date.now() + 2 * 60 * 60 * 1000 });
            console.log(`[Pre-warm] Cached ${r.youtube_id}`);
          }
        } catch (e) {
          // Ignore pre-warm failures
        }
      }
    }, 500);
  } catch (error) {
    console.error('[Search] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

const IN_MEMORY_CACHE = new Map<string, { url: string, expires: number }>();

/**
 * Repair artwork omitted by older client syncs. The existing provider-specific
 * ID is never changed, so metadata cannot be applied to another song.
 */
async function backfillMissingArtwork(song: InstanceType<typeof Song>): Promise<void> {
  if (song.thumbnail) return;

  let thumbnail = '';
  if (song.source === 'youtube' && song.youtube_id) {
    thumbnail = `https://i.ytimg.com/vi/${song.youtube_id}/hqdefault.jpg`;
  } else if (song.source === 'jiosaavn' && song.jiosaavn_token) {
    const metadata = await JiosaavnService.getSongMetadata(song.jiosaavn_token);
    thumbnail = metadata?.imageUrl || '';
  } else if (song.source === 'pagalfree' && song.pagalfree_url) {
    const metadata = await PagalfreeService.getSongMetadata(song.pagalfree_url);
    thumbnail = metadata?.imageUrl || '';
  }

  if (thumbnail) {
    song.thumbnail = thumbnail;
    await song.save();
  }
}

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

function extractYoutubeId(input: string): string | null {
  if (!input) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (match && match[1]) return match[1];
  return null;
}

/**
 * HTTP audio proxy.
 * REPLACED REDIS: Redis calls removed to avoid request limit errors.
 */
router.get('/:id/stream', async (req: Request, res: Response): Promise<void> => {
  const rawId = req.params.id as string;
  const id = extractYoutubeId(rawId) || rawId;
  const clientStreamUrl = req.query.stream_url as string;
  
  console.log(`[Stream] Proxying audio for video: ${id} (raw: ${rawId})`);

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
      'Accept': '*/*',
      'Connection': 'keep-alive',
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');

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
    const dbInstance = (storageDBConnection && storageDBConnection.db) ? storageDBConnection.db : mongoose.connection.db;
    if (!dbInstance) {
      res.status(500).json({ error: 'DB not connected' });
      return;
    }
    const bucket = new GridFSBucket(dbInstance, { bucketName: 'audio_buffers' });
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

// ─── Authenticated Knot Sync ──────────────────────────────────────────────────

/**
 * Sync knots from client (localStorage / AsyncStorage) to the server.
 * Accepts an array of knot entries, each tied to a specific source key.
 * Upserts the Song document and stores per-user knot data.
 */
router.post('/sync-knots', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { knots } = req.body;
    if (!Array.isArray(knots)) {
      res.status(400).json({ error: 'knots array is required' });
      return;
    }

    let synced = 0;
    const userObjId = new mongoose.Types.ObjectId(userId);

    for (const entry of knots) {
      const {
        source_key,
        source_type,
        title,
        artist,
        thumbnail,
        duration_ms,
        junctions,
        knot_name,
        updated_at,
      } = entry;

      if (!source_key || !source_type || !junctions || junctions.length === 0) continue;

      let cleanKey = source_key;
      let cleanThumbnail = thumbnail || '';
      if (source_type === 'youtube') {
        const ytId = extractYoutubeId(source_key);
        if (ytId) cleanKey = ytId;
        if (!cleanThumbnail && cleanKey) {
          cleanThumbnail = `https://i.ytimg.com/vi/${cleanKey}/hqdefault.jpg`;
        }
      }

      // Build the filter to find existing song by its unique source key
      const sourceFilter: Record<string, string> = {};
      switch (source_type) {
        case 'youtube': sourceFilter.youtube_id = cleanKey; break;
        case 'jiosaavn': sourceFilter.jiosaavn_token = cleanKey; break;
        case 'pagalworld': sourceFilter.pagalworld_url = cleanKey; break;
        case 'pagalfree': sourceFilter.pagalfree_url = cleanKey; break;
        case 'local': sourceFilter.local_id = cleanKey; break;
        default: continue;
      }

      // Upsert the Song document
      let song = await Song.findOne(sourceFilter);
      if (!song) {
        song = await Song.create({
          ...sourceFilter,
          title: title || 'Unknown Title',
          artist: artist || '',
          thumbnail: cleanThumbnail,
          duration_ms: duration_ms || 0,
          source: source_type,
        });
      } else {
        // Update metadata if provided
        if (title && title !== 'Unknown Title') song.title = title;
        if (artist) song.artist = artist;
        if (cleanThumbnail) song.thumbnail = cleanThumbnail;
        if (duration_ms) song.duration_ms = duration_ms;
        await song.save();
      }

      // Upsert user's knot data on this song
      const existingKnotIdx = song.user_knots.findIndex(
        (uk: any) => uk.user_id.toString() === userId
      );

      const clientUpdatedAt = updated_at ? new Date(updated_at) : new Date();

      if (existingKnotIdx >= 0) {
        const existing = song.user_knots[existingKnotIdx];
        // Only overwrite if client data is newer
        if (!existing.updated_at || clientUpdatedAt > existing.updated_at) {
          song.user_knots[existingKnotIdx] = {
            user_id: userObjId,
            junctions,
            knot_name: knot_name || 'My Knot',
            updated_at: clientUpdatedAt,
          } as any;
          await song.save();
        }
      } else {
        song.user_knots.push({
          user_id: userObjId,
          junctions,
          knot_name: knot_name || 'My Knot',
          updated_at: clientUpdatedAt,
        } as any);
        await song.save();
      }

      synced++;
    }

    console.log(`[Sync] User ${userId} synced ${synced} knots`);
    res.json({ synced });
  } catch (error) {
    console.error('[Sync] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Get all songs with knots belonging to the authenticated user.
 * Used to pull server knots into client storage after login.
 */
router.get('/my-knots', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const userObjId = new mongoose.Types.ObjectId(userId);

    // Find all songs where this user has knot data
    const songs = await Song.find(
      { 'user_knots.user_id': userObjId },
      {
        youtube_id: 1,
        jiosaavn_token: 1,
        pagalworld_url: 1,
        pagalfree_url: 1,
        local_id: 1,
        title: 1,
        artist: 1,
        thumbnail: 1,
        duration_ms: 1,
        source: 1,
        user_knots: { $elemMatch: { user_id: userObjId } },
      }
    );

    // Older clients synced loop geometry but not artwork. Restore artwork
    // against each record's own stable source key before returning it.
    await Promise.all(songs.map((song) => backfillMissingArtwork(song)));

    // Transform to a clean response format
    const result = songs.map((song) => {
      const userKnot = song.user_knots[0]; // $elemMatch returns at most 1
      const sourceKey =
        song.youtube_id ||
        (song as any).jiosaavn_token ||
        (song as any).pagalworld_url ||
        (song as any).pagalfree_url ||
        (song as any).local_id ||
        '';
      return {
        source_key: sourceKey,
        source_type: song.source || 'youtube',
        title: song.title,
        artist: song.artist,
        thumbnail: song.thumbnail,
        duration_ms: song.duration_ms,
        junctions: userKnot?.junctions || [],
        knot_name: userKnot?.knot_name || 'My Knot',
        updated_at: userKnot?.updated_at,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('[MyKnots] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:id', getSongMetadata);
router.post('/:id/download', enqueueDownload);

export default router;
