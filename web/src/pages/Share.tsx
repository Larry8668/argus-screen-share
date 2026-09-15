import { useEffect, useRef, useState } from "react";
import { generateCode } from "../lib/code";
import { canCapture, captureStream, unavailableReason, type Source } from "../lib/capture";
import { createPeer, describeSelectedPair } from "../lib/peer";
import { Signaling, type SignalMessage } from "../lib/signaling";
import { useLog } from "../lib/useLog";
import { LogPanel } from "../components/LogPanel";

type Phase = "idle" | "sharing";

export function Share() {
  const [code] = useState(generateCode);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Not sharing");
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [lines, log] = useLog();

  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sigRef = useRef<Signaling | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const statsTimer = useRef<number | undefined>(undefined);

  const viewerUrl = `${location.origin}/view?code=${code}`;

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(source: Source) {
    if (!canCapture(source)) {
      log(`${source} capture unavailable: ${unavailableReason(source)}`);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await captureStream(source);
    } catch (err) {
      log(`${source} capture cancelled or denied: ${(err as Error).name}: ${(err as Error).message}`);
      return;
    }

    const [track] = stream.getVideoTracks();
    // Screen = mostly text, prefer sharpness. Camera = motion, prefer smoothness.
    track.contentHint = source === "screen" ? "detail" : "motion";
    track.onended = () => {
      log("capture ended by the browser (stop sharing clicked)");
      stop();
    };
    const settings = track.getSettings();
    log(`capturing ${source} ${settings.width}×${settings.height} @ ${settings.frameRate ?? "?"}fps`);
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length) {
      log(`audio: yes (${audioTracks[0].label || "system/tab audio"})`);
    } else if (source === "screen") {
      log("audio: none — the browser didn't offer it or the share-audio box was unchecked");
    }

    streamRef.current = stream;
    if (previewRef.current) previewRef.current.srcObject = stream;

    const sig = new Signaling(code, "share");
    sig.onStatus = (s, detail) => log(`signaling socket: ${s}${detail ? ` (${detail})` : ""}`);
    sig.onMessage = handleSignal;
    sig.connect();
    sigRef.current = sig;

    setPhase("sharing");
    setStatus("Waiting for a viewer");
  }

  async function handleSignal(message: SignalMessage) {
    switch (message.type) {
      case "hello":
        log(`joined room ${code}${message.peerPresent ? ", viewer already waiting" : ""}`);
        if (message.peerPresent) await makeOffer();
        break;
      case "peer-joined":
        log("viewer joined");
        await makeOffer();
        break;
      case "answer": {
        const pc = pcRef.current;
        if (!pc) return log("answer arrived with no peer connection, ignoring");
        await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
        log("answer applied");
        break;
      }
      case "ice": {
        const pc = pcRef.current;
        if (!pc) return;
        try {
          await pc.addIceCandidate(message.candidate);
        } catch (err) {
          log(`bad ice candidate: ${(err as Error).message}`);
        }
        break;
      }
      case "peer-left":
      case "bye":
        log("viewer left");
        closePeer();
        setStatus("Waiting for a viewer");
        break;
      case "error":
        log(`relay error: ${message.message}`);
        break;
    }
  }

  async function makeOffer() {
    const stream = streamRef.current;
    const sig = sigRef.current;
    if (!stream || !sig) return;

    closePeer();
    const pc = createPeer(log);
    pcRef.current = pc;
    for (const track of stream.getTracks()) pc.addTrack(track, stream);

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

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sig.send({ type: "offer", sdp: offer.sdp! });
    setStatus("Connecting…");
    log("offer sent");
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
    pcRef.current?.close();
    pcRef.current = null;
  }

  function stop() {
    sigRef.current?.send({ type: "bye" });
    closePeer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    sigRef.current?.close();
    sigRef.current = null;
    setPhase("idle");
    setStatus("Not sharing");
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      log("copied to clipboard");
    } catch {
      log("clipboard blocked; select and copy manually");
    }
  }

  return (
    <main className="page">
      <header className="bar">
        <a href="/" className="brand">Argus</a>
        <span className={`status ${status === "Connected" ? "ok" : ""}`}>{status}</span>
      </header>

      {phase === "idle" ? (
        <section className="card center">
          {canCapture("screen") ? (
            <p className="muted">Pick a screen or window. Nothing leaves this device until a viewer connects.</p>
          ) : (
            <p className="muted">{unavailableReason("screen")}</p>
          )}
          <div className="row">
            {canCapture("screen") && (
              <button className="button" onClick={() => start("screen")}>Share screen</button>
            )}
            {canCapture("camera") && (
              <button className={`button ${canCapture("screen") ? "secondary" : ""}`} onClick={() => start("camera")}>
                Share camera
              </button>
            )}
          </div>
          {!canCapture("screen") && !canCapture("camera") && (
            <p className="muted">{unavailableReason("camera")}</p>
          )}
        </section>
      ) : (
        <section className="card">
          <div className="code-row">
            <div>
              <div className="label">Room code</div>
              <div className="code">{code}</div>
            </div>
            <div className="grow">
              <div className="label">Viewer link</div>
              <div className="url">{viewerUrl}</div>
            </div>
            <div className="col">
              <button className="button small" onClick={() => copy(viewerUrl)}>Copy link</button>
              <button className="button small danger" onClick={stop}>Stop</button>
            </div>
          </div>
          {pairInfo && <div className="muted small-text">path: {pairInfo}</div>}
        </section>
      )}

      <video ref={previewRef} className={`video ${phase === "idle" ? "hidden" : ""}`} autoPlay muted playsInline />

      <LogPanel lines={lines} />
    </main>
  );
}
