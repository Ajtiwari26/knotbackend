import { google } from 'googleapis';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

dotenv.config();

// In-memory cache for stream URLs to bypass Upstash limits
const STREAM_URL_CACHE = new Map<string, { url: string; expiry: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 2; // 2 hours

const COOKIE_PATH = path.join(process.cwd(), 'youtube_cookies.txt');
const hasCookies = fs.existsSync(COOKIE_PATH);

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

export interface YouTubeSearchResult {
  youtube_id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration_ms: number;
  published_at: string;
}

/**
 * Search YouTube for music videos.
 */
export async function searchYouTube(
  query: string,
  maxResults: number = 20
): Promise<YouTubeSearchResult[]> {
  // Try Official API First
  if (process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_API_KEY !== 'YOUR_KEY_HERE') {
    try {
      console.log(`[YouTube] Official API search for: ${query}`);
      const searchResponse = await youtube.search.list({
        part: ['snippet'],
        q: query,
        type: ['video'],
        videoCategoryId: '10', // Music
        maxResults,
      });

      const items = searchResponse.data.items || [];
      const videoIds = items.map(i => i.id?.videoId).filter(Boolean) as string[];

      const detailsResponse = await youtube.videos.list({
        part: ['contentDetails', 'snippet'],
        id: videoIds,
      });

      const durationMap = new Map();
      for (const video of detailsResponse.data.items || []) {
        durationMap.set(video.id, parseDuration(video.contentDetails?.duration || 'PT0S'));
      }

      return items.map(item => ({
        youtube_id: item.id?.videoId || '',
        title: decodeHtml(item.snippet?.title || ''),
        artist: decodeHtml(item.snippet?.channelTitle || ''),
        thumbnail: item.snippet?.thumbnails?.high?.url || '',
        duration_ms: durationMap.get(item.id?.videoId) || 0,
        published_at: item.snippet?.publishedAt || ''
      }));
    } catch (e) {
      console.warn('[YouTube] Official API failed, falling back to scraper...');
    }
  }

  // Fallback: Innertube Scraper
  try {
    const { Innertube } = require('youtubei.js');
    const yt = await Innertube.create();
    const search = await yt.search(query, { type: 'video' });
    const results = search.results?.filter((r: any) => r.type === 'Video') || [];
    
    return results.slice(0, maxResults).map((video: any) => ({
      youtube_id: video.id,
      title: video.title?.text || 'Unknown',
      artist: video.author?.name || 'Unknown',
      thumbnail: video.thumbnails?.[0]?.url || '',
      duration_ms: (video.duration?.seconds || 0) * 1000,
      published_at: video.published?.text || ''
    }));
  } catch (error) {
    console.error('[YouTube] Scraper fallback failed:', error);
    return [];
  }
}

/**
 * Get details for a single video.
 */
export async function getVideoDetails(
  videoId: string
): Promise<YouTubeSearchResult | null> {
  try {
    const response = await youtube.videos.list({
      part: ['snippet', 'contentDetails'],
      id: [videoId],
    });

    const video = response.data.items?.[0];
    if (!video) return null;

    return {
      youtube_id: videoId,
      title: decodeHtml(video.snippet?.title || ''),
      artist: decodeHtml(video.snippet?.channelTitle || ''),
      thumbnail:
        video.snippet?.thumbnails?.high?.url ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration_ms: parseDuration(video.contentDetails?.duration || 'PT0S'),
      published_at: video.snippet?.publishedAt || '',
    };
  } catch (error) {
    console.error('[YouTube Service] Video details error:', error);
    return null;
  }
}

/**
 * Parse ISO 8601 duration (PT4M32S) to milliseconds.
 */
function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Get a working stream URL for a video.
 */
export async function getStreamUrl(videoId: string): Promise<string> {
  const cached = STREAM_URL_CACHE.get(videoId);
  if (cached && cached.expiry > Date.now()) {
    console.log(`[Cache] Found URL for ${videoId}`);
    return cached.url;
  }

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Tier 1: yt-dlp (Primary in 2026 - most reliable)
  try {
    console.log(`[yt-dlp] Primary extraction for ${videoId}...`);
    const cookieFlag = hasCookies ? `--cookies ${COOKIE_PATH}` : '';
    // --no-check-certificates and --geo-bypass for robustness
    // --extractor-args to try multiple client identities
    const command = `yt-dlp ${cookieFlag} --no-check-certificates --geo-bypass -f "bestaudio" -g "${ytUrl}"`;

    const url = await new Promise<string>((resolve, reject) => {
      exec(command, { timeout: 10000 }, (error, stdout) => {
        if (!error && stdout.trim()) {
          resolve(stdout.trim().split('\n')[0]);
        } else {
          reject(error || new Error('yt-dlp failed'));
        }
      });
    });

    if (url) {
      console.log(`[yt-dlp] Success!`);
      STREAM_URL_CACHE.set(videoId, { url, expiry: Date.now() + CACHE_TTL });
      return url;
    }
  } catch (e) {
    console.warn(`[yt-dlp] Failed:`, (e as Error).message);
  }

  // Tier 2: @distube/ytdl-core (Reliable on residential IPs)
  try {
    console.log(`[ytdl-core] Fallback extraction for ${videoId}...`);
    const ytdl = require('@distube/ytdl-core');
    const info = await ytdl.getInfo(videoId);
    const format = ytdl.chooseFormat(info.formats, { 
      filter: 'audioonly', 
      quality: 'highestaudio' 
    });
    
    if (format?.url) {
      console.log(`[ytdl-core] Success!`);
      STREAM_URL_CACHE.set(videoId, { url: format.url, expiry: Date.now() + CACHE_TTL });
      return format.url;
    }
  } catch (e) {
    console.warn(`[ytdl-core] Failed.`);
  }

  // Tier 3: Innertube (ANDROID_TESTSUITE identity)
  try {
    console.log(`[Innertube] Fallback extraction for ${videoId}...`);
    const { Innertube } = require('youtubei.js');
    const yt = await Innertube.create();
    const info = await yt.getBasicInfo(videoId);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const url = format?.url || (await format?.decipher?.(yt.session.player));
    
    if (url) {
      console.log(`[Innertube] Success!`);
      STREAM_URL_CACHE.set(videoId, { url, expiry: Date.now() + CACHE_TTL });
      return url;
    }
  } catch (e) {
    console.warn(`[Innertube] Failed.`);
  }

  throw new Error('All extraction methods failed');
}

function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}
