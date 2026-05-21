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
                headers: { 'User-Agent': USER_AGENT },
                timeout: 15000
            });

            const $ = cheerio.load(html);
            const results: PagalfreeSong[] = [];

            // The search results are usually links inside divs or lists
            $('div#category_content').each((_, el) => {
                const $container = $(el);
                const $link = $container.find('a[href*="/music/"]');
                const url = $link.attr('href');
                if (!url) return;

                const fullText = $link.find('b').text().trim();
                let cleanTitle = fullText.replace(/\s\d+\sKbps\.mp3/gi, '').trim();
                let artist = 'Unknown';
                let isHighQuality = fullText.includes('320 Kbps');
                
                // Parse format: "Song Title - Artist Name" or "Song (Artist Version)"
                if (cleanTitle.includes(' - ')) {
                    const parts = cleanTitle.split(' - ');
                    artist = parts.pop()?.trim() || 'Unknown';
                    cleanTitle = parts.join(' - ').trim();
                } else if (cleanTitle.includes('(') && cleanTitle.includes(')')) {
                    const match = cleanTitle.match(/\((.*?)\)/);
                    if (match) {
                        artist = match[1].replace(/Version/gi, '').trim();
                        cleanTitle = cleanTitle.replace(/\(.*?\)/, '').trim();
                    }
                }

                // Extract image from img tag
                let imageUrl = $link.find('img').attr('src');
                
                if (imageUrl) {
                    if (!imageUrl.startsWith('http')) {
                        imageUrl = `${PAGALFREE_BASE}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
                    }
                    try {
                        const imgUrlObj = new URL(imageUrl);
                        imgUrlObj.pathname = imgUrlObj.pathname.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
                        imageUrl = imgUrlObj.toString();
                    } catch (e) {
                        console.warn('[PagalfreeService] Failed to encode search image URL:', e);
                    }
                }

                // Deduplication logic: if same title/artist exists, prefer 320kbps
                const existingIndex = results.findIndex(r => r.title === cleanTitle && r.artist === artist);
                const fullUrl = url.startsWith('http') ? url : `${PAGALFREE_BASE}${url}`;

                if (existingIndex !== -1) {
                    if (isHighQuality) {
                        results[existingIndex].url = fullUrl;
                        if (imageUrl) results[existingIndex].imageUrl = imageUrl;
                    }
                } else {
                    results.push({
                        title: cleanTitle,
                        url: fullUrl,
                        artist: artist !== 'Unknown' ? artist : undefined,
                        imageUrl: imageUrl
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
            console.log(`[PagalfreeService] Fetching metadata from: ${songUrl}`);
            const { data: html } = await axios.get(songUrl, {
                headers: { 'User-Agent': USER_AGENT },
                timeout: 15000
            });

            const $ = cheerio.load(html);
            
            // Extract basic info - try multiple selectors
            const title = $('h1').first().text().trim() || 
                         $('h2.song-title').text().trim() || 
                         $('.song-name').text().trim() || 
                         'Unknown Song';
            
            const artist = $('.singer').text().trim() || 
                          $('.singer-name').text().trim() || 
                          $('.artist').text().trim() || 
                          $('p:contains("Singer")').next().text().trim() || 
                          'Unknown Artist';
            
            const album = $('.album').text().trim() || 
                         $('.album-name').text().trim() || 
                         $('p:contains("Album")').next().text().trim();
            
            // Try multiple selectors for image
            let imageUrl = $('img.song-img').attr('src') || 
                          $('.album-art img').attr('src') || 
                          $('img[alt*="cover"]').attr('src') || 
                          $('img[alt*="album"]').attr('src') ||
                          $('.song-image img').attr('src') ||
                          $('meta[property="og:image"]').attr('content') ||
                          $('img').first().attr('src');

            console.log(`[PagalfreeService] Extracted - Title: ${title}, Artist: ${artist}, Image: ${imageUrl}`);

            const downloadLinks: { quality: string; url: string; }[] = [];

            // Extract download buttons
            $('a[href*="/dwload/"], a[href*="download"], a:contains("Download")').each((_, el) => {
                const $el = $(el);
                const href = $el.attr('href');
                const text = $el.text().toLowerCase();

                if (href && (href.includes('dwload') || href.includes('download'))) {
                    let quality = '128kbps'; // Default
                    if (text.includes('320')) quality = '320kbps';
                    else if (text.includes('128')) quality = '128kbps';
                    else if (text.includes('48')) quality = '48kbps';
                    else if (text.includes('64')) quality = '64kbps';

                    downloadLinks.push({
                        quality,
                        url: href.startsWith('http') ? href : `${PAGALFREE_BASE}${href}`
                    });
                }
            });

            console.log(`[PagalfreeService] Found ${downloadLinks.length} download links`);

            // Clean and format the image URL
            let finalImageUrl: string | undefined;
            if (imageUrl) {
                if (imageUrl.startsWith('http')) {
                    finalImageUrl = imageUrl;
                } else {
                    // Ensure path starts with /
                    const cleanPath = imageUrl.startsWith('/') ? imageUrl : '/' + imageUrl;
                    finalImageUrl = `${PAGALFREE_BASE}${cleanPath}`;
                }
                // URL encode spaces and special characters in the path
                try {
                    const url = new URL(finalImageUrl);
                    url.pathname = url.pathname.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
                    finalImageUrl = url.toString();
                } catch (e) {
                    console.warn('[PagalfreeService] Failed to encode image URL:', e);
                }
            }

            return {
                title,
                artist,
                album,
                imageUrl: finalImageUrl,
                downloadLinks
            };
        } catch (error) {
            console.error('[PagalfreeService] Metadata Error:', (error as Error).message);
            return null;
        }
    }
}
