import { Request, Response } from 'express';
import Song from '../models/Song';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const connection = process.env.REDIS_URL 
  ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: null
    });

export const downloadQueue = new Queue('download-queue', { connection });

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

export const enqueueDownload = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params; // youtube_id
    
    // Add job to BullMQ
    const job = await downloadQueue.add('download-song', {
      youtube_id: id
    });
    
    res.status(202).json({
      message: 'Download enqueued',
      jobId: job.id
    });
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
