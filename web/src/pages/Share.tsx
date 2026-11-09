import { useEffect, useRef, useState } from "react";
import { generateCode, isValidCode, normalizeCode } from "../lib/code";
import { canCapture, captureStream, tuneTrack, unavailableReason, type Source, type Tuning } from "../lib/capture";
import { Sender, stateText, type PeerState } from "../lib/session";
import { useLog } from "../lib/useLog";
import { Shell } from "../components/Shell";
import { toneOf } from "../lib/tone";
import { RoomCard } from "../components/RoomCard";
import { LevelMeter } from "../components/LevelMeter";
import { Details } from "../components/Details";
import { Icon } from "../components/Icon";

type Phase = "idle" | "sharing";

// The room code lives in the URL (/share?code=…), so reloading this page keeps the same
// room and a waiting viewer reconnects by itself once sharing starts again.
function codeFromUrl(): { code: string; resumed: boolean } {
  const fromUrl = normalizeCode(new URLSearchParams(location.search).get("code") ?? "");
  return isValidCode(fromUrl) ? { code: fromUrl, resumed: true } : { code: generateCode(), resumed: false };
}

export function Share() {
  const [{ code, resumed }] = useState(codeFromUrl);
  const [phase, setPhase] = useState<Phase>("idle");
  const [state, setState] = useState<PeerState | "idle">("idle");
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<string | null>(null);
  const [audioInfo, setAudioInfo] = useState<string | null>(null);
  const [tuning, setTuning] = useState<Tuning>("text");
  const [source, setSource] = useState<Source>("screen");
  const [captured, setCaptured] = useState<MediaStream | null>(null);
  const [lines, log] = useLog();

  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const senderRef = useRef<Sender | null>(null);

  const viewerUrl = `${location.origin}/view?code=${code}`;

  useEffect(() => {
    history.replaceState(null, "", `/share?code=${code}`);
    return () => stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview <video> only mounts once sharing starts.
  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = captured;
  }, [captured]);

  async function start(chosen: Source) {
    if (!canCapture(chosen)) {
      log(`${chosen} capture unavailable: ${unavailableReason(chosen)}`);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await captureStream(chosen);
    } catch (err) {
      log(`${chosen} capture cancelled or denied: ${(err as Error).name}: ${(err as Error).message}`);
      return;
    }

    const [track] = stream.getVideoTracks();
    // Screen starts tuned for text; camera is always motion.
    const initial: Tuning = chosen === "screen" ? "text" : "motion";
    const degradation = chosen === "screen" ? await tuneTrack(track, initial) : "maintain-framerate";
    if (chosen === "camera") track.contentHint = "motion";
    setTuning(initial);
    setSource(chosen);
    track.onended = () => {
      log("capture ended by the browser (stop sharing clicked)");
      stop();
    };
    const settings = track.getSettings();
    log(`capturing ${chosen} ${settings.width}×${settings.height} @ ${settings.frameRate ?? "?"}fps`);
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length) {
      const audio = audioTracks[0];
      log(`audio: yes (${audio.label || "system/tab audio"})${audio.muted ? ", but no sound frames yet" : ""}`);
      audio.onmute = () => log("audio capture: no sound frames (on macOS: check System Settings → Privacy → Screen & System Audio Recording)");
      audio.onunmute = () => log("audio capture: sound frames flowing");
    } else if (chosen === "screen") {
      // displaySurface: "monitor" | "window" | "browser" (tab). Windows never carry audio.
      const surface = (settings as MediaTrackSettings & { displaySurface?: string }).displaySurface;
      log(
        surface === "window"
          ? "audio: none — browsers can't capture a single app's sound. Share the entire screen or a tab for audio"
          : "audio: none — the browser didn't offer it or the share-audio box was unchecked",
      );
    }

    streamRef.current = stream;
    setCaptured(stream);

    const sender = new Sender(code, stream, {
      log,
      onState: setState,
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
    setPhase("idle");
    setState("idle");
  }

  const hasSound = !!captured?.getAudioTracks().length;
  const stats = [
    { label: "Path", value: pairInfo },
    { label: "Video", value: videoInfo },
    { label: "Audio", value: audioInfo },
  ];

  if (phase === "idle") {
    const screenOk = canCapture("screen");
    const cameraOk = canCapture("camera");
    return (
      <Shell>
        <section className="hero compact">
          <h1>Share your screen</h1>
          <p className="lede">
            {resumed ? (
              <>
                Resume sharing in room <span className="code-inline">{code}</span>. A viewer who's still waiting reconnects
                automatically.
              </>
            ) : (
              "Nothing leaves this device until someone joins with your code."
            )}
          </p>
        </section>
        <div className="choices">
          <button className="choice" onClick={() => void start("screen")} disabled={!screenOk}>
            <span className="choice-icon"><Icon name="screen" size={26} /></span>
            <span className="choice-title">Share screen</span>
            <span className="choice-body">
              {screenOk ? "A whole screen, a window or a browser tab. Tick “Share audio” for sound." : unavailableReason("screen")}
            </span>
          </button>
          <button className="choice" onClick={() => void start("camera")} disabled={!cameraOk}>
            <span className="choice-icon"><Icon name="camera" size={26} /></span>
            <span className="choice-title">Share camera</span>
            <span className="choice-body">
              {cameraOk ? "Point a phone or webcam at something. Video only." : unavailableReason("camera")}
            </span>
          </button>
        </div>
        {lines.length > 0 && <Details lines={lines} />}
      </Shell>
    );
  }

  const viewerText =
    state === "connected" ? "Viewer connected" : state === "waiting" ? "No one watching yet" : stateText(state as PeerState, "a viewer");

  return (
    <Shell status={stateText(state as PeerState, "a viewer")} tone={toneOf(state)}>
      <div className="share-grid">
        <div className="share-main">
          <div className="preview">
            <video ref={previewRef} autoPlay muted playsInline />
            <span className="preview-label">Preview · only you see this</span>
          </div>
          <div className="toolbar">
            {source === "screen" && (
              <div className="segmented" role="group" aria-label="Optimize for">
                <span className="segmented-label">Optimize for</span>
                <button className={tuning === "text" ? "active" : ""} onClick={() => void changeTuning("text")} title="Sharp text, fps drops on slow links">
                  Text
                </button>
                <button className={tuning === "motion" ? "active" : ""} onClick={() => void changeTuning("motion")} title="Smooth motion, resolution drops on slow links">
                  Video
                </button>
              </div>
            )}
            <button className="btn btn-danger" onClick={stop}>
              <Icon name="stop" size={16} /> Stop sharing
            </button>
          </div>
        </div>

        <aside className="share-side">
          <RoomCard code={code} link={viewerUrl} linkLabel="Viewer link" log={log}>
            <div className={`viewer-state tone-${toneOf(state)}`}>
              <span className="dot" aria-hidden />
              <span>{viewerText}</span>
              {state === "failed" && (
                <button className="btn btn-ghost small" onClick={() => senderRef.current?.retry()}>
                  <Icon name="refresh" size={14} /> Retry
                </button>
              )}
            </div>
          </RoomCard>

          <section className="card">
            <div className="eyebrow">Sound</div>
            {hasSound ? (
              <>
                <LevelMeter stream={captured} />
                <p className="hint subtle">Should move when something plays. Flat? On a Mac, share a Chrome tab instead.</p>
              </>
            ) : (
              <p className="hint subtle">
                {source === "camera"
                  ? "Camera shares are video only."
                  : 'Not sharing sound. Window shares never include audio; stop and share the entire screen or a tab with "Share audio" ticked.'}
              </p>
            )}
          </section>
        </aside>
      </div>

      <Details stats={stats} lines={lines} />
    </Shell>
  );
}
