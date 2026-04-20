import { Router, Request, Response } from 'express';
import { getSongMetadata, enqueueDownload, createSong } from '../controllers/song.controller';
import Song from '../models/Song';
import youtubedl from 'youtube-dl-exec';
import mongoose from 'mongoose';
import { GridFSBucket, ObjectId } from 'mongodb';

const router = Router();

router.get('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q) {
      res.json([]);
      return;
    }
    
    // Future: implement googleapis youtube data API search here
    
    const songs = await Song.find({ title: { $regex: q, $options: 'i' } }).limit(20);
    res.json(songs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:id/stream-url', async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const ytUrl = `https://www.youtube.com/watch?v=${id}`;
        
        const output = await youtubedl(ytUrl, {
            getUrl: true,
            format: 'bestaudio',
            noCheckCertificates: true,
            noWarnings: true
        });
        
        // youtube-dl-exec returns the raw string from stdout
        res.json({ streamUrl: output });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

router.get('/downloads/:gridfs_id', async (req: Request, res: Response): Promise<void> => {
    try {
        if (!mongoose.connection.db) {
            res.status(500).json({ error: 'DB not connected' });
            return;
        }
        
        const bucket = new GridFSBucket(mongoose.connection.db, {
            bucketName: 'audio_buffers'
        });
        
        const downloadStream = bucket.openDownloadStream(new ObjectId(req.params.gridfs_id as string));
        
        res.set('Content-Type', 'application/octet-stream');
        downloadStream.pipe(res);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

router.get('/trending', async (req: Request, res: Response): Promise<void> => {
  try {
    const songs = await Song.find().sort({ play_count: -1 }).limit(20);
    res.json(songs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/feed', async (req: Request, res: Response): Promise<void> => {
  try {
    const recentlyAdded = await Song.find().sort({ createdAt: -1 }).limit(10);
    const popular = await Song.find().sort({ play_count: -1 }).limit(10);
    res.json({ recentlyAdded, popular });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/', createSong);
router.get('/:id', getSongMetadata);
router.post('/:id/download', enqueueDownload);

export default router;
