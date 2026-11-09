import { useEffect, useRef, useState } from "react";
import { generateCode, isValidCode, normalizeCode } from "../lib/code";
import { canChooseOutput, isVirtualCable, listOutputs, namesHidden, setOutput, unlockDeviceNames } from "../lib/audio";
import { Receiver, stateText, type PeerState } from "../lib/session";
import { useLog } from "../lib/useLog";
import { CableSetup } from "../components/CableSetup";
import { LevelMeter } from "../components/LevelMeter";
import { Shell } from "../components/Shell";
import { toneOf } from "../lib/tone";
import { RoomCard } from "../components/RoomCard";
import { Details } from "../components/Details";
import { Icon } from "../components/Icon";

const SAVED_OUTPUT_KEY = "argus.outputDeviceId";

// Desktop side of phone-as-mic: receives the phone's mic and plays it into a chosen
// output device. Pointing that at a virtual cable makes it a mic for other apps.
export function Listen() {
  // Code kept in the URL so a reload rejoins the same room and the phone reconnects.
  const [{ code, resumed }] = useState(() => {
    const fromUrl = normalizeCode(new URLSearchParams(location.search).get("code") ?? "");
    return isValidCode(fromUrl) ? { code: fromUrl, resumed: true } : { code: generateCode(), resumed: false };
  });
  const [listening, setListening] = useState(false);
  const [state, setState] = useState<PeerState | "idle">("idle");
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<MediaStream | null>(null);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputId, setOutputId] = useState("default");
  const [playBlocked, setPlayBlocked] = useState(false);
  const [lines, log] = useLog();

  const audioRef = useRef<HTMLAudioElement>(null);
  const receiverRef = useRef<Receiver | null>(null);

  const micUrl = `${location.origin}/mic?code=${code}`;
  const cable = outputs.find(isVirtualCable);

  useEffect(() => {
    history.replaceState(null, "", `/listen?code=${code}`);
    const onChange = () => void refreshOutputs();
    navigator.mediaDevices?.addEventListener("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", onChange);
      stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshOutputs(): Promise<MediaDeviceInfo[]> {
    if (!canChooseOutput()) return [];
    try {
      const found = await listOutputs();
      setOutputs(found);
      return found;
    } catch (err) {
      log(`couldn't list output devices: ${(err as Error).message}`);
      return [];
    }
  }

  async function start() {
    const receiver = new Receiver(code, {
      log,
      onState: setState,
      onPath: setPairInfo,
      onTrack: (track, stream) => {
        if (track.kind !== "audio") return;
        void play(stream);
      },
      onPeerGone: () => {
        if (audioRef.current) audioRef.current.srcObject = null;
        setIncoming(null);
      },
    });
    receiver.start();
    receiverRef.current = receiver;
    setListening(true);

    const found = await refreshOutputs();
    const saved = readSavedOutput();
    if (saved && found.some((d) => d.deviceId === saved)) await chooseOutput(saved, found);
  }

  async function play(stream: MediaStream) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = stream;
    setIncoming(stream);
    try {
      await audio.play();
      setPlayBlocked(false);
    } catch (err) {
      log(`playback blocked: ${(err as Error).message}`);
      setPlayBlocked(true);
    }
  }

  async function resumePlayback() {
    try {
      await audioRef.current?.play();
      setPlayBlocked(false);
      log("playback resumed");
    } catch (err) {
      log(`playback still blocked: ${(err as Error).message}`);
    }
  }

  async function chooseOutput(deviceId: string, known: MediaDeviceInfo[] = outputs) {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      await setOutput(audio, deviceId);
      setOutputId(deviceId);
      saveOutput(deviceId);
      const label = known.find((d) => d.deviceId === deviceId)?.label || deviceId;
      log(`output → ${label}`);
    } catch (err) {
      log(`couldn't switch output: ${(err as Error).name}: ${(err as Error).message}`);
    }
  }

  async function showDeviceNames() {
    try {
      await unlockDeviceNames();
      log("microphone permission granted; device names unlocked");
    } catch (err) {
      log(`microphone permission refused: ${(err as Error).name}. Device names stay hidden`);
    }
    await refreshOutputs();
  }

  function stop() {
    receiverRef.current?.stop();
    receiverRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    setIncoming(null);
    setListening(false);
    setState("idle");
  }

  // One <audio> element for the page's whole life: its output device (setSinkId) must
  // survive switching between the start screen and the live screen.
  const audioEl = <audio ref={audioRef} />;

  if (!listening) {
    return (
      <>
      <Shell>
        <section className="hero compact">
          <div className="hero-icon"><Icon name="ear" size={28} /></div>
          <h1>Phone as a mic</h1>
          <p className="lede">
            {resumed ? (
              <>Resume listening in room <span className="code-inline">{code}</span>.</>
            ) : (
              "Hear your phone's microphone on this computer, and use it in games and calls."
            )}
          </p>
          <button className="btn btn-primary btn-lg" onClick={() => void start()}>
            Start listening <Icon name="arrow" size={18} />
          </button>
        </section>
        <details className="card setup" open={readSavedOutput() === null}>
          <summary>First time? One-time setup (2 min)</summary>
          <CableSetup />
        </details>
        {lines.length > 0 && <Details lines={lines} />}
      </Shell>
      {audioEl}
      </>
    );
  }

  const phoneText = state === "connected" ? "Phone connected" : state === "waiting" ? "Waiting for the phone" : stateText(state as PeerState, "the phone");

  return (
    <>
    <Shell status={stateText(state as PeerState, "the phone")} tone={toneOf(state)}>
      <div className="share-grid">

        <div className="share-main">
          <section className="card stack">
            <div className="eyebrow">Incoming voice</div>
            <LevelMeter stream={incoming} />
            {playBlocked && (
              <button className="btn btn-primary" onClick={() => void resumePlayback()}>
                <Icon name="volume" size={16} /> Click to enable audio
              </button>
            )}

            <div className="eyebrow spaced">Send audio to</div>
            {canChooseOutput() ? (
              <>
                <div className="field-row">
                  <select id="output" className="input" value={outputId} onChange={(e) => void chooseOutput(e.target.value)} aria-label="Output device">
                    {!outputs.some((d) => d.deviceId === "default") && <option value="default">System default</option>}
                    {outputs.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>
                    ))}
                  </select>
                  {namesHidden(outputs) && (
                    <button className="btn btn-ghost" onClick={() => void showDeviceNames()}>Show all devices</button>
                  )}
                </div>
                {namesHidden(outputs) ? (
                  <p className="hint subtle">
                    The browser hides speaker names until this page may use a microphone. Click "Show all devices" and
                    allow it; nothing is recorded.
                  </p>
                ) : cable ? (
                  outputId === cable.deviceId ? (
                    <p className="ok-box"><Icon name="check" size={16} /> Going into {cable.label}. Pick the matching cable mic in your game.</p>
                  ) : (
                    <p className="hint">Found <strong>{cable.label}</strong>. Pick it above to use the phone as a mic in other apps.</p>
                  )
                ) : (
                  <p className="hint subtle">
                    No virtual cable found, so other apps can't use this as a mic yet.{" "}
                    <a href="/setup" target="_blank">Setup guide</a> (2 minutes, once).
                  </p>
                )}
              </>
            ) : (
              <p className="hint subtle">
                This browser can't choose an output device, so audio plays on the default speakers. Use Chrome or Edge to
                route it into a virtual cable.
              </p>
            )}

            <button className="btn btn-danger self-start" onClick={stop}>
              <Icon name="stop" size={16} /> Stop listening
            </button>
          </section>
        </div>
        <aside className="share-side">
          <RoomCard code={code} link={micUrl} linkLabel="Open on the phone" log={log} qrOpen>
            <div className={`viewer-state tone-${toneOf(state)}`}>
              <span className="dot" aria-hidden />
              <span>{phoneText}</span>
              {state === "failed" && (
                <button className="btn btn-ghost small" onClick={() => receiverRef.current?.retry()}>
                  <Icon name="refresh" size={14} /> Retry
                </button>
              )}
            </div>
          </RoomCard>
        </aside>
      </div>

      <Details stats={[{ label: "Path", value: pairInfo }]} lines={lines} />
    </Shell>
    {audioEl}
    </>
  );
}

function readSavedOutput(): string | null {
  try {
    return localStorage.getItem(SAVED_OUTPUT_KEY);
  } catch {
    return null;
  }
}

function saveOutput(deviceId: string): void {
  try {
    localStorage.setItem(SAVED_OUTPUT_KEY, deviceId);
  } catch {
    // Storage blocked (private mode); the choice just won't be remembered.
  }
}
