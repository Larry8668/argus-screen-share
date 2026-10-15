import { useEffect, useRef, useState } from "react";
import { generateCode } from "../lib/code";
import { canChooseOutput, isVirtualCable, listOutputs, namesHidden, setOutput, unlockDeviceNames } from "../lib/audio";
import { Receiver, stateText } from "../lib/session";
import { useLog } from "../lib/useLog";
import { CableSetup } from "../components/CableSetup";
import { LevelMeter } from "../components/LevelMeter";
import { LogPanel } from "../components/LogPanel";

const SAVED_OUTPUT_KEY = "argus.outputDeviceId";

// Desktop side of phone-as-mic: receives the phone's mic and plays it into a chosen
// output device. Pointing that at a virtual cable makes it a mic for other apps.
export function Listen() {
  const [code] = useState(generateCode);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Not listening");
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
      onState: (state) => setStatus(stateText(state, "the phone")),
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
    setStatus("Not listening");
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

      {!listening ? (
        <section className="card center">
          <p className="muted">
            Receive a phone's microphone on this computer. Start here, then open the link or enter the code on the phone.
          </p>
          <button className="button" onClick={() => void start()}>Start listening</button>
          <details className="setup" open={readSavedOutput() === null}>
            <summary>First time? Setup (2 min)</summary>
            <CableSetup />
          </details>
        </section>
      ) : (
        <section className="card stack">
          <div className="code-row">
            <div>
              <div className="label">Room code</div>
              <div className="code">{code}</div>
            </div>
            <div className="grow">
              <div className="label">Open on the phone</div>
              <div className="url">{micUrl}</div>
              {pairInfo && <div className="muted small-text">path: {pairInfo}</div>}
            </div>
            <div className="col">
              <button className="button small" onClick={() => void copy(micUrl)}>Copy link</button>
              <button className="button small danger" onClick={stop}>Stop</button>
            </div>
          </div>

          <LevelMeter stream={incoming} />
          {playBlocked && (
            <button className="button small" onClick={() => void resumePlayback()}>Click to enable audio</button>
          )}

          {canChooseOutput() ? (
            <div className="stack">
              <label className="label" htmlFor="output">Send audio to</label>
              <div className="row start">
                <select
                  id="output"
                  className="input grow"
                  value={outputId}
                  onChange={(e) => void chooseOutput(e.target.value)}
                >
                  {!outputs.some((d) => d.deviceId === "default") && <option value="default">System default</option>}
                  {outputs.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>
                  ))}
                </select>
                {namesHidden(outputs) && (
                  <button className="button small secondary" onClick={() => void showDeviceNames()}>Show all devices</button>
                )}
              </div>
              {namesHidden(outputs) ? (
                <p className="muted small-text">
                  The browser hides speaker names until this page is allowed to use a microphone. Click
                  "Show all devices" and allow it; nothing is recorded.
                </p>
              ) : cable ? (
                outputId !== cable.deviceId && (
                  <p className="muted small-text">
                    Found <strong>{cable.label}</strong>. Pick it here, then choose the matching cable mic in your game.
                  </p>
                )
              ) : (
                <p className="muted small-text">
                  No virtual cable found, so other apps can't use this as a mic yet.{" "}
                  <a href="/setup" target="_blank">Setup guide</a> (about 2 minutes, once).
                </p>
              )}
            </div>
          ) : (
            <p className="muted small-text">
              This browser can't choose an output device, so audio plays on the default speakers. Use Chrome or Edge to
              route it into a virtual cable.
            </p>
          )}
        </section>
      )}

      <audio ref={audioRef} />

      <LogPanel lines={lines} />
    </main>
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
