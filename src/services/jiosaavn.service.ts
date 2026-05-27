import axios from 'axios';
import CryptoJS from 'crypto-js';

function hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

const INDIAN_IP_RANGES = [
    // Reliance Jio (157.32.0.0/11) -> 157.32.0.0 to 157.63.255.255
    { start: [157, 32, 0, 0], end: [157, 63, 255, 255] },
    // Reliance Jio (49.32.0.0/12) -> 49.32.0.0 to 49.47.255.255
    { start: [49, 32, 0, 0], end: [49, 47, 255, 255] },
    // Bharti Airtel (122.160.0.0/11) -> 122.160.0.0 to 122.191.255.255
    { start: [122, 160, 0, 0], end: [122, 191, 255, 255] },
    // ACT Fibernet (49.204.0.0/14) -> 49.204.0.0 to 49.207.255.255
    { start: [49, 204, 0, 0], end: [49, 207, 255, 255] }
];

function getRandomIP(seed?: string): string {
    let rangeIndex = 0;
    let r1 = 0, r2 = 0, r3 = 0, r4 = 0;

    if (seed) {
        const hash = hashCode(seed);
        rangeIndex = hash % INDIAN_IP_RANGES.length;
        const range = INDIAN_IP_RANGES[rangeIndex];
        
        const span1 = range.end[0] - range.start[0] + 1;
        const span2 = range.end[1] - range.start[1] + 1;
        const span3 = range.end[2] - range.start[2] + 1;
        const span4 = range.end[3] - range.start[3] + 1;

        r1 = range.start[0] + (hash % span1);
        r2 = range.start[1] + ((hash >> 4) % span2);
        r3 = range.start[2] + ((hash >> 8) % span3);
        r4 = range.start[3] + ((hash >> 12) % span4);
    } else {
        rangeIndex = Math.floor(Math.random() * INDIAN_IP_RANGES.length);
        const range = INDIAN_IP_RANGES[rangeIndex];
        
        const span1 = range.end[0] - range.start[0] + 1;
        const span2 = range.end[1] - range.start[1] + 1;
        const span3 = range.end[2] - range.start[2] + 1;
        const span4 = range.end[3] - range.start[3] + 1;

        r1 = range.start[0] + Math.floor(Math.random() * span1);
        r2 = range.start[1] + Math.floor(Math.random() * span2);
        r3 = range.start[2] + Math.floor(Math.random() * span3);
        r4 = range.start[3] + Math.floor(Math.random() * span4);
    }

    return `${r1}.${r2}.${r3}.${r4}`;
}

const USER_AGENTS_POOL = [
    // Chrome Android
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36',
    // Chrome iOS / Safari iOS
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
    // Chrome Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    // Chrome macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    // Firefox
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/120.0'
];

export function getRotatedHeaders(seed?: string): Record<string, string> {
    let userAgent: string;
    if (seed) {
        const hash = hashCode(seed);
        userAgent = USER_AGENTS_POOL[hash % USER_AGENTS_POOL.length];
    } else {
        userAgent = USER_AGENTS_POOL[Math.floor(Math.random() * USER_AGENTS_POOL.length)];
    }
    const ip = getRandomIP(seed);
    
    const headers: Record<string, string> = {
        'User-Agent': userAgent,
        'X-Forwarded-For': ip,
        'X-Real-IP': ip,
        'client-ip': ip,
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
        'Accept': '*/*',
        'Connection': 'keep-alive',
        'Referer': 'https://www.jiosaavn.com/'
    };

    if (userAgent.includes('Chrome')) {
        headers['sec-ch-ua-mobile'] = userAgent.includes('Mobile') ? '?1' : '?0';
        if (userAgent.includes('Android')) {
            headers['sec-ch-ua-platform'] = '"Android"';
        } else if (userAgent.includes('Windows')) {
            headers['sec-ch-ua-platform'] = '"Windows"';
        } else if (userAgent.includes('Macintosh')) {
            headers['sec-ch-ua-platform'] = '"macOS"';
        }
    }

    return headers;
}

export interface JiosaavnSong {
    title: string;
    token: string;
    url: string;
    imageUrl?: string;
    artist?: string;
    description?: string;
}

export interface JiosaavnMetadata {
    id?: string;
    has_lyrics?: boolean;
    title: string;
    artist: string;
    album?: string;
    imageUrl?: string;
    duration_ms: number;
    downloadLinks: {
        quality: string;
        url: string;
    }[];
}

function decodeHTMLEntities(str: string): string {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&apos;/g, "'")
        .trim();
}

