import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

export default redisClient;
