import axios from 'axios';
import * as cheerio from 'cheerio';

const PAGALWORLD_BASE = 'https://pagalworld.is';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface PagalworldSong {
    title: string;
    url: string;
    imageUrl?: string;
}

export interface SongMetadata {
    year: string;
    month: string;
    file: string;
    downloadUrl: string;
    bitrate: string;
}

export class PagalworldService {
    /**
     * Search for songs on Pagalworld
     */
    static async searchSongs(query: string): Promise<PagalworldSong[]> {
        try {
            const searchUrl = `${PAGALWORLD_BASE}/search/?s=${encodeURIComponent(query)}`;
            const { data: html } = await axios.get(searchUrl, {
                headers: { 'User-Agent': USER_AGENT }
            });

            const $ = cheerio.load(html);
            const results: PagalworldSong[] = [];

            $('.song-list .song-card').each((_, el) => {
                const $el = $(el);
                const title = $el.find('h3, a').first().text().trim();
                const url = $el.find('a').attr('href');
                const imageUrl = $el.find('img').attr('data-src') || $el.find('img').attr('src');

                if (title && url) {
                    results.push({
                        title,
                        url: url.startsWith('http') ? url : `${PAGALWORLD_BASE}${url}`,
                        imageUrl: imageUrl ? (imageUrl.startsWith('http') ? imageUrl : `${PAGALWORLD_BASE}${imageUrl}`) : undefined
                    });
                }
            });

            return results;
        } catch (error) {
            console.error('[PagalworldService] Search Error:', (error as Error).message);
            return [];
        }
    }

    /**
     * Extract download metadata from a song's detail page
     */
    static async getSongMetadata(songUrl: string): Promise<SongMetadata | null> {
        try {
            const { data: html } = await axios.get(songUrl, {
                headers: { 'User-Agent': USER_AGENT }
            });

            const $ = cheerio.load(html);
            const $dbutton = $('.dbutton').first();

            if (!$dbutton.length) return null;

            const year = $dbutton.attr('data-year');
            const month = $dbutton.attr('data-month');
            const file = $dbutton.attr('data-file');
            const bitrate = $dbutton.attr('title') || 'Unknown';

            if (!year || !month || !file) return null;

            const downloadUrl = `${PAGALWORLD_BASE}/wp-content/uploads/${year}/${month}/${encodeURIComponent(file)}`;

            return {
                year,
                month,
                file,
                downloadUrl,
                bitrate
            };
        } catch (error) {
            console.error('[PagalworldService] Metadata Error:', (error as Error).message);
            return null;
        }
    }
}
