import { Request, Response } from 'express';
import Song from '../models/Song';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const connection = new IORedis({
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

export const createSong = async (req: Request, res: Response): Promise<void> => {
  try {
    const { youtube_id, title, thumbnail, nodes } = req.body;
    
    const newSong = new Song({
      youtube_id,
      title,
      thumbnail,
      nodes
    });
    
    await newSong.save();
    res.status(201).json(newSong);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
