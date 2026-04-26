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
  try {
    const searchResponse = await youtube.search.list({
      part: ['snippet'],
      q: query,
      type: ['video'],
      videoCategoryId: '10', // Music category
      maxResults,
      order: 'relevance',
    });

    const items = searchResponse.data.items || [];
    if (items.length === 0) return [];

    // Get video IDs for duration lookup
    const videoIds = items
      .map((item) => item.id?.videoId)
      .filter(Boolean) as string[];

    // Fetch durations via videos.list
    const detailsResponse = await youtube.videos.list({
      part: ['contentDetails', 'snippet'],
      id: videoIds,
    });

    const durationMap = new Map<string, number>();
    for (const video of detailsResponse.data.items || []) {
      if (video.id && video.contentDetails?.duration) {
        durationMap.set(video.id, parseDuration(video.contentDetails.duration));
      }
    }

    return items.map((item) => {
      const videoId = item.id?.videoId || '';
      return {
        youtube_id: videoId,
        title: decodeHtml(item.snippet?.title || ''),
        artist: decodeHtml(item.snippet?.channelTitle || ''),
        thumbnail:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        duration_ms: durationMap.get(videoId) || 0,
        published_at: item.snippet?.publishedAt || '',
      };
    });
  } catch (error) {
    console.error('[YouTube Service] Search error:', error);
    throw error;
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

  // Tier 1: YouTubei.js (Innertube) - Mimics Android App
  try {
    console.log(`[Innertube] Attempting extraction for ${videoId}...`);
    const { Innertube } = require('youtubei.js');
    const youtube = await Innertube.create();
    const info = await youtube.getBasicInfo(videoId);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    
    if (format?.decipher(youtube.session.player)) {
      const url = format.url;
      if (url) {
        console.log(`[Innertube] Success!`);
        STREAM_URL_CACHE.set(videoId, { url, expiry: Date.now() + CACHE_TTL });
        return url;
      }
    }
  } catch (e) {
    console.warn(`[Innertube] Failed for ${videoId}:`, (e as Error).message);
  }

  // Tier 2: Piped API Fallback
  try {
    console.log(`[Piped] Trying fallback for ${videoId}...`);
    const res = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
    if (res.ok) {
      const data = await res.json();
      const audio = data.audioStreams?.find((s: any) => s.format === 'WEBM_OPUS' || s.bitrate > 100000);
      if (audio?.url) {
        console.log(`[Piped] Success!`);
        STREAM_URL_CACHE.set(videoId, { url: audio.url, expiry: Date.now() + CACHE_TTL });
        return audio.url;
      }
    }
  } catch (e) {
    console.warn(`[Piped] Failed.`);
  }

  // Tier 3: Last Resort - yt-dlp
  return new Promise((resolve, reject) => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const cookieFlag = hasCookies ? `--cookies ${COOKIE_PATH}` : '';
    const command = `yt-dlp ${cookieFlag} -f "bestaudio" -g "${ytUrl}"`;

    console.log(`[yt-dlp] Last resort for ${videoId}...`);
    exec(command, { timeout: 15000 }, (error, stdout) => {
      if (!error && stdout.trim()) {
        const url = stdout.trim().split('\n')[0];
        STREAM_URL_CACHE.set(videoId, { url, expiry: Date.now() + CACHE_TTL });
        resolve(url);
      } else {
        reject(new Error('All extraction methods failed'));
      }
    });
  });
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
