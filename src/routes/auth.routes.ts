import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { protect, AuthRequest } from '../middleware/auth';
import mongoose from 'mongoose';
import * as admin from 'firebase-admin';
import { initializeFirebase } from '../config/firebase';
import Otp from '../models/Otp';
import { sendOTPSMS } from '../services/sms.service';

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
 * Helper to verify Firebase ID Token (supporting dev mock verification)
 */
async function verifyFirebaseToken(idToken: string): Promise<{
  uid: string;
  email?: string;
  phone_number?: string;
  name?: string;
  picture?: string;
}> {
  // Support dev mock token for frictionless local development
  if (process.env.NODE_ENV !== 'production' && idToken.startsWith('mock_')) {
    console.log('Using developer mock Firebase verification for token:', idToken);
    
    // Format: mock_uid=123&email=test@test.com&name=Test+User&phone=%2B12345
    const params = new URLSearchParams(idToken.replace('mock_', ''));
    return {
      uid: params.get('uid') || 'mock_uid_' + Date.now(),
      email: params.get('email') || undefined,
      phone_number: params.get('phone') || undefined,
      name: params.get('name') || undefined,
      picture: params.get('picture') || undefined,
    };
  }

  // Verify token using the official Firebase Admin SDK
  const app = initializeFirebase();
  if (!app) {
    throw new Error('Firebase Admin SDK is not initialized. If testing locally, you can pass a token starting with "mock_".');
  }

  const decodedToken = await admin.auth().verifyIdToken(idToken);
  return {
    uid: decodedToken.uid,
    email: decodedToken.email,
    phone_number: decodedToken.phone_number,
    name: decodedToken.name,
    picture: decodedToken.picture,
  };
}

/**
 * Send OTP using SMSGatewayHub (custom server-side OTP flow)
 */
router.post('/phone/send-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      res.status(400).json({ error: 'phoneNumber is required' });
      return;
    }

    // Generate random 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Upsert OTP record in transient Mongoose collection
    await Otp.findOneAndUpdate(
      { phoneNumber },
      { phoneNumber, otp, createdAt: new Date() },
      { upsert: true, returnDocument: 'after' }
    );

    // Call SMS Gateway Hub API
    const smsResult = await sendOTPSMS(phoneNumber, otp);

    if (!smsResult.success) {
      throw new Error(smsResult.error || 'Failed to dispatch SMS through gateway');
    }

    res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Verify OTP using SMSGatewayHub (custom server-side OTP flow)
 */
router.post('/phone/verify-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber, otp } = req.body;
    if (!phoneNumber || !otp) {
      res.status(400).json({ error: 'phoneNumber and otp are required' });
      return;
    }

    // Find the OTP record in the transient database
    const otpRecord = await Otp.findOne({ phoneNumber, otp });
    if (!otpRecord) {
      res.status(400).json({ error: 'Invalid or expired OTP code' });
      return;
    }

    // Remove the OTP record immediately to prevent re-use
    await Otp.deleteOne({ _id: otpRecord._id });

    // Look up or register Mongoose User
    let user = await User.findOne({ phoneNumber });
    if (!user) {
      user = await User.create({
        phoneNumber,
        displayName: phoneNumber,
        wallet_balance: 0
      });
      console.log(`Registered new user via SMS Gateway Hub OTP: ${user._id}`);
    }

    res.status(200).json({
      _id: user._id,
      displayName: user.displayName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      avatar: user.avatar,
      bio: user.bio,
      wallet_balance: user.wallet_balance,
      isGuest: false,
      token: generateToken(user._id.toString()),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Handle Firebase Authentication (Google or Phone)
 */
router.post('/firebase', async (req: Request, res: Response): Promise<void> => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      res.status(400).json({ error: 'idToken is required' });
      return;
    }

    // Verify token and extract profile info
    const decoded = await verifyFirebaseToken(idToken);
    const { uid, email, phone_number, name, picture } = decoded;

    // 1. Try to find user by firebaseUid
    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      // 2. Try to find user by email (for Google Sign-In linking)
      if (email) {
        user = await User.findOne({ email });
      }
      
      // 3. Try to find user by phone number (for Phone OTP linking)
      if (!user && phone_number) {
        user = await User.findOne({ phoneNumber: phone_number });
      }

      if (user) {
        // Link the existing account
        user.firebaseUid = uid;
        if (picture && !user.avatar) user.avatar = picture;
        await user.save();
        console.log(`Linked existing user: ${user._id} to Firebase UID: ${uid}`);
      } else {
        // Create a new user
        user = await User.create({
          firebaseUid: uid,
          email: email || undefined,
          phoneNumber: phone_number || undefined,
          displayName: name || phone_number || 'Knot User',
          avatar: picture || '',
          wallet_balance: 0,
        });
        console.log(`Registered new Firebase user: ${user._id} with UID: ${uid}`);
      }
    }

    res.status(200).json({
      _id: user._id,
      displayName: user.displayName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      avatar: user.avatar,
      bio: user.bio,
      wallet_balance: user.wallet_balance,
      isGuest: false,
      token: generateToken(user._id.toString()),
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
      isGuest: user.email ? user.email.endsWith('@knot.local') : false,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
