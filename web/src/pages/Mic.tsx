import { useEffect, useRef, useState } from "react";
import { isValidCode, normalizeCode } from "../lib/code";
import { canCaptureMic, captureMic } from "../lib/audio";
import { Sender, stateText, type PeerState } from "../lib/session";
import { holdWakeLock } from "../lib/wakeLock";
import { useLog } from "../lib/useLog";
import { Shell } from "../components/Shell";
import { toneOf } from "../lib/tone";
import { CodeEntry } from "../components/CodeEntry";
import { LevelMeter } from "../components/LevelMeter";
import { Details } from "../components/Details";
import { Icon } from "../components/Icon";

// Phone side of phone-as-mic: captures the mic and sends it to the desktop's /listen page.
export function Mic() {
  const initialCode = normalizeCode(new URLSearchParams(location.search).get("code") ?? "");
  const [liveCode, setLiveCode] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<PeerState | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lines, log] = useLog();

  const senderRef = useRef<Sender | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const releaseWakeLock = useRef<(() => void) | null>(null);

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(code: string) {
    if (!isValidCode(code)) return;
    setError(null);
    let mic: MediaStream;
    try {
      mic = await captureMic();
    } catch (err) {
      log(`mic denied or unavailable: ${(err as Error).name}: ${(err as Error).message}`);
      setError("Microphone blocked. Allow it in the browser's site settings, then try again.");
      return;
    }

    const [track] = mic.getAudioTracks();
    log(`mic: ${track.label || "default microphone"}`);
    track.onended = () => {
      log("mic ended by the browser or OS");
      stop();
      setError("The phone stopped the mic. Tap Start mic to reconnect.");
    };
    // The OS "mutes" the source when the screen locks or another app grabs the mic.
    track.onmute = () => {
      log("mic paused by the phone (screen locked or another app took it)");
      setPaused(true);
    };
    track.onunmute = () => {
      log("mic resumed");
      setPaused(false);
    };

    history.replaceState(null, "", `/mic?code=${code}`);
    streamRef.current = mic;
    setStream(mic);
    setMuted(false);
    setPaused(false);

    const sender = new Sender(code, mic, { log, onState: setState, onPath: setPairInfo });
    sender.start();
    senderRef.current = sender;
    releaseWakeLock.current = holdWakeLock(log);
    setLiveCode(code);
  }

  function stop() {
    senderRef.current?.stop();
    senderRef.current = null;
    releaseWakeLock.current?.();
    releaseWakeLock.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setLiveCode(null);
    setState("idle");
  }

  // Disabling the track sends silence but keeps the call up, so unmuting is instant.
  function toggleMute() {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
    log(track.enabled ? "unmuted" : "muted");
  }

  if (liveCode === null) {
    return (
      <Shell>
        <section className="hero compact">
          <div className="hero-icon"><Icon name="mic" size={28} /></div>
          <h1>Use this phone as a mic</h1>
          <p className="lede">
            On the computer, open <strong>{location.host}/listen</strong> and enter the code it shows here.
          </p>
          {canCaptureMic() ? (
            <CodeEntry initial={initialCode} action="Start mic" onSubmit={(c) => void start(c)} autoFocus={false} />
          ) : (
            <p className="hint">This browser has no microphone access (or the page isn't on https).</p>
          )}
          {error && <p className="field-error">{error}</p>}
        </section>
        {lines.length > 0 && <Details lines={lines} />}
      </Shell>
    );
  }

  return (
    <Shell status={stateText(state as PeerState, "the computer")} tone={toneOf(state)}>
      <section className="card mic-card">
        <div className="mic-room">
          <span className="eyebrow">Room</span>
          <span className="code-inline">{liveCode}</span>
        </div>

        <button
          className={`mic-button ${muted ? "is-muted" : ""} ${state === "connected" ? "is-live" : ""}`}
          onClick={toggleMute}
          aria-pressed={muted}
        >
          <Icon name={muted ? "micOff" : "mic"} size={44} />
          <span>{muted ? "Muted · tap to talk" : "Live · tap to mute"}</span>
        </button>

        <LevelMeter stream={muted ? null : stream} />

        {paused && <p className="warn-box">The phone paused the mic. Unlock the screen and come back to this page.</p>}
        {state === "failed" && (
          <button className="btn btn-ghost" onClick={() => senderRef.current?.retry()}>
            <Icon name="refresh" size={16} /> Retry connection
          </button>
        )}

        <ul className="tips">
          <li>Keep this page open with the screen on.</li>
          <li>Wear headphones on the computer, or its speakers echo into this mic.</li>
        </ul>

        <button className="btn btn-danger" onClick={stop}>
          <Icon name="stop" size={16} /> Stop
        </button>
      </section>

      <Details stats={[{ label: "Path", value: pairInfo }]} lines={lines} />
    </Shell>
  );
}
