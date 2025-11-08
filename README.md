# Screen Share

A real-time screen sharing application that streams your screen using FFmpeg and displays it in a React web app via HLS (HTTP Live Streaming).

## How It Works

This application uses **HLS (HTTP Live Streaming)** to break your screen capture into small, downloadable chunks:

1. **FFmpeg captures** your screen in real-time (30fps) and encodes it to H.264 video + AAC audio
2. **Every 2 seconds**, FFmpeg creates a new video segment file (`segment_XXX.ts`) containing ~2 seconds of video
3. **A playlist file** (`stream.m3u8`) is continuously updated to list available segments
4. **The browser** (via HLS.js) downloads and plays these segments sequentially, creating a continuous stream
5. **Old segments are automatically deleted** (keeps only the last 5 segments) to save disk space

This approach provides low-latency streaming (~2-4 seconds delay) and works reliably across all modern browsers.

### Cross-Platform Support

The application can run on **Windows, macOS, and Linux** by using platform-specific FFmpeg input formats:

| Platform | FFmpeg Input Format | Example Command |
|----------|-------------------|-----------------|
| **macOS** | `avfoundation` | `-f avfoundation -i "2:0"` |
| **Windows** | `gdigrab` or `dshow` | `-f gdigrab -i "desktop"` |
| **Linux** | `x11grab` | `-f x11grab -i ":0.0"` |

To use on different platforms, modify the FFmpeg input parameters in `server/server.js`:

```javascript
// macOS (current)
"-f", "avfoundation",
"-i", "2:0",

// Windows
"-f", "gdigrab",
"-i", "desktop",

// Linux
"-f", "x11grab",
"-i", ":0.0",
```

**Note:** The current configuration is set up for macOS. See the [Configuration](#configuration) section for platform-specific setup details.

## Prerequisites

- **Node.js** (v14 or higher)
- **FFmpeg** installed and available in PATH
- **macOS/Windows/Linux** (see cross-platform notes above)
- Screen recording permissions enabled (platform-specific)

### Installing FFmpeg

```bash
# macOS (using Homebrew)
brew install ffmpeg

# Windows (using Chocolatey)
choco install ffmpeg

# Linux (Ubuntu/Debian)
sudo apt-get install ffmpeg

# Linux (Fedora)
sudo dnf install ffmpeg
```

## Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd screen-share
```

### 2. Install server dependencies

```bash
cd server
npm install
```

### 3. Install client dependencies

```bash
cd ../client
npm install
```

## Usage

### Start the server

From the `server` directory:

```bash
node server.js
```

The server will:
- Start an Express server on `http://localhost:3000`
- Launch FFmpeg to capture your screen
- Generate HLS segments in `server/public/`
- Stream the video via HLS

**Note:** On first run, macOS will prompt for screen recording permissions. Grant access in System Settings > Privacy & Security > Screen Recording.

### Start the client

From the `client` directory (in a new terminal):

```bash
npm run dev
```

The React app will open in your browser (typically `http://localhost:5173`) and automatically connect to the stream.

## Project Structure

```
screen-share/
├── server/
│   ├── server.js          # Express server + FFmpeg streaming
│   ├── package.json
│   └── public/            # HLS segments (generated, gitignored)
│       └── index.html     # Alternative HTML player
└── client/
    ├── src/
    │   ├── App.jsx        # Main React component with HLS player
    │   └── ...
    └── package.json
```

## Configuration

### FFmpeg Settings

Edit `server/server.js` to adjust:
- **Video size**: Change `-video_size` (default: `1920x1080`)
- **Frame rate**: Change `-framerate` (default: `30`)
- **Segment duration**: Change `-hls_time` (default: `2` seconds)
- **Input device**: Change based on your platform (see below)

#### Platform-Specific Input Configuration

**macOS:**
```javascript
"-f", "avfoundation",
"-i", "2:0",  // Device 2 (screen), Audio 0
```
List devices: `ffmpeg -f avfoundation -list_devices true -i ""`

**Windows:**
```javascript
"-f", "gdigrab",
"-i", "desktop",  // Captures entire desktop
// OR for specific window:
"-f", "gdigrab",
"-i", "title=Window Title",
```

**Linux:**
```javascript
"-f", "x11grab",
"-i", ":0.0",  // Display 0, screen 0
// For specific screen area:
"-f", "x11grab",
"-video_size", "1920x1080",
"-i", ":0.0+100,200",  // Offset from top-left
```

### Server Port

Change `PORT` in `server/server.js` (default: `3000`)

### Client Stream URL

Update the stream URL in `client/src/App.jsx` if you change the server port:
```javascript
hls.loadSource("http://localhost:3000/stream.m3u8");
```

## Troubleshooting

- **CORS errors**: Ensure CORS middleware is configured before static file serving
- **No stream found**: Wait a few seconds after starting the server for segments to generate
- **Permission denied**: Grant screen recording permissions in macOS System Settings
- **FFmpeg not found**: Ensure FFmpeg is installed and in your PATH

## License

ISC

