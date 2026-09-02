import { useEffect, useRef, useState } from "react";
import { isValidCode, normalizeCode } from "../lib/code";
import { createPeer, describeSelectedPair } from "../lib/peer";
import { Signaling, type SignalMessage } from "../lib/signaling";
import { useLog } from "../lib/useLog";
import { LogPanel } from "../components/LogPanel";

export function View() {
  const initialCode = normalizeCode(new URLSearchParams(location.search).get("code") ?? "");
  const [codeInput, setCodeInput] = useState(initialCode);
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  const [status, setStatus] = useState("Enter a room code");
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [lines, log] = useLog();

  const videoRef = useRef<HTMLVideoElement>(null);
  const sigRef = useRef<Signaling | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const statsTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (isValidCode(initialCode)) join(initialCode);
    return () => leave();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function join(code: string) {
    if (!isValidCode(code)) {
      setStatus("Code must be 6 letters or digits");
      return;
    }
    leave();
    history.replaceState(null, "", `/view?code=${code}`);

    const sig = new Signaling(code, "view");
    sig.onStatus = (s, detail) => log(`signaling socket: ${s}${detail ? ` (${detail})` : ""}`);
    sig.onMessage = handleSignal;
    sig.connect();
    sigRef.current = sig;

    setJoinedCode(code);
    setStatus("Waiting for the sharer");
  }

  async function handleSignal(message: SignalMessage) {
    switch (message.type) {
      case "hello":
        log(`joined room${message.peerPresent ? ", sharer is here, waiting for offer" : ", no sharer yet"}`);
        break;
      case "peer-joined":
        log("sharer joined, waiting for offer");
        break;
      case "offer":
        await acceptOffer(message.sdp);
        break;
      case "ice": {
        const pc = pcRef.current;
        if (pc?.remoteDescription) {
          try {
            await pc.addIceCandidate(message.candidate);
          } catch (err) {
            log(`bad ice candidate: ${(err as Error).message}`);
          }
        } else {
          pendingIce.current.push(message.candidate);
        }
        break;
      }
      case "peer-left":
      case "bye":
        log("sharer left");
        closePeer();
        setStatus("Sharer left. Waiting for them to come back");
        break;
      case "error":
        log(`relay error: ${message.message}`);
        break;
    }
  }

  async function acceptOffer(sdp: string) {
    const sig = sigRef.current;
    if (!sig) return;

    closePeer();
    const pc = createPeer(log);
    pcRef.current = pc;

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
        setHasVideo(true);
        log(`receiving ${event.track.kind} track`);
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) sig.send({ type: "ice", candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      log(`connection: ${pc.connectionState}`);
      if (pc.connectionState === "connected") {
        setStatus("Connected");
        startStatsPolling(pc);
      } else if (pc.connectionState === "failed") {
        setStatus("Connection failed (no path between the two networks?)");
      }
    };

    await pc.setRemoteDescription({ type: "offer", sdp });
    for (const candidate of pendingIce.current.splice(0)) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        log(`bad queued ice candidate: ${(err as Error).message}`);
      }
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sig.send({ type: "answer", sdp: answer.sdp! });
    setStatus("Connecting…");
    log("answer sent");
  }

  function startStatsPolling(pc: RTCPeerConnection) {
    window.clearInterval(statsTimer.current);
    statsTimer.current = window.setInterval(async () => {
      if (pc.connectionState !== "connected") return;
      const info = await describeSelectedPair(pc);
      if (info) setPairInfo(info);
    }, 2000);
  }

  function closePeer() {
    window.clearInterval(statsTimer.current);
    setPairInfo(null);
    setHasVideo(false);
    pendingIce.current = [];
    pcRef.current?.close();
    pcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function leave() {
    sigRef.current?.send({ type: "bye" });
    closePeer();
    sigRef.current?.close();
    sigRef.current = null;
    setJoinedCode(null);
  }

  function fullscreen() {
    videoRef.current?.requestFullscreen?.().catch((err: Error) => log(`fullscreen refused: ${err.message}`));
  }

  return (
    <main className="page">
      <header className="bar">
        <a href="/" className="brand">Argus</a>
        <span className={`status ${status === "Connected" ? "ok" : ""}`}>{status}</span>
      </header>

      {joinedCode === null ? (
        <section className="card center">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              join(normalizeCode(codeInput));
            }}
          >
            <input
              className="input code-input"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              maxLength={6}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <button className="button" type="submit">Watch</button>
          </form>
        </section>
      ) : (
        <section className="card">
          <div className="code-row">
            <div>
              <div className="label">Room</div>
              <div className="code">{joinedCode}</div>
            </div>
            <div className="grow">{pairInfo && <div className="muted small-text">path: {pairInfo}</div>}</div>
            <div className="col">
              <button className="button small" onClick={fullscreen} disabled={!hasVideo}>Fullscreen</button>
              <button className="button small danger" onClick={() => { leave(); setStatus("Enter a room code"); }}>Leave</button>
            </div>
          </div>
        </section>
      )}

      <video ref={videoRef} className={`video ${hasVideo ? "" : "hidden"}`} autoPlay muted playsInline />

      <LogPanel lines={lines} />
    </main>
  );
}
