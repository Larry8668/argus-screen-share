import { useEffect, useRef, useState } from "react";
import { isValidCode, normalizeCode } from "../lib/code";
import { canCaptureMic, captureMic } from "../lib/audio";
import { Sender, stateText } from "../lib/session";
import { holdWakeLock } from "../lib/wakeLock";
import { useLog } from "../lib/useLog";
import { LevelMeter } from "../components/LevelMeter";
import { LogPanel } from "../components/LogPanel";

// Phone side of phone-as-mic: captures the mic and sends it to the desktop's /listen page.
export function Mic() {
  const initialCode = normalizeCode(new URLSearchParams(location.search).get("code") ?? "");
  const [codeInput, setCodeInput] = useState(initialCode);
  const [liveCode, setLiveCode] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState("Not started");
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lines, log] = useLog();

  const senderRef = useRef<Sender | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const releaseWakeLock = useRef<(() => void) | null>(null);

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(code: string) {
    if (!isValidCode(code)) {
      setStatus("Code must be 6 letters or digits");
      return;
    }
    let mic: MediaStream;
    try {
      mic = await captureMic();
    } catch (err) {
      log(`mic denied or unavailable: ${(err as Error).name}: ${(err as Error).message}`);
      setStatus("Microphone blocked. Allow it in the browser's site settings and retry");
      return;
    }

    const [track] = mic.getAudioTracks();
    log(`mic: ${track.label || "default microphone"}`);
    track.onended = () => {
      log("mic ended by the browser or OS");
      stop();
      setStatus("Mic stopped by the phone. Tap Start to reconnect");
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

    const sender = new Sender(code, mic, {
      log,
      onState: (state) => setStatus(stateText(state, "the desktop")),
      onPath: setPairInfo,
    });
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
    setStatus("Not started");
  }

  // Disabling the track sends silence but keeps the call up, so unmuting is instant.
  function toggleMute() {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
    log(track.enabled ? "unmuted" : "muted");
  }

  return (
    <main className="page">
      <header className="bar">
        <a href="/" className="brand">Argus</a>
        <span className={`status ${status === "Connected" ? "ok" : ""}`}>{status}</span>
      </header>

      {liveCode === null ? (
        <section className="card center">
          <p className="muted">
            Use this phone as your desktop's microphone. On the desktop, open{" "}
            <strong>{location.host}/listen</strong> and enter the code it shows.
          </p>
          {canCaptureMic() ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void start(normalizeCode(codeInput));
              }}
            >
              <input
                className="input code-input"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="ROOM CODE"
                maxLength={6}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="button" type="submit">Start mic</button>
            </form>
          ) : (
            <p className="muted">This browser has no microphone access (or the page isn't on https).</p>
          )}
        </section>
      ) : (
        <section className="card stack">
          <div className="code-row">
            <div>
              <div className="label">Room</div>
              <div className="code">{liveCode}</div>
            </div>
            <div className="grow">{pairInfo && <div className="muted small-text">path: {pairInfo}</div>}</div>
            <div className="col">
              <button className={`button small ${muted ? "danger" : ""}`} onClick={toggleMute}>
                {muted ? "Unmute" : "Mute"}
              </button>
              <button className="button small danger" onClick={stop}>Stop</button>
            </div>
          </div>
          <LevelMeter stream={stream} />
          {paused && <p className="warn small-text">The phone paused the mic. Unlock the screen and come back to this page.</p>}
          <p className="muted small-text">
            Keep this page open with the screen on. Wear headphones on the desktop, or its speakers will echo back into this mic.
          </p>
        </section>
      )}

      <LogPanel lines={lines} />
    </main>
  );
}
