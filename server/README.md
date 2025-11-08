# Argus Server

The server component of Argus - handles screen capture, HLS streaming, and tunnel management.

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- FFmpeg installed and in PATH
- Screen recording permissions (macOS)

### Installation

```bash
npm install
```

### Running

```bash
node server.js
```

The server will:
- Start Express server on port 3000
- Create a localtunnel for remote access
- Generate a random 6-character access code
- Launch FFmpeg to capture your screen
- Display connection info in a TUI interface

### Connection Info

When the server starts, you'll see:
- **Tunnel URL**: Public URL for remote access
- **Access Code**: 6-character code required to connect
- **Domain**: Tunnel domain name
- **Stream URL**: Full stream URL with authentication

### Stopping

Press `Ctrl+C` or `q` to gracefully shutdown:
- FFmpeg process will be terminated
- Tunnel will be closed
- Terminal will be restored

## Configuration

Edit `server.js` to customize:
- **Port**: Change `PORT` constant (default: 3000)
- **FFmpeg settings**: Video size, frame rate, segment duration
- **Platform-specific input**: See main README for cross-platform setup

## Files

- `server.js` - Main server file (Express + FFmpeg)
- `logger.js` - TUI logging and display utilities
- `public/` - HLS segments and playlist (generated)
