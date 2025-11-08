import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import "./App.css";

export default function App() {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [domain, setDomain] = useState("");
  const [code, setCode] = useState("");
  const [streamUrl, setStreamUrl] = useState(null);

  useEffect(() => {
    if (!isConnected || !streamUrl) return;
    
    const video = videoRef.current;
    if (!video) return;

    let hls = null;
    setIsLoading(true);
    setError(null);

    const initHLS = () => {
      if (Hls.isSupported()) {
        hls = new Hls({
          debug: false,
          enableWorker: true,
          lowLatencyMode: true,
          // Configure XHR to add bypass header for localtunnel and access code
          xhrSetup: (xhr, url) => {
            xhr.setRequestHeader('bypass-tunnel-reminder', 'true');
            xhr.setRequestHeader('x-access-code', code);
          },
        });

        const fullStreamUrl = `${streamUrl}/stream.m3u8?code=${code}`;
        console.log(`Loading stream from: ${fullStreamUrl}`);
        hls.loadSource(fullStreamUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
          console.log("Manifest parsed, levels:", data.levels);
          if (data.levels && data.levels.length > 0) {
            setIsLoading(false);
            setError(null);
            video.play().catch((err) => {
              console.error("Error playing video:", err);
              setError("Failed to play video. Please check permissions or try clicking play manually.");
            });
          } else {
            setError("Manifest loaded but no playable streams found. Waiting for segments...");
            setIsLoading(true);
          }
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error("HLS Error:", data);
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.error("Fatal network error, trying to recover...");
                setError("Network error. Retrying...");
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.error("Fatal media error, trying to recover...");
                setError("Media error. Attempting recovery...");
                hls.recoverMediaError();
                break;
              case Hls.ErrorTypes.MUX_ERROR:
                console.error("Mux error:", data);
                setError("Stream format error. Please restart the server with updated FFmpeg settings.");
                break;
              default:
                console.error("Fatal error:", data);
                setError(`Stream error: ${data.details || "Unknown error"}. Is the server running and generating segments?`);
                setIsLoading(false);
                break;
            }
          } else {
            console.warn("HLS error (non-fatal):", data);
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS support (Safari)
        // Note: Native HLS doesn't support custom headers, so bypass won't work
        // User will need to visit the tunnel URL once to bypass, or use HLS.js
        const fullStreamUrl = `${streamUrl}/stream.m3u8?code=${code}`;
        console.log(`Loading stream from: ${fullStreamUrl}`);
        video.src = fullStreamUrl;
        video.addEventListener("loadedmetadata", () => {
          setIsLoading(false);
          setError(null);
        });
        video.addEventListener("error", () => {
          setError("Failed to load stream. Is the server running?");
          setIsLoading(false);
        });
      } else {
        setError("HLS is not supported in this browser.");
        setIsLoading(false);
      }
    };

    initHLS();

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [isConnected, streamUrl, code]);

  const handleConnect = (e) => {
    e.preventDefault();
    if (!domain || !code) {
      setError("Please enter both domain and code");
      return;
    }
    
    // Construct full tunnel URL
    const url = `https://${domain}.loca.lt`;
    setStreamUrl(url);
    setIsConnected(true);
    setError(null);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setStreamUrl(null);
    setError(null);
    setIsLoading(false);
  };

  return (
    <div className="app-container">
      <h1>Screen Share Stream</h1>
      
      {!isConnected ? (
        <div className="connection-form">
          <form onSubmit={handleConnect}>
            <div className="form-group">
              <label htmlFor="domain">Tunnel Domain:</label>
              <input
                id="domain"
                type="text"
                placeholder="true-mugs-swim"
                value={domain}
                onChange={(e) => setDomain(e.target.value.trim())}
                required
              />
              <small>Enter the domain name from the server (e.g., "true-mugs-swim")</small>
            </div>
            <div className="form-group">
              <label htmlFor="code">Access Code:</label>
              <input
                id="code"
                type="text"
                placeholder="ABC123"
                value={code}
                onChange={(e) => setCode(e.target.value.trim().toUpperCase())}
                maxLength={6}
                required
              />
              <small>Enter the 6-character code from the server</small>
            </div>
            <button type="submit" className="connect-button">
              Connect to Stream
            </button>
          </form>
          {error && <div className="error">{error}</div>}
        </div>
      ) : (
        <>
          <div className="connection-info">
            <span>Connected to: {domain}.loca.lt</span>
            <button onClick={handleDisconnect} className="disconnect-button">
              Disconnect
            </button>
          </div>
          <div className="video-container">
            {isLoading && !error && (
              <div className="loading">Loading stream...</div>
            )}
            {error && <div className="error">{error}</div>}
            <video
              ref={videoRef}
              controls
              autoPlay
              muted
              playsInline
              style={{
                width: "100%",
                maxWidth: "1280px",
                borderRadius: "10px",
                display: error ? "none" : "block",
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
