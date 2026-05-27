import { Router, Request, Response } from 'express';
import { AppConfig, getDefaultAppConfig } from '../models/AppConfig';

const router = Router();

/**
 * GET /api/config/app
 * Returns the current app configuration. Seeds a default if none exists.
 */
router.get('/app', async (_req: Request, res: Response) => {
  try {
    let config = await AppConfig.findOne().lean();

    if (!config) {
      // Seed default config on first access
      console.log('[ConfigRoutes] No app config found. Seeding default...');
      const defaultConfig = getDefaultAppConfig();
      const created = await AppConfig.create(defaultConfig);
      config = created.toObject();
      console.log('[ConfigRoutes] Default app config seeded successfully.');
    }

    res.json({ success: true, config });
  } catch (error) {
    console.error('[ConfigRoutes] Error fetching app config:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch app config' });
  }
});

/**
 * PUT /api/config/app
 * Updates the app configuration. Creates one if it doesn't exist.
 * Body: partial config object (deep-merged with existing)
 */
router.put('/app', async (req: Request, res: Response) => {
  try {
    const updates = req.body;

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No update data provided' });
    }

    // Always bump version and timestamp
    updates.updated_at = new Date();

    let config = await AppConfig.findOne();

    if (!config) {
      // Create with defaults + overrides
      const defaultConfig = getDefaultAppConfig();
      const merged = { ...defaultConfig, ...updates, config_version: 1 };
      config = await AppConfig.create(merged);
    } else {
      // Increment config version
      updates.config_version = (config.config_version || 0) + 1;

      // Use $set for top-level fields
      await AppConfig.updateOne({ _id: config._id }, { $set: updates });
      config = await AppConfig.findById(config._id);
    }

    console.log(`[ConfigRoutes] App config updated to version ${config?.config_version}`);
    res.json({ success: true, config });
  } catch (error) {
    console.error('[ConfigRoutes] Error updating app config:', error);
    res.status(500).json({ success: false, error: 'Failed to update app config' });
  }
});

export default router;
