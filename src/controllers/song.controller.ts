import { Request, Response } from 'express';
import Song from '../models/Song';
import { processDownload } from '../workers/download.worker';
import dotenv from 'dotenv';

dotenv.config();

/**
 * REPLACED BULLMQ: Enqueues download in background using native async/await
 */
export const enqueueDownload = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params; // youtube_id
    
    // Start processing in background (don't await so we can return 202)
    processDownload(id).catch(err => {
      console.error(`[Controller] Background download failed for ${id}:`, err);
    });
    
    res.status(202).json({
      message: 'Download started in background',
      youtube_id: id
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getSongMetadata = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const song = await Song.findOne({ youtube_id: id });
    
    if (!song) {
       res.status(404).json({ error: 'Song not found' });
       return;
    }
    
    res.status(200).json(song);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const syncLocalKnot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { local_id, title, artist, duration_ms, nodes } = req.body;
    
    if (!local_id) {
       res.status(400).json({ error: 'local_id is required' });
       return;
    }

    let song = await Song.findOne({ local_id });
    
    if (song) {
      song.nodes = nodes;
      await song.save();
    } else {
      song = new Song({
        local_id,
        title,
        artist,
        duration_ms,
        nodes,
        source: 'local'
      });
      await song.save();
    }
    
    res.status(200).json(song);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getLocalKnot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { local_id } = req.params;
    const song = await Song.findOne({ local_id });
    
    if (!song) {
       res.status(404).json({ error: 'Local knot not found' });
       return;
    }
    
    res.status(200).json(song);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
