import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { getStreamUrl } from './youtube.service';

const execPromise = util.promisify(exec);

const ENGINE_PORTS = [5001, 5002, 5003];
const OVERLAP_SEC = 15;

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
  static async getDuration(url: string): Promise<number> {
    const result = await execPromise(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`
    );
    return parseFloat(result.stdout.trim());
  }

  static async analyzeYoutube(youtubeId: string, sensitivity: string = 'balanced', clientStreamUrl?: string): Promise<DistributedKnotResponse> {
    const startTime = Date.now();
    const generator = this.streamAnalyze(youtubeId, sensitivity, clientStreamUrl);
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

  static async *streamAnalyze(youtubeId: string, sensitivity: string = 'balanced', clientStreamUrl?: string): AsyncGenerator<any> {
    const streamUrl = clientStreamUrl || await getStreamUrl(youtubeId);
    const duration = await this.getDuration(streamUrl);
    
    yield { type: 'meta', duration, numNodes: ENGINE_PORTS.length };

    const numChunks = ENGINE_PORTS.length;
    const chunkDuration = duration / numChunks;
    const tempDir = path.join(process.cwd(), 'temp_chunks', youtubeId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    try {
      const resultsQueue: any[] = [];
      let finishedCount = 0;
      let resolver: ((v: any) => void) | null = null;

      const processChunk = async (port: number, i: number) => {
        try {
          const ownedStart = i * chunkDuration;
          const ownedEnd = Math.min((i + 1) * chunkDuration, duration);
          const cutStart = Math.max(0, ownedStart - OVERLAP_SEC);
          const cutEnd = Math.min(duration, ownedEnd + OVERLAP_SEC);
          const outPath = path.join(tempDir, `chunk_${i}.m4a`);

          await execPromise(`ffmpeg -y -ss ${cutStart} -i "${streamUrl}" -t ${cutEnd - cutStart} -c copy "${outPath}"`);
          
          const result = await execPromise(
            `curl -s -X POST -F "file=@${outPath}" -F "sensitivity=${sensitivity}" http://localhost:${port}/analyze`
          );
          
          let data = JSON.parse(result.stdout);
          const offsetMs = cutStart * 1000;
          const knots = (data.junctions || [])
            .map((j: any) => ({ start_ms: j.start_ms + offsetMs, end_ms: j.end_ms + offsetMs }))
            .filter((j: any) => j.start_ms >= ownedStart * 1000 && j.end_ms <= ownedEnd * 1000);
          
          resultsQueue.push({ type: 'chunk', chunkIndex: i, junctions: knots });
        } catch (e) {
          resultsQueue.push({ type: 'chunk', chunkIndex: i, junctions: [], error: true });
        } finally {
          finishedCount++;
          if (resolver) resolver(true);
        }
      };

      ENGINE_PORTS.forEach((port, i) => processChunk(port, i));

      while (finishedCount < ENGINE_PORTS.length || resultsQueue.length > 0) {
        if (resultsQueue.length > 0) {
          yield resultsQueue.shift();
        } else {
          await new Promise(r => { resolver = r; });
          resolver = null;
        }
      }
    } finally {
      // Cleanup
      if (fs.existsSync(tempDir)) {
        // fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
}
