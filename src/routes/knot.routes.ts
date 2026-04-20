import { Router, Request, Response } from 'express';
import KnotVersion from '../models/KnotVersion';
import { protect, AuthRequest } from '../middleware/auth';
import redisClient from '../config/redis';

const router = Router();

router.post('/', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { song_id, name, junctions, is_public, knotted_duration_ms, original_duration_ms } = req.body;
    const knot = await KnotVersion.create({
      song_id,
      creator_id: req.user?.id,
      name,
      junctions,
      is_public,
      knotted_duration_ms,
      original_duration_ms
    });
    res.status(201).json(knot);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/song/:songId', async (req: Request, res: Response): Promise<void> => {
  try {
    const knots = await KnotVersion.find({ song_id: req.params.songId, is_public: true })
      .populate('creator_id', 'displayName avatar')
      .sort({ total_plays: -1 });
    res.json(knots);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/user/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const knots = await KnotVersion.find({ creator_id: req.params.userId, is_public: true })
      .populate('song_id', 'title artist thumbnail');
    res.json(knots);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/trending', async (req: Request, res: Response): Promise<void> => {
  try {
    // In a real app, use Redis sorted sets. Here we just sort by total_plays.
    const knots = await KnotVersion.find({ is_public: true })
      .sort({ total_plays: -1 })
      .limit(20)
      .populate('song_id', 'title artist thumbnail')
      .populate('creator_id', 'displayName avatar');
    res.json(knots);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:id', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const knot = await KnotVersion.findById(req.params.id);
    if (!knot) {
      res.status(404).json({ error: 'Knot not found' });
      return;
    }
    if (knot.creator_id.toString() !== req.user?.id) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    await KnotVersion.deleteOne({ _id: knot._id });
    res.json({ message: 'Knot removed' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
