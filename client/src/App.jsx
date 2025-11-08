import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";

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
    <div className="w-full min-h-screen flex flex-col items-center px-4 py-8 max-w-[1400px] mx-auto">
      <h1 className="text-[clamp(2rem,5vw,3rem)] font-bold mb-12 text-center tracking-tight bg-gradient-to-br from-white to-white/70 bg-clip-text text-transparent">
        Screen Share Stream
      </h1>
      
      {!isConnected ? (
        <div className="w-full max-w-[480px] mx-auto p-10 bg-[#1f1f1f] border border-white/10 rounded-2xl shadow-2xl backdrop-blur-sm">
          <form onSubmit={handleConnect} className="space-y-7">
            <div className="space-y-3">
              <label htmlFor="domain" className="block text-white font-semibold text-[0.95rem] tracking-wide">
                Tunnel Domain:
              </label>
              <input
                id="domain"
                type="text"
                placeholder="true-mugs-swim"
                value={domain}
                onChange={(e) => setDomain(e.target.value.trim())}
                required
                className="w-full px-4 py-3.5 border border-white/10 rounded-[10px] bg-[#1a1a1a] text-white text-base font-inherit transition-all duration-200 placeholder:text-white/50 focus:outline-none focus:border-indigo-500 focus:bg-[#141414] focus:ring-2 focus:ring-indigo-500/10"
              />
              <small className="block mt-2 text-white/70 text-[0.8125rem] leading-snug">
                Enter the domain name from the server (e.g., "true-mugs-swim")
              </small>
            </div>
            <div className="space-y-3">
              <label htmlFor="code" className="block text-white font-semibold text-[0.95rem] tracking-wide">
                Access Code:
              </label>
              <input
                id="code"
                type="text"
                placeholder="ABC123"
                value={code}
                onChange={(e) => setCode(e.target.value.trim().toUpperCase())}
                maxLength={6}
                required
                className="w-full px-4 py-3.5 border border-white/10 rounded-[10px] bg-[#1a1a1a] text-white text-base font-inherit transition-all duration-200 placeholder:text-white/50 focus:outline-none focus:border-indigo-500 focus:bg-[#141414] focus:ring-2 focus:ring-indigo-500/10"
              />
              <small className="block mt-2 text-white/70 text-[0.8125rem] leading-snug">
                Enter the 6-character code from the server
              </small>
            </div>
            <button 
              type="submit" 
              className="w-full py-3.5 px-6 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-[10px] text-base font-semibold cursor-pointer transition-all duration-200 shadow-[0_4px_12px_rgba(99,102,241,0.3)] mt-2 hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(99,102,241,0.4)] active:translate-y-0"
            >
              Connect to Stream
            </button>
          </form>
          {error && (
            <div className="mt-4 text-red-400 text-base p-6 bg-red-500/10 border border-red-500/30 rounded-xl text-center leading-relaxed">
              {error}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="w-full max-w-[1280px] flex justify-between items-center mb-6 p-4 px-6 bg-[#1f1f1f] border border-white/10 rounded-xl shadow-lg md:flex-row flex-col gap-4 md:gap-0">
            <span className="text-white font-medium text-[0.95rem] md:text-left text-center before:content-['●'] before:text-emerald-500 before:mr-2 before:text-xs">
              Connected to: {domain}.loca.lt
            </span>
            <button 
              onClick={handleDisconnect} 
              className="px-5 py-2 bg-red-500 text-white rounded-lg text-sm font-medium cursor-pointer transition-all duration-200 hover:bg-red-600 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(239,68,68,0.3)] md:w-auto w-full"
            >
              Disconnect
            </button>
          </div>
          <div className="relative w-full max-w-[1280px] flex justify-center items-center min-h-[400px] bg-[#141414] border border-white/10 rounded-2xl p-6 shadow-2xl overflow-hidden md:min-h-[400px] min-h-[300px]">
            {isLoading && !error && (
              <div className="text-white/70 text-lg p-12 flex items-center gap-3">
                <div className="w-5 h-5 border-[3px] border-white/10 border-t-indigo-500 rounded-full animate-spin"></div>
                Loading stream...
              </div>
            )}
            {error && (
              <div className="text-red-400 text-base p-6 bg-red-500/10 border border-red-500/30 rounded-xl text-center leading-relaxed">
                {error}
              </div>
            )}
            <video
              ref={videoRef}
              controls
              autoPlay
              muted
              playsInline
              className={`w-full h-auto max-w-full bg-black rounded-xl shadow-2xl ${error ? 'hidden' : 'block'}`}
            />
          </div>
        </>
      )}
    </div>
  );
}
