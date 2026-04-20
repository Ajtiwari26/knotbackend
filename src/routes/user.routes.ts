import { Router, Request, Response } from 'express';
import User from '../models/User';
import Notification from '../models/Notification';
import Download from '../models/Download';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/me', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    
    user.displayName = req.body.displayName || user.displayName;
    user.avatar = req.body.avatar || user.avatar;
    user.bio = req.body.bio || user.bio;
    
    await user.save();
    res.json({
      _id: user._id,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/me/notifications', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const notifications = await Notification.find({ user_id: req.user?.id }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.put('/me/notifications/:id/read', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification || notification.user_id.toString() !== req.user?.id) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    notification.read = true;
    await notification.save();
    res.json(notification);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/me/downloads', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const downloads = await Download.find({ user_id: req.user?.id })
      .populate('song_id')
      .populate('knot_version_id')
      .sort({ downloaded_at: -1 });
    res.json(downloads);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
