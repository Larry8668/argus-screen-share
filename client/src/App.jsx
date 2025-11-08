import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import "./App.css";

export default function App() {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls = null;

    const initHLS = () => {
      if (Hls.isSupported()) {
        hls = new Hls({
          debug: false,
          enableWorker: true,
          lowLatencyMode: true,
        });

        hls.loadSource("http://localhost:3000/stream.m3u8");
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
        video.src = "http://localhost:3000/stream.m3u8";
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
  }, []);

  return (
    <div className="app-container">
      <h1>Screen Share Stream</h1>
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
    </div>
  );
}
