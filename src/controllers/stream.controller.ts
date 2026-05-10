import { Request, Response } from 'express';
import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const streamPagalworld = async (req: Request, res: Response): Promise<void> => {
    const { year, month, file } = req.query;

    if (!year || !month || !file) {
        res.status(400).json({ error: 'Missing parameters: year, month, and file are required.' });
        return;
    }

    const url = `https://pagalworld.is/wp-content/uploads/${year}/${month}/${encodeURIComponent(file as string)}`;

    try {
        const headers: Record<string, string> = {
            'User-Agent': USER_AGENT,
            'Referer': 'https://pagalworld.is/'
        };

        // Forward Range header if present (crucial for seeking)
        if (req.headers.range) {
            headers['Range'] = req.headers.range as string;
        }

        console.log(`[StreamProxy] Requesting: ${url} (Range: ${req.headers.range || 'None'})`);

        const response = await axios({
            method: 'get',
            url: url,
            headers: headers,
            responseType: 'stream',
            validateStatus: (status) => status >= 200 && status < 300 || status === 206
        });

        // Forward essential headers back to the mobile app
        const forwardHeaders = [
            'content-type',
            'content-length',
            'content-range',
            'accept-ranges',
            'etag',
            'last-modified',
            'cache-control'
        ];

        forwardHeaders.forEach(header => {
            if (response.headers[header]) {
                res.setHeader(header, response.headers[header]);
            }
        });

        // Set status code (200 OK or 206 Partial Content)
        res.status(response.status);

        // Pipe the stream directly to the response
        response.data.pipe(res);

        // Handle client disconnection
        req.on('close', () => {
            console.log('[StreamProxy] Client disconnected');
            if (response.data.destroy) {
                response.data.destroy();
            }
        });

    } catch (error: any) {
        console.error('[StreamProxy] Error:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ error: 'Proxy request failed', details: error.message });
        } else {
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }
};
