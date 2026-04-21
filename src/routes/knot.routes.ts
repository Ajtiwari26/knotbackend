import { Router, Request, Response } from 'express';
import KnotVersion from '../models/KnotVersion';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * Create a new knot
 */
router.post('/', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { song_id, name, junctions, is_public, knotted_duration_ms, original_duration_ms } = req.body;
    const knot = await KnotVersion.create({
      song_id,
      creator_id: req.user?.id,
      name,
      junctions,
      is_public: is_public !== false, // default true
      knotted_duration_ms,
      original_duration_ms,
    });
    res.status(201).json(knot);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Get a single knot by ID
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const knot = await KnotVersion.findById(req.params.id)
      .populate('creator_id', 'displayName avatar')
      .populate('song_id', 'title artist thumbnail youtube_id duration_ms');
    if (!knot) {
      res.status(404).json({ error: 'Knot not found' });
      return;
    }
    res.json(knot);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Increment play count for a knot
 */
router.put('/:id/play', async (req: Request, res: Response): Promise<void> => {
  try {
    const knot = await KnotVersion.findByIdAndUpdate(
      req.params.id,
      { $inc: { total_plays: 1 } },
      { new: true }
    );
    if (!knot) {
      res.status(404).json({ error: 'Knot not found' });
      return;
    }
    res.json({ total_plays: knot.total_plays });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Get all public knots for a song
 */
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

/**
 * Get all knots by a user
 */
router.get('/user/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const knots = await KnotVersion.find({ creator_id: req.params.userId })
      .populate('song_id', 'title artist thumbnail youtube_id');
    res.json(knots);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Trending knots
 */
router.get('/trending', async (_req: Request, res: Response): Promise<void> => {
  try {
    const knots = await KnotVersion.find({ is_public: true })
      .sort({ total_plays: -1 })
      .limit(20)
      .populate('song_id', 'title artist thumbnail youtube_id duration_ms')
      .populate('creator_id', 'displayName avatar');
    res.json(knots);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Delete a knot (only by creator)
 */
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
