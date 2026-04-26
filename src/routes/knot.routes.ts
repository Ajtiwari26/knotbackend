import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import KnotVersion from '../models/KnotVersion';
import { protect, AuthRequest } from '../middleware/auth';
import { DistributedGateway } from '../services/distributed-gateway.service';
import { GroqService } from '../services/groq.service';

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
 * TIER 2: FAST (Distributed) — Audio Analysis Gateway
 * Streams knots as they are processed by the engine cluster.
 */
router.get('/auto-knot-stream', async (req: Request, res: Response) => {
  const { youtube_id, sensitivity = 'balanced', stream_url } = req.query;

  if (!youtube_id) {
    return res.status(400).json({ error: 'youtube_id is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  console.log(`[SSE] Starting Distributed Analysis for ${youtube_id}`);

  try {
    // ── STEP 1: Smart Check (Try Transcript/Groq First) ──
    try {
      console.log(`[SSE] Checking for transcript for ${youtube_id}...`);
      const groqResult = await GroqService.analyzeWithTranscript(youtube_id as string);
      
      // If we found a transcript, send it immediately as an SSE sequence
      res.write(`data: ${JSON.stringify({ 
        type: 'meta', 
        duration: groqResult.sections[groqResult.sections.length-1]?.start_ms / 1000 || 0, 
        numNodes: 1 
      })}\n\n`);
      
      res.write(`data: ${JSON.stringify({ 
        type: 'done', 
        junctions: groqResult.junctions, 
        sections: groqResult.sections, 
        lyrics: groqResult.lyrics,
        summary: groqResult.summary,
        method: 'groq_instant' 
      })}\n\n`);
      
      res.end();
      return;
    } catch (e) {
      console.log(`[SSE] No transcript found or Groq failed. Falling back to DSP engine.`);
    }

    // ── STEP 2: Fallback to Distributed DSP ──
    const generator = DistributedGateway.streamAnalyze(
      youtube_id as string, 
      sensitivity as string, 
      stream_url as string
    );
    for await (const update of generator) {
      res.write(`data: ${JSON.stringify(update)}\n\n`);
    }
    res.write('data: {"type": "done"}\n\n');
    res.end();
  } catch (error) {
    console.error('[SSE] Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: (error as Error).message })}\n\n`);
    res.end();
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
    const { song_title, duration_ms, sensitivity = 'balanced', youtube_id, stream_url } = req.body;

    if (youtube_id) {
      console.log(`[AutoKnot] Using Distributed Gateway for YouTube ID: ${youtube_id}`);
      const result = await DistributedGateway.analyzeYoutube(youtube_id, sensitivity, stream_url);
      res.json({
        ...result,
        knot_count: result.junctions.length,
        method: 'distributed'
      });
      return;
    }

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
    const { song_title, duration_ms, sensitivity = 'balanced', youtube_id, stream_url } = req.body;

    if (youtube_id) {
      console.log(`[AutoKnot] Pro: Using Distributed Gateway for YouTube ID: ${youtube_id}`);
      // In a real Pro tier, we might use Modal or more nodes. 
      // For now, we reuse the distributed gateway but could increase nodes if available.
      const result = await DistributedGateway.analyzeYoutube(youtube_id, sensitivity, stream_url);
      res.json({
        ...result,
        knot_count: result.junctions.length,
        method: 'distributed_pro'
      });
      return;
    }

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

/**
 * TIER 1.5: GROQ — Instant Transcript-Based Analysis
 */
router.post('/auto-knot-groq', async (req: Request, res: Response): Promise<void> => {
  try {
    const { youtube_id } = req.body;
    if (!youtube_id) {
      res.status(400).json({ error: 'youtube_id is required' });
      return;
    }
    const result = await GroqService.analyzeWithTranscript(youtube_id);
    res.json({ ...result, method: 'groq_llama_70b' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * TIER 1.5: GROQ — Courier Mode (Client provides transcript)
 */
router.post('/auto-knot-groq-client', async (req: Request, res: Response): Promise<void> => {
  try {
    const { youtube_id, transcript } = req.body;
    if (!youtube_id || !transcript) {
      res.status(400).json({ error: 'youtube_id and transcript are required' });
      return;
    }
    const result = await GroqService.analyzeClientTranscript(transcript, youtube_id);
    res.json({ ...result, method: 'groq_courier' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
