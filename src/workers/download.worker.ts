import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import youtubedl from 'youtube-dl-exec';
import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';

dotenv.config();

const connection = process.env.REDIS_URL 
  ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: null
    });

const TMP_DIR = path.join(__dirname, '../../tmp');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const ALGORITHM = 'aes-256-cbc';

export const downloadWorker = new Worker('download-queue', async (job: Job) => {
  const { youtube_id } = job.data;
  console.log(`[Worker] Started processing job for ${youtube_id}`);
  
  const ytUrl = `https://www.youtube.com/watch?v=${youtube_id}`;
  const rawFilePath = path.join(TMP_DIR, `${youtube_id}_raw.mp3`);
  const encryptedFilePath = path.join(TMP_DIR, `${youtube_id}_enc.bin`);
  
  try {
    // 1. Download MP3
    await job.updateProgress(10);
    console.log(`[Worker] Downloading audio for ${youtube_id}...`);
    await youtubedl(ytUrl, {
      extractAudio: true,
      audioFormat: 'mp3',
      output: rawFilePath,
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0']
    });
    
    // 2. Encrypt the file
    await job.updateProgress(50);
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
    await job.updateProgress(75);
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
    
    await job.updateProgress(100);
    console.log(`[Worker] Job completed for ${youtube_id}, stored in GridFS id: ${uploadStream.id}`);
    
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
}, { connection });

downloadWorker.on('completed', job => {
  console.log(`Job with id ${job.id} has been completed`);
});

downloadWorker.on('failed', (job, err) => {
  console.log(`Job with id ${job?.id} has failed with ${err.message}`);
});
