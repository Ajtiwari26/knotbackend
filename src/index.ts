import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { connectDB } from './config/db';
import songRoutes from './routes/song.routes';
import authRoutes from './routes/auth.routes';
import knotRoutes from './routes/knot.routes';
import playlistRoutes from './routes/playlist.routes';
import userRoutes from './routes/user.routes';

// Load env before anything else
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Database Connection
connectDB();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/songs', songRoutes);
app.use('/api/knots', knotRoutes);
app.use('/api/playlists', playlistRoutes);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Also support /api/health for the mobile probe
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Increase timeout for long-running auto-knotting requests (10 minutes)
server.timeout = 600000;
server.keepAliveTimeout = 610000;
server.headersTimeout = 620000;
