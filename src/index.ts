import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import { connectDB } from './config/db';
import { initializeFirebase } from './config/firebase';
import songRoutes from './routes/song.routes';
import authRoutes from './routes/auth.routes';
import knotRoutes from './routes/knot.routes';
import playlistRoutes from './routes/playlist.routes';
import userRoutes from './routes/user.routes';
import configRoutes from './routes/config.routes';

// Load env before anything else
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Database Connection
connectDB();
initializeFirebase();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/songs', songRoutes);
app.use('/api/song', songRoutes);
app.use('/api/knots', knotRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/config', configRoutes);

app.get('/delete-account', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Delete Account - Knot App</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0A0A0A;
            --surface-color: #121212;
            --primary-color: #FF6D00;
            --text-color: #FFFFFF;
            --text-secondary: #A0A0A0;
            --border-color: rgba(255, 255, 255, 0.08);
        }
        body {
            background-color: var(--bg-color);
            color: var(--text-color);
            font-family: 'Outfit', sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            max-width: 550px;
            width: 100%;
            padding: 40px;
            box-sizing: border-box;
            background-color: var(--surface-color);
            border-radius: 20px;
            border: 1px solid var(--border-color);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            margin: 20px;
        }
        .logo {
            font-size: 32px;
            font-weight: 700;
            color: var(--primary-color);
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .logo span {
            color: var(--text-color);
        }
        h1 {
            font-size: 24px;
            font-weight: 600;
            margin-top: 0;
            margin-bottom: 12px;
        }
        p {
            font-size: 15px;
            line-height: 1.6;
            color: var(--text-secondary);
            margin-bottom: 24px;
        }
        .card {
            background-color: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
        }
        .card h2 {
            font-size: 16px;
            font-weight: 600;
            margin-top: 0;
            margin-bottom: 12px;
            color: var(--primary-color);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .step-list {
            margin: 0;
            padding-left: 20px;
            color: var(--text-secondary);
            font-size: 14px;
        }
        .step-list li {
            margin-bottom: 8px;
            line-height: 1.5;
        }
        .btn-submit {
            display: block;
            width: 100%;
            padding: 14px;
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s ease;
            text-align: center;
            text-decoration: none;
            box-sizing: border-box;
        }
        .btn-submit:hover {
            opacity: 0.9;
        }
        .footer {
            text-align: center;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.3);
            margin-top: 30px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🪢 <span>Knot</span></div>
        <h1>Account & Data Deletion Request</h1>
        <p>If you no longer wish to use Knot and want your personal information and account data deleted, please follow the steps below.</p>
        
        <div class="card">
            <h2>Steps to Request Account Deletion</h2>
            <ol class="step-list">
                <li><strong>In-App Deletion (Recommended)</strong>: Open the Knot app, go to Settings, tap <strong>Delete Account</strong>, and confirm your request. This will queue your account for immediate deletion.</li>
                <li><strong>Email Request</strong>: Send an email to our support team at <a href="mailto:ajay@knotmusic.app" style="color: var(--primary-color); text-decoration: none;">ajay@knotmusic.app</a> with the subject line <strong>"Knot Account Deletion Request"</strong>. Please include the email address or phone number associated with your account.</li>
            </ol>
        </div>

        <div class="card">
            <h2>Data Handling Policy</h2>
            <ul class="step-list">
                <li><strong>Data Deleted</strong>: Upon approval, we delete all your user profile data, Firebase Auth credentials, saved liked songs, and custom loops/audio marker configurations (Knots).</li>
                <li><strong>Data Kept</strong>: We retain anonymous, aggregated play count statistics for trending metrics, which cannot be linked back to your identity.</li>
                <li><strong>Retention Period</strong>: Account deletion requests submitted in-app or via email are processed within <strong>48 hours</strong>. Once deleted, your custom loop marks and personal configurations cannot be recovered.</li>
            </ul>
        </div>

        <a href="mailto:ajay@knotmusic.app?subject=Knot%20Account%20Deletion%20Request" class="btn-submit">Request Account Deletion via Email</a>
        
        <div class="footer">
            &copy; 2026 Knot Music. All rights reserved.
        </div>
    </div>
</body>
</html>`);
});

const privacyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - Knot App</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0A0A0A;
            --surface-color: #121212;
            --primary-color: #FF6D00;
            --text-color: #FFFFFF;
            --text-secondary: #A0A0A0;
            --border-color: rgba(255, 255, 255, 0.08);
        }
        body {
            background-color: var(--bg-color);
            color: var(--text-color);
            font-family: 'Outfit', sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            max-width: 650px;
            width: 100%;
            padding: 40px;
            box-sizing: border-box;
            background-color: var(--surface-color);
            border-radius: 20px;
            border: 1px solid var(--border-color);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            margin: 40px 20px;
        }
        .logo {
            font-size: 32px;
            font-weight: 700;
            color: var(--primary-color);
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .logo span {
            color: var(--text-color);
        }
        h1 {
            font-size: 26px;
            font-weight: 600;
            margin-top: 0;
            margin-bottom: 12px;
        }
        .last-updated {
            font-size: 13px;
            color: var(--primary-color);
            margin-bottom: 30px;
            font-weight: 600;
        }
        h2 {
            font-size: 18px;
            font-weight: 600;
            margin-top: 30px;
            margin-bottom: 12px;
            color: var(--text-color);
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 8px;
        }
        p, li {
            font-size: 15px;
            line-height: 1.6;
            color: var(--text-secondary);
        }
        ul {
            padding-left: 20px;
            margin-bottom: 20px;
        }
        li {
            margin-bottom: 8px;
        }
        .contact-box {
            background-color: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 20px;
            margin-top: 30px;
        }
        .contact-box h3 {
            font-size: 16px;
            margin-top: 0;
            margin-bottom: 8px;
            color: var(--primary-color);
        }
        .footer {
            text-align: center;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.3);
            margin-top: 40px;
        }
        a {
            color: var(--primary-color);
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🪢 <span>Knot</span></div>
        <h1>Privacy Policy</h1>
        <div class="last-updated">Last Updated: May 29, 2026</div>

        <p>Knot ("we", "our", or "us") is dedicated to protecting your privacy. This Privacy Policy details how we collect, use, and safeguard your personal information when you use the Knot mobile application and related backend services.</p>

        <h2>1. Information We Collect</h2>
        <p>We collect information to provide a personalized, functional music looping and analysis experience:</p>
        <ul>
            <li><strong>Account Credentials</strong>: We use Firebase Authentication (email and phone number authentication) to securely register and identify you across your devices.</li>
            <li><strong>User Configurations (Knots)</strong>: We save your custom audio loop markers, playback speeds, A/B intervals, and track bookmarks to enable seamless loop synchronization across your authorized devices.</li>
            <li><strong>Usage Logs</strong>: To perform auto-knotting audio analysis, the app uploads audio metadata and stream references. Our cloud processing engines process these requests and maintain temporary analysis buffers.</li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <ul>
            <li>To synchronize your custom loops and playlist configurations across devices.</li>
            <li>To analyze audio streams (auto-knotting) and generate accurate beat markers and segment transitions.</li>
            <li>To maintain application security, authenticate users, and process support requests.</li>
        </ul>

        <h2>3. Third-Party Services</h2>
        <p>We leverage trusted industry-standard services to support core features:</p>
        <ul>
            <li><strong>Google Firebase</strong>: For secure user authentication and identity storage.</li>
            <li><strong>Render GaaS</strong>: For hosting our secure backend API servers and auto-knotting engine workers.</li>
        </ul>

        <h2>4. Data Deletion & Retention</h2>
        <p>We store your account and custom loop configuration data as long as your account remains active. You can request deletion of your account and all associated personal information at any time:</p>
        <ul>
            <li>Directly in the app under Settings &gt; Delete Account.</li>
            <li>By visiting our web portal at <a href="/delete-account">Account Deletion Request</a>.</li>
            <li>By emailing our privacy team at <a href="mailto:ajay@knotmusic.app">ajay@knotmusic.app</a>.</li>
        </ul>

        <h2>5. Security</h2>
        <p>All network communications between the mobile application and our backend endpoints are encrypted over secure HTTPS (SSL/TLS) tunnels. We employ security measures to prevent unauthorized data access or modifications.</p>

        <div class="contact-box">
            <h3>Contact Us</h3>
            <p>If you have any questions about this Privacy Policy or our data collection practices, please contact us at:</p>
            <p>Email: <a href="mailto:ajay@knotmusic.app">ajay@knotmusic.app</a></p>
        </div>

        <div class="footer">
            &copy; 2026 Knot Music. All rights reserved.
        </div>
    </div>
</body>
</html>`;

app.get('/privacy', (_req, res) => {
  res.send(privacyHtml);
});

app.get('/privacy-policy', (_req, res) => {
  res.send(privacyHtml);
});

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
