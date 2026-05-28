import axios from 'axios';
import { YoutubeTranscript } from 'youtube-transcript';
import { JiosaavnService, getRotatedHeaders } from './jiosaavn.service';
import { searchYouTube } from './youtube.service';

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResponse {
  lyrics: LyricLine[];
  language: string;
  availableLanguages: { code: string; label: string }[];
}

export class LyricsService {
  /**
   * Helper to fetch available languages for a YouTube video.
   */
  public static async getYoutubeCaptionLanguages(youtubeId: string): Promise<{ code: string; label: string }[]> {
    // 1. Try Innertube player API
    try {
      const resp = await axios.post(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
            },
          },
          videoId: youtubeId,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
          },
          timeout: 4000,
        }
      );
      const captionTracks = resp.data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(captionTracks) && captionTracks.length > 0) {
        return captionTracks.map((t: any) => ({
          code: t.languageCode,
          label: t.name?.runs?.[0]?.text || t.name?.simpleText || t.languageCode,
        }));
      }
    } catch (e) {
      // ignore
    }

    // 2. Fall back to watch page HTML scraping
    try {
      const res = await axios.get(`https://www.youtube.com/watch?v=${youtubeId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36',
        },
        timeout: 4000,
      });
      const html = res.data;
      const captionMatch = html.match(/"captionTracks":\[(.*?)\]/);
      if (captionMatch) {
        const tracks = JSON.parse(`[${captionMatch[1]}]`);
        return tracks.map((t: any) => ({
          code: t.languageCode,
          label: t.name?.runs?.[0]?.text || t.name?.simpleText || t.languageCode,
        }));
      }
    } catch (e) {
      // ignore
    }

    // 3. Fall back to Piped API
    try {
      const res = await axios.get(`https://pipedapi.kavin.rocks/streams/${youtubeId}`, { timeout: 4000 });
      const subtitles = res.data?.subtitles || [];
      if (subtitles.length > 0) {
        return subtitles.map((t: any) => ({
          code: t.code,
          label: t.name || t.code,
        }));
      }
    } catch (e) {
      // ignore
    }

    return [{ code: 'en', label: 'English' }];
  }

  /**
   * Main resolver to get synced lyrics for a song.
   */
  static async resolveLyrics(params: {
    youtube_id?: string;
    jiosaavn_token?: string;
    title?: string;
    artist?: string;
    duration_ms?: number;
    lang?: string;
  }): Promise<LyricsResponse> {
    const { youtube_id, jiosaavn_token, title, artist, duration_ms, lang } = params;
    const duration = duration_ms || 180000; // default 3 min
    const targetLang = lang || 'en';

    // 1. YouTube direct transcript check
    if (youtube_id) {
      try {
        console.log(`[LyricsService] Resolving direct YouTube transcript for: ${youtube_id} (lang: ${targetLang})`);
        const ytLyricsResult = await this.fetchYoutubeTranscript(youtube_id, targetLang);
        if (ytLyricsResult && ytLyricsResult.lyrics.length > 0) {
          const availableLanguages = await this.getYoutubeCaptionLanguages(youtube_id);
          return {
            lyrics: ytLyricsResult.lyrics,
            language: ytLyricsResult.language,
            availableLanguages,
          };
        }
      } catch (e) {
        console.warn(`[LyricsService] YouTube direct transcript fetch failed:`, (e as Error).message);
      }
    }

    // 2. JioSaavn Source (ONLY if title or artist is missing)
    let resolvedTitle = title || '';
    let resolvedArtist = artist || '';

    if (jiosaavn_token && (!resolvedTitle || !resolvedArtist)) {
      try {
        console.log(`[LyricsService] Resolving JioSaavn metadata for token: ${jiosaavn_token}`);
        const metadata = await JiosaavnService.getSongMetadata(jiosaavn_token);
        if (metadata) {
          if (!resolvedTitle) resolvedTitle = metadata.title;
          if (!resolvedArtist) resolvedArtist = metadata.artist;
        }
      } catch (e) {
        console.warn(`[LyricsService] JioSaavn metadata query failed:`, (e as Error).message);
      }
    }

    // 3. YouTube Search Transcript Fallback (CRITICAL FOR BOLLYWOOD)
    if (resolvedTitle) {
      try {
        const searchQuery = `${resolvedArtist} ${resolvedTitle} lyrics`.trim();
        console.log(`[LyricsService] Bollywood Fallback: Searching YouTube for lyrics transcript: "${searchQuery}"`);
        const searchResults = await searchYouTube(searchQuery, 3);

        if (searchResults && searchResults.length > 0) {
          for (const result of searchResults) {
            console.log(`[LyricsService] Trying to extract transcript from fallback video: ${result.youtube_id} (${result.title})`);
            const ytLyricsResult = await this.fetchYoutubeTranscript(result.youtube_id, targetLang);
            if (ytLyricsResult && ytLyricsResult.lyrics.length > 0) {
              console.log(`[LyricsService] Successfully resolved synced lyrics from YouTube video fallback: ${result.youtube_id}`);
              const availableLanguages = await this.getYoutubeCaptionLanguages(result.youtube_id);
              return {
                lyrics: ytLyricsResult.lyrics,
                language: ytLyricsResult.language,
                availableLanguages,
              };
            }
          }
        }
      } catch (e) {
        console.warn(`[LyricsService] YouTube transcript fallback search failed:`, (e as Error).message);
      }
    }

    // 4. LRCLIB Synced Search (in case it is available)
    if (resolvedTitle) {
      try {
        console.log(`[LyricsService] Querying LRCLIB for synced lyrics: ${resolvedArtist} - ${resolvedTitle}`);
        const synced = await this.fetchLrcLibSynced(resolvedTitle, resolvedArtist, duration);
        if (synced && synced.length > 0) {
          return {
            lyrics: synced,
            language: 'original',
            availableLanguages: [{ code: 'original', label: 'Original' }],
          };
        }
      } catch (e) {
        console.warn(`[LyricsService] LRCLIB synced search failed:`, (e as Error).message);
      }
    }

    // 5. JioSaavn Plain Lyrics Fallback (Pseudo-Syncing)
    if (jiosaavn_token) {
      try {
        console.log(`[LyricsService] JioSaavn Fallback: Resolving plain lyrics for token: ${jiosaavn_token}`);
        const metadata = await JiosaavnService.getSongMetadata(jiosaavn_token);
        if (metadata && metadata.has_lyrics && metadata.id) {
          const plain = await this.fetchJiosaavnPlainLyrics(metadata.id);
          if (plain) {
            console.log(`[LyricsService] Fallback: Pseudo-syncing JioSaavn plain lyrics`);
            return {
              lyrics: this.pseudoSyncPlainLyrics(plain, duration),
              language: 'original',
              availableLanguages: [{ code: 'original', label: 'Original' }],
            };
          }
        }
      } catch (e) {
        console.warn(`[LyricsService] JioSaavn plain lyrics query failed:`, (e as Error).message);
      }
    }

    // 6. LRCLIB Plain Lyrics Fallback (Pseudo-Syncing)
    if (resolvedTitle) {
      try {
        console.log(`[LyricsService] Querying LRCLIB for plain lyrics: ${resolvedArtist} - ${resolvedTitle}`);
        const plain = await this.fetchLrcLibPlain(resolvedTitle, resolvedArtist, duration);
        if (plain) {
          console.log(`[LyricsService] Fallback: Pseudo-syncing LRCLIB plain lyrics`);
          return {
            lyrics: this.pseudoSyncPlainLyrics(plain, duration),
            language: 'original',
            availableLanguages: [{ code: 'original', label: 'Original' }],
          };
        }
      } catch (e) {
        console.warn(`[LyricsService] LRCLIB plain query failed:`, (e as Error).message);
      }
    }

    // 7. Last Resort: Search YouTube without 'lyrics' keyword
    if (resolvedTitle) {
      try {
        const searchQuery = `${resolvedArtist} ${resolvedTitle}`.trim();
        console.log(`[LyricsService] Final Fallback: Searching YouTube for official video transcript: "${searchQuery}"`);
        const searchResults = await searchYouTube(searchQuery, 2);

        if (searchResults && searchResults.length > 0) {
          for (const result of searchResults) {
            const ytLyricsResult = await this.fetchYoutubeTranscript(result.youtube_id, targetLang);
            if (ytLyricsResult && ytLyricsResult.lyrics.length > 0) {
              console.log(`[LyricsService] Successfully resolved synced lyrics from official YouTube video: ${result.youtube_id}`);
              const availableLanguages = await this.getYoutubeCaptionLanguages(result.youtube_id);
              return {
                lyrics: ytLyricsResult.lyrics,
                language: ytLyricsResult.language,
                availableLanguages,
              };
            }
          }
        }
      } catch (e) {
        console.warn(`[LyricsService] Final fallback search failed:`, (e as Error).message);
      }
    }

    return {
      lyrics: [],
      language: 'none',
      availableLanguages: [],
    };
  }

  /**
   * Fetches YouTube transcript and parses it to LyricLine array.
   */
  private static async fetchYoutubeTranscript(youtubeId: string, targetLang?: string): Promise<{ lyrics: LyricLine[]; language: string } | null> {
    let transcriptData: any[] = [];
    const lang = targetLang || 'en';

    // Method 1: youtube-transcript library
    try {
      transcriptData = await YoutubeTranscript.fetchTranscript(youtubeId, { lang });
      if (transcriptData && transcriptData.length > 0) {
        return {
          lyrics: transcriptData.map((t) => ({
            timeMs: Math.round(t.offset),
            text: t.text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
          })),
          language: lang,
        };
      }
    } catch (e) {
      console.warn(`[LyricsService] YoutubeTranscript library failed for ${youtubeId} with lang ${lang}:`, (e as Error).message);
      if (targetLang) {
        try {
          transcriptData = await YoutubeTranscript.fetchTranscript(youtubeId);
          if (transcriptData && transcriptData.length > 0) {
            return {
              lyrics: transcriptData.map((t) => ({
                timeMs: Math.round(t.offset),
                text: t.text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
              })),
              language: transcriptData[0].lang || 'unknown',
            };
          }
        } catch (err) {
          console.warn(`[LyricsService] YoutubeTranscript library fallback failed for ${youtubeId}:`, (err as Error).message);
        }
      }
    }

    // Method 2: Piped API
    try {
      const res = await axios.get(`https://pipedapi.kavin.rocks/streams/${youtubeId}`, { timeout: 5000 });
      const subtitles = res.data?.subtitles || [];
      if (subtitles.length > 0) {
        const track = subtitles.find((t: any) => t.code === lang) ||
          subtitles.find((t: any) => t.code === 'en') ||
          subtitles.find((t: any) => t.autoGenerated) ||
          subtitles[0];
        if (track?.url) {
          const transcriptRes = await axios.get(track.url, { timeout: 5000 });
          const parsed = this.parseVtt(transcriptRes.data);
          if (parsed.length > 0) {
            return {
              lyrics: parsed,
              language: track.code || 'unknown',
            };
          }
        }
      }
    } catch (e) {
      console.warn(`[LyricsService] Piped API transcript failed for ${youtubeId}:`, (e as Error).message);
    }

    // Method 3: Invidious API
    try {
      const res = await axios.get(`https://invidious.jing.rocks/api/v1/captions/${youtubeId}`, { timeout: 5000 });
      if (res.data?.captions && res.data.captions.length > 0) {
        const track = res.data.captions.find((t: any) => t.language_code === lang) ||
          res.data.captions.find((t: any) => t.language_code === 'en') ||
          res.data.captions[0];
        if (track?.url) {
          const transcriptRes = await axios.get(track.url, { timeout: 5000 });
          if (transcriptRes.data?.lines) {
            return {
              lyrics: transcriptRes.data.lines.map((l: any) => ({
                timeMs: Math.round(l.start_ms),
                text: l.text,
              })),
              language: track.language_code || 'unknown',
            };
          }
        }
      }
    } catch (e) {
      console.warn(`[LyricsService] Invidious API transcript failed for ${youtubeId}:`, (e as Error).message);
    }

    // Method 4: YouTube Innertube scraper fallback
    try {
      const res = await axios.get(`https://www.youtube.com/watch?v=${youtubeId}`, { timeout: 5000 });
      const html = res.data;
      const captionMatch = html.match(/"captionTracks":\[(.*?)\]/);
      if (captionMatch) {
        const tracks = JSON.parse(`[${captionMatch[1]}]`);
        const track = tracks.find((t: any) => t.languageCode === lang) ||
          tracks.find((t: any) => t.languageCode === 'en') ||
          tracks[0];
        if (track?.baseUrl) {
          const transcriptRes = await axios.get(track.baseUrl, { timeout: 5000 });
          const xmlText = transcriptRes.data;
          const textMatches = xmlText.matchAll(/<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g);
          return {
            lyrics: Array.from(textMatches).map((m: any) => ({
              timeMs: Math.round(parseFloat(m[1]) * 1000),
              text: m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
            })),
            language: track.languageCode || 'unknown',
          };
        }
      }
    } catch (e) {
      console.warn(`[LyricsService] Innertube scraper failed for ${youtubeId}:`, (e as Error).message);
    }

    return null;
  }

  /**
   * Helper to parse WebVTT format to LyricLine array.
   */
  private static parseVtt(vttText: string): LyricLine[] {
    const lines = vttText.split('\n\n').slice(1);
    const parsed: LyricLine[] = [];

    for (const block of lines) {
      const parts = block.split('\n');
      if (parts.length >= 2) {
        const timeMatch = parts[0].match(/(\d{2}:\d{2}:\d{2}.\d{3}) -->/);
        if (timeMatch) {
          const [h, m, s] = timeMatch[1].split(':');
          const ms = (parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s)) * 1000;
          parsed.push({
            timeMs: Math.round(ms),
            text: parts.slice(1).join(' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
          });
        }
      }
    }
    return parsed;
  }

  /**
   * Fetches plain lyrics from JioSaavn internal endpoint.
   */
  private static async fetchJiosaavnPlainLyrics(songId: string): Promise<string | null> {
    try {
      const lyricsUrl = `https://www.jiosaavn.com/api.php?__call=lyrics.getLyrics&lyrics_id=${songId}&_format=json&_marker=0`;
      console.log(`[LyricsService] Fetching JioSaavn plain lyrics for song ID: ${songId}`);
      const res = await axios.get(lyricsUrl, {
        headers: getRotatedHeaders(songId),
        timeout: 8000,
      });
      if (res.data?.lyrics) {
        return res.data.lyrics;
      }
    } catch (e) {
      console.error(`[LyricsService] JioSaavn lyrics fetch failed:`, (e as Error).message);
    }
    return null;
  }

  /**
   * Fetch synced lyrics from LRCLIB.
   */
  private static async fetchLrcLibSynced(title: string, artist?: string, durationSec?: number): Promise<LyricLine[] | null> {
    try {
      const cleanTitle = encodeURIComponent(title);
      const cleanArtist = encodeURIComponent(artist || '');
      const duration = durationSec ? Math.round(durationSec / 1000) : 0;

      let url = `https://lrclib.net/api/get?artist_name=${cleanArtist}&track_name=${cleanTitle}`;
      if (duration > 0) {
        url += `&duration=${duration}`;
      }

      const res = await axios.get(url, { timeout: 6000 });
      if (res.data?.syncedLyrics) {
        return this.parseLrc(res.data.syncedLyrics);
      }
    } catch (e) {
      // If exact fails, try search
      try {
        const cleanTitle = encodeURIComponent(title);
        const cleanArtist = encodeURIComponent(artist || '');
        const searchUrl = `https://lrclib.net/api/search?q=${cleanArtist}+${cleanTitle}`;
        const searchRes = await axios.get(searchUrl, { timeout: 6000 });
        if (Array.isArray(searchRes.data) && searchRes.data.length > 0) {
          const matched = searchRes.data.find((item: any) => item.syncedLyrics);
          if (matched) {
            return this.parseLrc(matched.syncedLyrics);
          }
        }
      } catch (err) {
        // fail silently
      }
    }
    return null;
  }

  /**
   * Fetch plain lyrics from LRCLIB.
   */
  private static async fetchLrcLibPlain(title: string, artist?: string, durationSec?: number): Promise<string | null> {
    try {
      const cleanTitle = encodeURIComponent(title);
      const cleanArtist = encodeURIComponent(artist || '');
      const duration = durationSec ? Math.round(durationSec / 1000) : 0;

      let url = `https://lrclib.net/api/get?artist_name=${cleanArtist}&track_name=${cleanTitle}`;
      if (duration > 0) {
        url += `&duration=${duration}`;
      }

      const res = await axios.get(url, { timeout: 5000 });
      if (res.data?.plainLyrics) {
        return res.data.plainLyrics;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  /**
   * Helper to parse LRC lyrics.
   */
  private static parseLrc(lrcText: string): LyricLine[] {
    const lines = lrcText.split('\n');
    const lyrics: LyricLine[] = [];
    const timeRegex = /\[(\d{2,3}):(\d{2})(?:\.(\d{2,3}))?\]/;

    for (const line of lines) {
      const match = timeRegex.exec(line);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const msStr = match[3] || '0';
        const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);

        const timeMs = (min * 60 + sec) * 1000 + ms;
        const text = line.replace(timeRegex, '').trim();
        lyrics.push({ timeMs, text });
      }
    }

    return lyrics.sort((a, b) => a.timeMs - b.timeMs);
  }

  /**
   * Pseudo-syncs plain lyrics by spacing them out evenly across the song's duration.
   */
  private static pseudoSyncPlainLyrics(plainLyrics: string, durationMs: number): LyricLine[] {
    const rawLines = plainLyrics
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('[') && !l.endsWith(']'));

    if (rawLines.length === 0) return [];

    const startTime = Math.min(8000, durationMs * 0.05);
    const endTime = Math.max(durationMs - 15000, durationMs * 0.9);
    const availableTime = endTime - startTime;

    const step = availableTime / rawLines.length;

    return rawLines.map((line, index) => ({
      timeMs: Math.round(startTime + index * step),
      text: line,
    }));
  }
}
