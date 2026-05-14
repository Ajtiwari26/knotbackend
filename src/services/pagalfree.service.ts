import axios from 'axios';
import * as cheerio from 'cheerio';

const PAGALFREE_BASE = 'https://pagalfree.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface PagalfreeSong {
    title: string;
    url: string;
    imageUrl?: string;
    artist?: string;
}

export interface PagalfreeMetadata {
    title: string;
    artist: string;
    album?: string;
    imageUrl?: string;
    downloadLinks: {
        quality: string;
        url: string;
    }[];
}

export class PagalfreeService {
    /**
     * Search for songs on PagalFree
     */
    static async searchSongs(query: string): Promise<PagalfreeSong[]> {
        try {
            // PagalFree uses REST-style search: https://pagalfree.com/search/[query]
            const searchUrl = `${PAGALFREE_BASE}/search/${encodeURIComponent(query)}`;
            const { data: html } = await axios.get(searchUrl, {
                headers: { 'User-Agent': USER_AGENT }
            });

            const $ = cheerio.load(html);
            const results: PagalfreeSong[] = [];

            // The search results are usually links inside divs or lists
            // Based on snapshot: link contains title and artist
            $('a[href*="/music/"]').each((_, el) => {
                const $el = $(el);
                const url = $el.attr('href');
                if (!url) return;

                // Title usually in a StaticText or similar
                // Example: "Boht Tej - Badshah 128 Kbps.mp3"
                let title = $el.text().trim();
                
                // If it's a duplicate or quality-specific link from search, we might want to group them
                // but for now let's just push them all
                
                const artist = $el.find('span, p, .artist').text().trim() || 'Unknown';

                if (title && !results.some(r => r.url === url)) {
                    results.push({
                        title: title.replace(/\s\d+\sKbps\.mp3/gi, '').trim(),
                        url: url.startsWith('http') ? url : `${PAGALFREE_BASE}${url}`,
                        artist: artist !== 'Unknown' ? artist : undefined
                    });
                }
            });

            return results;
        } catch (error) {
            console.error('[PagalfreeService] Search Error:', (error as Error).message);
            return [];
        }
    }

    /**
     * Extract download metadata from a PagalFree song page
     */
    static async getSongMetadata(songUrl: string): Promise<PagalfreeMetadata | null> {
        try {
            const { data: html } = await axios.get(songUrl, {
                headers: { 'User-Agent': USER_AGENT }
            });

            const $ = cheerio.load(html);
            
            // Extract basic info
            const title = $('h1').first().text().trim() || 'Unknown Song';
            const artist = $('.singer, .singer-name').text().trim() || 'Unknown Artist';
            const album = $('.album, .album-name').text().trim();
            const imageUrl = $('img.song-img, .album-art img').attr('src');

            const downloadLinks: { quality: string; url: string; }[] = [];

            // Extract download buttons
            $('a[href*="/dwload/"]').each((_, el) => {
                const $el = $(el);
                const href = $el.attr('href');
                const text = $el.text().toLowerCase();

                if (href) {
                    let quality = '128kbps'; // Default
                    if (text.includes('320')) quality = '320kbps';
                    else if (text.includes('128')) quality = '128kbps';
                    else if (text.includes('48')) quality = '48kbps';

                    downloadLinks.push({
                        quality,
                        url: href.startsWith('http') ? href : `${PAGALFREE_BASE}${href}`
                    });
                }
            });

            return {
                title,
                artist,
                album,
                imageUrl: imageUrl ? (imageUrl.startsWith('http') ? imageUrl : `${PAGALFREE_BASE}${imageUrl}`) : undefined,
                downloadLinks
            };
        } catch (error) {
            console.error('[PagalfreeService] Metadata Error:', (error as Error).message);
            return null;
        }
    }
}
