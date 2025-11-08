// server.js
const { spawn } = require("child_process");
const express = require("express");
const path = require("path");
const cors = require("cors");
const localtunnel = require("localtunnel");
const logger = require("./logger");

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
let tunnelUrl = null;

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
  logger.logSuccess(`Server running at http://localhost:${PORT}`);
  
  // Create localtunnel
  try {
    const tunnel = await localtunnel({ port: PORT });
    
    // Extract domain from tunnel URL (e.g., "true-mugs-swim" from "https://true-mugs-swim.loca.lt")
    const url = new URL(tunnel.url);
    tunnelDomain = url.hostname.split('.')[0];
    tunnelUrl = tunnel.url;
    
    // Initialize logger with connection info
    logger.initLogger(accessCode, tunnelDomain, tunnelUrl);
    
    // Display connection info in a nice box
    logger.displayConnectionInfo();
    
    tunnel.on('close', () => {
      logger.logError('Tunnel closed');
    });
    
    // Store tunnel reference for cleanup
    global.tunnel = tunnel;
  } catch (error) {
    logger.logError(`Failed to create tunnel: ${error.message}`);
    logger.logInfo('Server still running on localhost - tunnel creation failed');
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

ffmpeg.stdout.on("data", data => logger.logFFmpeg(data, false));
ffmpeg.stderr.on("data", data => logger.logFFmpeg(data, true));
ffmpeg.on("close", code => logger.logFFmpegExit(code));

// Graceful shutdown handler
let isShuttingDown = false;

function shutdown() {
  // Prevent multiple shutdown calls
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.logInfo('\n\nShutting down...');
  
  // Close tunnel if it exists
  if (global.tunnel) {
    global.tunnel.close();
  }
  
  // Clean up logger/TUI first (restore terminal)
  logger.cleanup();
  
  // Kill FFmpeg process
  if (ffmpeg && !ffmpeg.killed) {
    logger.logInfo('Stopping FFmpeg...');
    ffmpeg.kill('SIGTERM');
    
    // Wait for FFmpeg to exit, then force kill if needed
    const killTimeout = setTimeout(() => {
      if (ffmpeg && !ffmpeg.killed) {
        logger.logInfo('Force killing FFmpeg...');
        ffmpeg.kill('SIGKILL');
        process.exit(0);
      }
    }, 2000);
    
    // Add exit handler when FFmpeg closes
    const exitOnClose = () => {
      clearTimeout(killTimeout);
      process.exit(0);
    };
    
    // Check if already closed
    if (ffmpeg.killed) {
      clearTimeout(killTimeout);
      process.exit(0);
    } else {
      // Wait for close event
      ffmpeg.once('close', exitOnClose);
    }
  } else {
    // FFmpeg already closed or doesn't exist
    process.exit(0);
  }
}

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);