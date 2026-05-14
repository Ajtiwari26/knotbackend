import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { getStreamUrl } from './youtube.service';

const execPromise = util.promisify(exec);

// Remote auto-knotting engines for distributed processing
const REMOTE_ENGINE_URLS = [
  process.env.AUTO_KNOT_ENGINE_URL_1,
  process.env.AUTO_KNOT_ENGINE_URL_2,
  process.env.AUTO_KNOT_ENGINE_URL_3,
  process.env.AUTO_KNOT_ENGINE_URL_4,
  process.env.AUTO_KNOT_ENGINE_URL_5,
  process.env.AUTO_KNOT_ENGINE_URL_6
].filter(url => url); // Filter out any undefined/empty URLs

// Local engine ports (for testing)
const LOCAL_ENGINE_PORTS = [5001, 5002, 5003];

// Use remote engines by default, fall back to local if USE_LOCAL_ENGINES=true
const USE_LOCAL_ENGINES = process.env.USE_LOCAL_ENGINES === 'true';
const ALL_ENGINE_ENDPOINTS = USE_LOCAL_ENGINES 
  ? LOCAL_ENGINE_PORTS.map(port => `http://localhost:${port}`)
  : REMOTE_ENGINE_URLS;

const OVERLAP_SEC = 15;
const HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds
const ENGINE_REQUEST_TIMEOUT = 600000; // 10 minutes

// Track healthy engines
let healthyEngines: string[] = [...ALL_ENGINE_ENDPOINTS];
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60000; // Re-check every 60 seconds

export interface KnotResult {
  start_ms: number;
  end_ms: number;
}

export interface DistributedKnotResponse {
  junctions: KnotResult[];
  knotted_duration_ms: number;
  original_duration_ms: number;
  processed_in_sec: number;
}

export class DistributedGateway {
  /**
   * Check health of all engines and update the healthy engines list
   */
  static async checkEngineHealth(): Promise<string[]> {
    const now = Date.now();
    
    // Skip if we checked recently
    if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL && healthyEngines.length > 0) {
      return healthyEngines;
    }

    console.log('[DistributedGateway] Checking engine health...');
    const healthChecks = ALL_ENGINE_ENDPOINTS.map(async (engineUrl) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
        
        const response = await fetch(`${engineUrl}/health`, {
          method: 'GET',
          signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (response.ok) {
          console.log(`[DistributedGateway] ✅ ${engineUrl} is healthy`);
          return engineUrl;
        }
        console.log(`[DistributedGateway] ❌ ${engineUrl} returned ${response.status}`);
        return null;
      } catch (error) {
        console.log(`[DistributedGateway] ❌ ${engineUrl} failed: ${(error as Error).message}`);
        return null;
      }
    });

    const results = await Promise.all(healthChecks);
    healthyEngines = results.filter((url): url is string => url !== null);
    lastHealthCheck = now;

    console.log(`[DistributedGateway] ${healthyEngines.length}/${ALL_ENGINE_ENDPOINTS.length} engines healthy`);
    
    if (healthyEngines.length === 0) {
      console.error('[DistributedGateway] ⚠️  No healthy engines available! Using all endpoints as fallback.');
      healthyEngines = [...ALL_ENGINE_ENDPOINTS];
    }

