// server.js
const { spawn } = require("child_process");
const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = 3000;

// Configure CORS - must be before static file serving
app.use(cors({
  origin: true, // Allow all origins for development
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range']
}));

// Serve the public folder (HLS segments + playlist)
app.use(express.static(path.join(process.cwd(), "public")));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
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