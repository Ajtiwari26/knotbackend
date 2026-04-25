import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import KnotVersion from '../models/KnotVersion';
import { protect, AuthRequest } from '../middleware/auth';

const upload = multer({ dest: 'uploads/' });

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

// ══════════════════════════════════════════════════════════════
// AUTO-KNOTTING ENGINE — Three-Tier Proxy Routes
// ══════════════════════════════════════════════════════════════

// On Render, the service is named 'autoknotengine' per user confirmation
const AUTO_KNOT_ENGINE_URL = process.env.AUTO_KNOT_ENGINE_URL || 'https://autoknotengine.onrender.com';
const MODAL_PRO_URL = process.env.MODAL_PRO_URL || 'https://YOUR_APP--knot-pro-analyze-web.modal.run';

/**
 * Auto-Knot (Fast) — Proxies to Python DSP engine on Render
 */
router.post('/auto-knot', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { song_title, duration_ms, sensitivity = 'balanced' } = req.body;

    if (!req.file) {
      res.status(400).json({ error: 'Audio file is required' });
      return;
    }

    console.log(`[AutoKnot] Fast analysis requested for: ${song_title}`);
    console.log(`[AutoKnot] Proxying to: ${AUTO_KNOT_ENGINE_URL}/analyze`);

    // Read the uploaded file into a Blob
    const fileBuffer = await fs.promises.readFile(req.file.path);
    const fileBlob = new Blob([fileBuffer], { type: req.file.mimetype || 'audio/mpeg' });

    // Create FormData for the Render API
    const formData = new FormData();
    formData.append('file', fileBlob, req.file.originalname || 'audio.m4a');
    formData.append('sensitivity', sensitivity);
    
    // Pass the original device URI if needed
    if (req.body.song_uri) formData.append('device_uri', req.body.song_uri);

    const startTime = Date.now();
    // Increase timeout to 10 minutes for Render DSP engine
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000);

    const response = await fetch(`${AUTO_KNOT_ENGINE_URL}/analyze`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    const elapsed = Date.now() - startTime;
    console.log(`[AutoKnot] Engine response received in ${elapsed}ms: ${response.status}`);

    // Clean up temporary file
    await fs.promises.unlink(req.file.path).catch(console.error);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AutoKnot] Engine error: ${errorText}`);
      res.status(response.status).json({ error: `Engine error: ${errorText}` });
      return;
    }

    const result = await response.json();
    console.log(`[AutoKnot] Fast analysis complete: ${result.knot_count} knots`);
    res.json(result);
  } catch (error) {
    console.error('[AutoKnot] Fast analysis failed:', error);
    
    // Ensure cleanup on error
    if (req.file) {
      await fs.promises.unlink(req.file.path).catch(() => {});
    }
    
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Auto-Knot Pro — Proxies to Modal.com GPU serverless function
 */
router.post('/auto-knot-pro', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { song_title, duration_ms, sensitivity = 'balanced' } = req.body;

    if (!req.file) {
      res.status(400).json({ error: 'Audio file is required' });
      return;
    }

    console.log(`[AutoKnot] Pro analysis requested for: ${song_title}`);

    // Modal can either accept multipart/form-data or Base64 in JSON depending on the endpoint.
    // For simplicity, we'll forward it as FormData just like the Fast tier
    const fileBuffer = await fs.promises.readFile(req.file.path);
    const fileBlob = new Blob([fileBuffer], { type: req.file.mimetype || 'audio/mpeg' });

    const formData = new FormData();
    formData.append('file', fileBlob, req.file.originalname || 'audio.m4a');
    formData.append('filename', song_title);
    formData.append('sensitivity', sensitivity);

    // Increase timeout to 10 minutes for Modal GPU engine
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000);

    const response = await fetch(MODAL_PRO_URL, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    // Clean up temporary file
    await fs.promises.unlink(req.file.path).catch(console.error);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AutoKnot] Pro engine error: ${errorText}`);
      res.status(response.status).json({ error: `Pro engine error: ${errorText}` });
      return;
    }

    const result = await response.json();
    console.log(`[AutoKnot] Pro analysis complete: ${result.knot_count} knots`);
    res.json(result);
  } catch (error) {
    console.error('[AutoKnot] Pro analysis failed:', error);
    
    // Ensure cleanup on error
    if (req.file) {
      await fs.promises.unlink(req.file.path).catch(() => {});
    }
    
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