    return healthyEngines;
  }

  /**
   * Get available engines for processing
   */
  static async getAvailableEngines(): Promise<string[]> {
    return await this.checkEngineHealth();
  }

  static async getDuration(url: string): Promise<number> {
    const result = await execPromise(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`
    );
    return parseFloat(result.stdout.trim());
  }

  static async analyzeYoutube(youtubeId: string, sensitivity: string = 'balanced', clientStreamUrl?: string, engine: string = 'fast'): Promise<DistributedKnotResponse> {
    const startTime = Date.now();
    const generator = this.streamAnalyze(youtubeId, sensitivity, clientStreamUrl, engine);
    const allKnots: KnotResult[] = [];
    let originalDuration = 0;

    for await (const update of generator) {
      if (update.type === 'meta') {
        originalDuration = update.duration * 1000;
      } else if (update.type === 'chunk') {
        allKnots.push(...update.junctions);
      }
    }

    allKnots.sort((a, b) => a.start_ms - b.start_ms);
    const knotted_ms = allKnots.reduce((acc, k) => acc + (k.end_ms - k.start_ms), 0);
    const elapsedSec = (Date.now() - startTime) / 1000;

    return {
      junctions: allKnots,
      knotted_duration_ms: knotted_ms,
      original_duration_ms: originalDuration,
      processed_in_sec: elapsedSec
    };
  }

  static async *streamAnalyze(youtubeId: string, sensitivity: string = 'balanced', clientStreamUrl?: string, engine: string = 'fast'): AsyncGenerator<any> {
    const streamUrl = clientStreamUrl || await getStreamUrl(youtubeId);
    const duration = await this.getDuration(streamUrl);
    
    // Get healthy engines
    const availableEngines = await this.getAvailableEngines();
    const numChunks = availableEngines.length;
    
    console.log(`[DistributedGateway] Processing ${duration.toFixed(1)}s song across ${numChunks} engines`);
    yield { type: 'meta', duration, numNodes: numChunks, engines: availableEngines };

    const chunkDuration = duration / numChunks;
    const tempDir = path.join(process.cwd(), 'temp_chunks', youtubeId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    try {
      const resultsQueue: any[] = [];
      let finishedCount = 0;
      let resolver: ((v: any) => void) | null = null;

      const processChunk = async (engineUrl: string, chunkIndex: number, retryCount = 0) => {
        const maxRetries = 2;
        try {
          const ownedStart = chunkIndex * chunkDuration;
          const ownedEnd = Math.min((chunkIndex + 1) * chunkDuration, duration);
          const cutStart = Math.max(0, ownedStart - OVERLAP_SEC);
          const cutEnd = Math.min(duration, ownedEnd + OVERLAP_SEC);
          const outPath = path.join(tempDir, `chunk_${chunkIndex}.m4a`);

          console.log(`[DistributedGateway] Chunk ${chunkIndex}: ${ownedStart.toFixed(1)}s-${ownedEnd.toFixed(1)}s → ${engineUrl}`);

          // Split audio chunk
          await execPromise(`ffmpeg -y -ss ${cutStart} -i "${streamUrl}" -t ${cutEnd - cutStart} -c copy "${outPath}"`);
          
          // Send to engine with timeout
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), ENGINE_REQUEST_TIMEOUT);
          
          const result = await execPromise(
            `curl -s --max-time 600 -X POST -F "file=@${outPath}" -F "sensitivity=${sensitivity}" -F "engine=${engine}" ${engineUrl}/analyze`
          );
          
          clearTimeout(timeout);
          
          let data = JSON.parse(result.stdout);
          
          if (data.error) {
            throw new Error(`Engine error: ${data.error}`);
          }
          
          const offsetMs = cutStart * 1000;
          const knots = (data.junctions || [])
            .map((j: any) => ({ start_ms: j.start_ms + offsetMs, end_ms: j.end_ms + offsetMs }))
            .filter((j: any) => j.start_ms >= ownedStart * 1000 && j.end_ms <= ownedEnd * 1000);
          
          console.log(`[DistributedGateway] ✅ Chunk ${chunkIndex}: ${knots.length} knots found`);
          resultsQueue.push({ type: 'chunk', chunkIndex, junctions: knots, engine: engineUrl });
          
        } catch (error) {
          console.error(`[DistributedGateway] ❌ Chunk ${chunkIndex} failed on ${engineUrl}: ${(error as Error).message}`);
          
          // Retry with a different engine if available
          if (retryCount < maxRetries) {
            const otherEngines = availableEngines.filter(e => e !== engineUrl);
            if (otherEngines.length > 0) {
              const fallbackEngine = otherEngines[retryCount % otherEngines.length];
              console.log(`[DistributedGateway] 🔄 Retrying chunk ${chunkIndex} on ${fallbackEngine} (attempt ${retryCount + 1}/${maxRetries})`);
              return processChunk(fallbackEngine, chunkIndex, retryCount + 1);
            }
          }
          
          // If all retries failed, return empty result
          console.error(`[DistributedGateway] ⚠️  Chunk ${chunkIndex} failed after ${retryCount + 1} attempts`);
          resultsQueue.push({ type: 'chunk', chunkIndex, junctions: [], error: true });
          
        } finally {
          finishedCount++;
          if (resolver) resolver(true);
        }
      };

      // Distribute chunks across available engines
      availableEngines.forEach((engineUrl, i) => processChunk(engineUrl, i));

      // Wait for all chunks to complete
      while (finishedCount < numChunks || resultsQueue.length > 0) {
        if (resultsQueue.length > 0) {
          yield resultsQueue.shift();
        } else {
          await new Promise(r => { resolver = r; });
          resolver = null;
        }
      }
    } finally {
      // Cleanup temp files
      if (fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          console.log(`[DistributedGateway] 🧹 Cleaned up temp directory`);
        } catch (e) {
          console.error(`[DistributedGateway] Failed to cleanup: ${(e as Error).message}`);
        }
      }
    }
  }
}