function decrypt(encryptedData: string): string {
    const key = CryptoJS.enc.Utf8.parse('38346591');
    const decrypted = CryptoJS.DES.decrypt(
        { ciphertext: CryptoJS.enc.Base64.parse(encryptedData) } as any,
        key,
        {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7
        }
    );
    return decrypted.toString(CryptoJS.enc.Utf8).trim();
}

function getDownloadLinks(decryptedUrl: string) {
    if (!decryptedUrl) return [];

    const extMatch = decryptedUrl.match(/(_96)\.(mp4|aac)$/);
    if (!extMatch) {
        return [{ quality: '96kbps', url: decryptedUrl }];
    }

    const ext = extMatch[2]; // mp4 or aac
    const baseUrl = decryptedUrl.replace(/_96\.(mp4|aac)$/, '');

    return [
        { quality: '96kbps', url: `${baseUrl}_96.${ext}` },
        { quality: '160kbps', url: `${baseUrl}_160.${ext}` },
        { quality: '320kbps', url: `${baseUrl}_320.${ext}` }
    ];
}

export class JiosaavnService {
    /**
     * Search songs using JioSaavn autocomplete api
     */
    static async searchSongs(query: string): Promise<JiosaavnSong[]> {
        try {
            const searchUrl = `https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(query)}`;
            
            console.log(`[JiosaavnService] Searching: ${searchUrl}`);
            const response = await axios.get(searchUrl, {
                headers: getRotatedHeaders(query),
                timeout: 2000
            });

            const data = response.data;
            const results: JiosaavnSong[] = [];

            if (data && data.songs && Array.isArray(data.songs.data)) {
                for (const song of data.songs.data) {
                    if (!song.url) continue;
                    
                    const token = song.url.split('/').pop();
                    if (!token) continue;

                    // Clean image URL to get high quality cover
                    let imageUrl = song.image || '';
                    if (imageUrl) {
                        imageUrl = imageUrl.replace('150x150', '500x500').replace('50x50', '500x500');
                    }

                    results.push({
                        title: decodeHTMLEntities(song.title),
                        token: token,
                        url: song.url,
                        imageUrl: imageUrl,
                        artist: decodeHTMLEntities(song.music || song.description || 'Unknown Artist'),
                        description: decodeHTMLEntities(song.description)
                    });
                }
            }

            return results;
        } catch (error) {
            console.error('[JiosaavnService] Search Error:', (error as Error).message);
            return [];
        }
    }

    /**
     * Fetch complete song metadata and decrypt media URLs
     */
    static async getSongMetadata(token: string): Promise<JiosaavnMetadata | null> {
        try {
            const url = `https://www.jiosaavn.com/api.php?__call=webapi.get&token=${token}&type=song&includeMetaTags=0&ctx=wap6dot0&api_version=4&_format=json&_marker=0`;
            
            console.log(`[JiosaavnService] Metadata Fetching: ${token}`);
            const response = await axios.get(url, {
                headers: getRotatedHeaders(token),
                timeout: 2000
            });

            const song = response.data?.songs?.[0];
            if (!song) {
                console.warn(`[JiosaavnService] No song found for token: ${token}`);
                return null;
            }

            const encUrl = song.more_info?.encrypted_media_url;
            if (!encUrl) {
                console.warn(`[JiosaavnService] No encrypted media URL for token: ${token}`);
                return null;
            }

            const decryptedUrl = decrypt(encUrl);
            if (!decryptedUrl) {
                console.warn(`[JiosaavnService] Decryption failed for token: ${token}`);
                return null;
            }

            let imageUrl = song.image || '';
            if (imageUrl) {
                imageUrl = imageUrl.replace('150x150', '500x500').replace('50x50', '500x500');
            }

            let artist = 'Unknown Artist';
            const primaryArtists = song.more_info?.artistMap?.primary_artists;
            if (Array.isArray(primaryArtists) && primaryArtists.length > 0) {
                artist = primaryArtists.map((a: any) => a.name).join(', ');
            } else if (song.subtitle) {
                artist = song.subtitle.split(' - ')[0].trim();
            } else if (song.more_info?.singers) {
                artist = song.more_info.singers;
            } else if (song.more_info?.music) {
                artist = song.more_info.music;
            }

            const durationSec = parseInt(song.more_info?.duration || song.duration) || 0;

            return {
                id: song.id,
                has_lyrics: song.more_info?.has_lyrics === 'true',
                title: decodeHTMLEntities(song.title),
                artist: decodeHTMLEntities(artist),
                album: decodeHTMLEntities(song.more_info?.album || song.album),
                imageUrl: imageUrl,
                duration_ms: durationSec * 1000,
                downloadLinks: getDownloadLinks(decryptedUrl)
            };
        } catch (error) {
            console.error('[JiosaavnService] Metadata Error:', (error as Error).message);
            return null;
        }
    }
}
