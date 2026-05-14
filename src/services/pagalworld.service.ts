import axios from 'axios';
import * as cheerio from 'cheerio';

const PAGALWORLD_BASE = 'https://pagalworld.is';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface PagalworldSong {
    title: string;
    url: string;
    imageUrl?: string;
    artist?: string;
}

export interface SongMetadata {
    title?: string;
    artist?: string;
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
                headers: { 'User-Agent': USER_AGENT },
                timeout: 15000
            });

            const $ = cheerio.load(html);
            const results: PagalworldSong[] = [];

            $('.song-list .song-card').each((_, el) => {
                const $el = $(el);
                
                // Remove unwanted child elements that might contain UI text or SVG data
                const $temp = $el.find('h3, .title').clone();
                $temp.find('svg, i, button, .play-btn').remove();
                
                let title = $temp.text().trim();
                
                // If title is still empty or looks like UI text, try to find the link that isn't the 'play' button
                if (!title || title.toLowerCase().includes('play')) {
                    const $link = $el.find('a').not('.play-btn, .dbutton').first().clone();
                    $link.find('svg, i, button').remove();
                    title = $link.text().trim();
                }

                // Clean up any remaining junk strings
                title = title
                    .replace(/play\s*\[#.*?\]/gi, '')
                    .replace(/Created with Sketch\./gi, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                const url = $el.find('a').attr('href');
                const imageUrl = $el.find('img').attr('data-src') || $el.find('img').attr('src');
                
                // Try to find artist in search card if available
                let artist = $el.find('.subtitle, .artist').text().trim();
                if (!artist) {
                    // Sometimes it's in the title as "Song Name - Artist"
                    const parts = title.split(' - ');
                    if (parts.length > 1) {
                        artist = parts[parts.length - 1];
                    }
                }

                if (title && url && !['play', 'download'].includes(title.toLowerCase())) {
                    results.push({
                        title: title,
                        url: url.startsWith('http') ? url : `${PAGALWORLD_BASE}${url}`,
                        imageUrl: imageUrl ? (imageUrl.startsWith('http') ? imageUrl : `${PAGALWORLD_BASE}${imageUrl}`) : undefined,
                        artist: artist || 'Pagalworld'
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

            // Clean title extraction from detail page
            const $h1 = $('h1').first().clone();
            $h1.find('svg, i, button, span.play-btn').remove();
            let pageTitle = $h1.text().trim()
                .replace(/play\s*\[#.*?\]/gi, '')
                .replace(/Created with Sketch\./gi, '')
                .replace(/\s+/g, ' ')
                .trim();

            const $artist = $('.artist-name').first().clone();
            $artist.find('svg, i').remove();
            const artist = $artist.text().trim() || 'Unknown Artist';

            if (!year || !month || !file) return null;

            const downloadUrl = `${PAGALWORLD_BASE}/wp-content/uploads/${year}/${month}/${encodeURIComponent(file)}`;

            return {
                title: pageTitle,
                artist: artist,
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
