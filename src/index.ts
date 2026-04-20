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
import './workers/download.worker';

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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
