import { useEffect, useRef, useState } from "react";
import { generateCode } from "../lib/code";
import { canCapture, captureStream, tuneTrack, unavailableReason, type Source, type Tuning } from "../lib/capture";
import { Sender, stateText } from "../lib/session";
import { useLog } from "../lib/useLog";
import { LevelMeter } from "../components/LevelMeter";
import { LogPanel } from "../components/LogPanel";

type Phase = "idle" | "sharing";

export function Share() {
  const [code] = useState(generateCode);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Not sharing");
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<string | null>(null);
  const [audioInfo, setAudioInfo] = useState<string | null>(null);
  const [tuning, setTuning] = useState<Tuning>("text");
  const [captured, setCaptured] = useState<MediaStream | null>(null);
  const [lines, log] = useLog();

  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const senderRef = useRef<Sender | null>(null);

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
    // Screen starts tuned for text; camera is always motion.
    const initial: Tuning = source === "screen" ? "text" : "motion";
    const degradation = source === "screen" ? await tuneTrack(track, initial) : "maintain-framerate";
    if (source === "camera") track.contentHint = "motion";
    setTuning(initial);
    track.onended = () => {
      log("capture ended by the browser (stop sharing clicked)");
      stop();
    };
    const settings = track.getSettings();
    log(`capturing ${source} ${settings.width}×${settings.height} @ ${settings.frameRate ?? "?"}fps`);
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length) {
      const audio = audioTracks[0];
      log(`audio: yes (${audio.label || "system/tab audio"})${audio.muted ? ", but no sound frames yet" : ""}`);
      audio.onmute = () => log("audio capture: no sound frames (on macOS: check System Settings → Privacy → Screen & System Audio Recording)");
      audio.onunmute = () => log("audio capture: sound frames flowing");
    } else if (source === "screen") {
      log("audio: none — the browser didn't offer it or the share-audio box was unchecked");
    }

    streamRef.current = stream;
    setCaptured(stream);
    if (previewRef.current) previewRef.current.srcObject = stream;

    const sender = new Sender(code, stream, {
      log,
      onState: (state) => setStatus(stateText(state, "a viewer")),
      onPath: setPairInfo,
      onVideo: setVideoInfo,
      onAudio: setAudioInfo,
    });
    await sender.setDegradation(degradation);
    sender.start();
    senderRef.current = sender;

    setPhase("sharing");
  }

  async function changeTuning(next: Tuning) {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const degradation = await tuneTrack(track, next);
      await senderRef.current?.setDegradation(degradation);
      setTuning(next);
      const { width, height } = track.getSettings();
      log(`tuned for ${next}: ${width}×${height}, ${degradation}`);
    } catch (err) {
      log(`couldn't retune: ${(err as Error).message}`);
    }
  }

  function stop() {
    senderRef.current?.stop();
    senderRef.current = null;
    setCaptured(null);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
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
          <div className="row start tune">
            <span className="label">Optimize for</span>
            <div className="tabs">
              <button className={tuning === "text" ? "active" : ""} onClick={() => void changeTuning("text")}>Text</button>
              <button className={tuning === "motion" ? "active" : ""} onClick={() => void changeTuning("motion")}>Video</button>
            </div>
          </div>
          {captured?.getAudioTracks().length ? (
            <div className="stack tight">
              <span className="label">Sound being captured</span>
              <LevelMeter stream={captured} />
            </div>
          ) : null}
          {pairInfo && <div className="muted small-text">path: {pairInfo}</div>}
          {videoInfo && <div className="muted small-text">video: {videoInfo}</div>}
          {audioInfo && <div className="muted small-text">audio: {audioInfo}</div>}
        </section>
      )}

      <video ref={previewRef} className={`video ${phase === "idle" ? "hidden" : ""}`} autoPlay muted playsInline />

      <LogPanel lines={lines} />
    </main>
  );
}
