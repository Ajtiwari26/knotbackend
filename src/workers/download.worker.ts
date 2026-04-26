import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';

dotenv.config();

const COOKIE_PATH = '/tmp/youtube-cookies.txt';
const hasCookies = fs.existsSync(COOKIE_PATH);

const TMP_DIR = path.join(__dirname, '../../tmp');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const ALGORITHM = 'aes-256-cbc';

/**
 * REPLACED BULLMQ: Now a standard async function to avoid Redis limits.
 */
export async function processDownload(youtube_id: string) {
  console.log(`[Worker] Started processing download for ${youtube_id}`);
  
  const ytUrl = `https://www.youtube.com/watch?v=${youtube_id}`;
  const rawFilePath = path.join(TMP_DIR, `${youtube_id}_raw.mp3`);
  const encryptedFilePath = path.join(TMP_DIR, `${youtube_id}_enc.bin`);
  
  try {
    // 1. Download MP3 via yt-dlp CLI
    console.log(`[Worker] Downloading audio for ${youtube_id}...`);
    const cookieFlag = hasCookies ? `--cookies ${COOKIE_PATH}` : '';
    const dlCommand = [
      'yt-dlp',
      cookieFlag,
      '-x --audio-format mp3',
      `--output "${rawFilePath}"`,
      '--no-check-certificates',
      '--no-warnings',
      '--force-ipv4',
      `"${ytUrl}"`,
    ].filter(Boolean).join(' ');

    await new Promise<void>((resolve, reject) => {
      exec(dlCommand, { timeout: 120000 }, (error, _stdout, stderr) => {
        if (error) {
          console.error(`[Worker] yt-dlp stderr: ${stderr}`);
          return reject(new Error(stderr || error.message));
        }
        resolve();
      });
    });
    
    // 2. Encrypt the file
    console.log(`[Worker] Encrypting audio for ${youtube_id}...`);
    
    const key = Buffer.from(process.env.APP_SECRET || '12345678901234567890123456789012', 'utf-8');
    const validKey = crypto.createHash('sha256').update(key).digest();
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(ALGORITHM, validKey, iv);
    
    const input = fs.createReadStream(rawFilePath);
    const output = fs.createWriteStream(encryptedFilePath);
    
    output.write(iv);
    
    await new Promise((resolve, reject) => {
      input.pipe(cipher).pipe(output)
        .on('finish', resolve)
        .on('error', reject);
    });

    // 3. Upload to MongoDB GridFS
    console.log(`[Worker] Uploading encrypted audio to GridFS...`);
    
    if (!mongoose.connection.db) {
        throw new Error('Database connection not established');
    }
    
    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'audio_buffers'
    });
    
    const fileStream = fs.createReadStream(encryptedFilePath);
    const gridfsFilename = `encrypted-audio/${youtube_id}.bin`;
    
    const uploadStream = bucket.openUploadStream(gridfsFilename);
    
    await new Promise((resolve, reject) => {
        fileStream.pipe(uploadStream)
            .on('error', reject)
            .on('finish', resolve);
    });
    
    console.log(`[Worker] Download completed for ${youtube_id}, GridFS ID: ${uploadStream.id}`);
    
    // Clean up temp files
    if (fs.existsSync(rawFilePath)) fs.unlinkSync(rawFilePath);
    if (fs.existsSync(encryptedFilePath)) fs.unlinkSync(encryptedFilePath);

    return {
      success: true,
      gridfs_id: uploadStream.id.toString(),
      youtube_id
    };
  } catch (error) {
    console.error(`[Worker] Error processing ${youtube_id}:`, error);
    if (fs.existsSync(rawFilePath)) fs.unlinkSync(rawFilePath);
    if (fs.existsSync(encryptedFilePath)) fs.unlinkSync(encryptedFilePath);
    throw error;
  }
}
