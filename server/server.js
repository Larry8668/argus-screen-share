// server.js
const { spawn } = require("child_process");
const express = require("express");
const path = require("path");
const cors = require("cors");
const localtunnel = require("localtunnel");

const app = express();
const PORT = 3000;

// Generate random access code (6 alphanumeric characters)
function generateAccessCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

let accessCode = generateAccessCode();
let tunnelDomain = null;

// Configure CORS - must be before static file serving
app.use(cors({
  origin: true, // Allow all origins for development
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'bypass-tunnel-reminder', 'x-access-code']
}));

// Parse JSON bodies
app.use(express.json());

// Auth middleware to validate access code
function validateAccessCode(req, res, next) {
  const providedCode = req.headers['x-access-code'] || req.query.code;
  
  if (!providedCode) {
    return res.status(401).json({ error: 'Access code required' });
  }
  
  if (providedCode !== accessCode) {
    return res.status(403).json({ error: 'Invalid access code' });
  }
  
  next();
}

// API endpoint to get connection info (no auth needed)
app.get('/api/info', (req, res) => {
  res.json({
    domain: tunnelDomain,
    code: accessCode
  });
});

// Auth middleware for stream files
app.use((req, res, next) => {
  // Check if this is a stream file request
  if (req.path.includes('stream.m3u8') || req.path.includes('segment_')) {
    return validateAccessCode(req, res, next);
  }
  next();
});

// Serve the public folder (HLS segments + playlist)
app.use(express.static(path.join(process.cwd(), "public")));

app.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);
  
  // Create localtunnel
  try {
    const tunnel = await localtunnel({ port: PORT });
    
    // Extract domain from tunnel URL (e.g., "true-mugs-swim" from "https://true-mugs-swim.loca.lt")
    const url = new URL(tunnel.url);
    tunnelDomain = url.hostname.split('.')[0];
    
    console.log(`\n🌐 Tunnel created: ${tunnel.url}`);
    console.log(`🔑 Access Code: ${accessCode}`);
    console.log(`📋 Connection Info:`);
    console.log(`   Domain: ${tunnelDomain}`);
    console.log(`   Code: ${accessCode}`);
    console.log(`📺 Stream URL: ${tunnel.url}/stream.m3u8?code=${accessCode}\n`);
    
    tunnel.on('close', () => {
      console.log('Tunnel closed');
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      tunnel.close();
      process.exit();
    });
  } catch (error) {
    console.error('Failed to create tunnel:', error);
    console.log('Server still running on localhost - tunnel creation failed');
  }
});

// Launch FFmpeg
const ffmpegArgs = [
  "-loglevel", "info",
  "-fflags", "+genpts",
  "-probesize", "50M",
  "-analyzeduration", "50M",
  "-f", "avfoundation",
  "-framerate", "30",
  "-video_size", "1920x1080",
  "-i", "2:0",
  "-c:v", "libx264",
  "-preset", "ultrafast",
  "-tune", "zerolatency",
  "-profile:v", "baseline",
  "-level", "3.0",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-ar", "44100",
  "-b:a", "128k",
  "-ac", "2",
  "-f", "hls",
  "-hls_time", "2",
  "-hls_list_size", "5",
  "-hls_flags", "delete_segments+independent_segments",
  "-hls_segment_type", "mpegts",
  "-hls_segment_filename", "./public/segment_%03d.ts",
  "./public/stream.m3u8"
];

const ffmpeg = spawn("ffmpeg", ffmpegArgs);

ffmpeg.stdout.on("data", data => console.log(`FFmpeg: ${data}`));
ffmpeg.stderr.on("data", data => console.error(`FFmpeg: ${data}`));
ffmpeg.on("close", code => console.log(`FFmpeg exited with code ${code}`));