import { Router, Request, Response } from 'express';
import Playlist from '../models/Playlist';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description, cover_image, is_public } = req.body;
    const playlist = await Playlist.create({
      owner_id: req.user?.id,
      title,
      description,
      cover_image,
      is_public
    });
    res.status(201).json(playlist);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/user/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const playlists = await Playlist.find({ owner_id: req.params.userId, is_public: true });
    res.json(playlists);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/:id', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (playlist.owner_id.toString() !== req.user?.id) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    
    // update logic...
    Object.assign(playlist, req.body);
    await playlist.save();
    
    res.json(playlist);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/:id', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      res.status(404).json({ error: 'Playlist not found' });
      return;
    }
    if (playlist.owner_id.toString() !== req.user?.id) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    await Playlist.deleteOne({ _id: playlist._id });
    res.json({ message: 'Playlist removed' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
