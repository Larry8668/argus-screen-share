# Argus Client

The client component of Argus - React web app for viewing screen streams.

## Quick Start

### Prerequisites

- Node.js (v14 or higher)

### Installation

```bash
npm install
```

### Running

```bash
npm run dev
```

The app will open in your browser (typically `http://localhost:5173`).

### Connecting to Stream

1. Enter the **Tunnel Domain** from the server console (e.g., `pink-ears-argue`)
2. Enter the **Access Code** from the server console (e.g., `TUALKE`)
3. Click **"Connect to Stream"**

The stream will automatically load and play once connected.

### Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory, ready for deployment to Vercel or any static hosting.

## Technology

- **React 19** - UI framework
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **HLS.js** - HLS video playback

## Files

- `src/App.jsx` - Main React component with HLS player
- `src/main.jsx` - React entry point
- `tailwind.config.js` - Tailwind configuration
