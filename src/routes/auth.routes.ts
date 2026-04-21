import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';
import mongoose from 'mongoose';

const router = Router();

const generateToken = (id: string) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'fallback_secret', {
    expiresIn: '30d',
  });
};

/**
 * Register a new user
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password || !displayName) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      res.status(400).json({ error: 'User already exists' });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      email,
      password: hashedPassword,
      displayName,
    });

    res.status(201).json({
      _id: user._id,
      displayName: user.displayName,
      email: user.email,
      isGuest: false,
      token: generateToken(user._id.toString()),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Login with email + password
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');

    if (user && (await bcrypt.compare(password, user.password as string))) {
      res.json({
        _id: user._id,
        displayName: user.displayName,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        isGuest: false,
        token: generateToken(user._id.toString()),
      });
    } else {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Guest mode — creates a temporary user with no email/password.
 * Returns a valid JWT so protected routes work.
 */
router.post('/guest', async (req: Request, res: Response): Promise<void> => {
  try {
    const guestId = new mongoose.Types.ObjectId();
    const guestUser = await User.create({
      _id: guestId,
      email: `guest_${guestId}@knot.local`,
      displayName: 'Guest',
      bio: 'Exploring Knot in guest mode',
      wallet_balance: 0,
    });

    res.status(201).json({
      _id: guestUser._id,
      displayName: guestUser.displayName,
      email: guestUser.email,
      avatar: null,
      bio: guestUser.bio,
      isGuest: true,
      token: generateToken(guestUser._id.toString()),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Get current user profile
 */
router.get('/me', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user?.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      _id: user._id,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio,
      wallet_balance: user.wallet_balance,
      isGuest: user.email.endsWith('@knot.local'),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
