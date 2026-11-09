import { useEffect, useRef, useState } from "react";
import { isValidCode, normalizeCode } from "../lib/code";
import { createBooster, type Booster } from "../lib/audio";
import { Receiver, stateText } from "../lib/session";
import { useLog } from "../lib/useLog";
import { LogPanel } from "../components/LogPanel";

export function View() {
  const initialCode = normalizeCode(new URLSearchParams(location.search).get("code") ?? "");
  const [codeInput, setCodeInput] = useState(initialCode);
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  const [status, setStatus] = useState("Enter a room code");
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<string | null>(null);
  const [audioInfo, setAudioInfo] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [muted, setMuted] = useState(true); // autoplay policy: must start muted
  const [volume, setVolume] = useState(readVolume); // percent; above 100 is boosted
  const [lines, log] = useLog();

  const videoRef = useRef<HTMLVideoElement>(null);
  // Sound plays through its own element, started from the Unmute press. TV and Android
  // browsers can ignore un-muting a <video> that autoplayed muted, so the video element
  // stays muted for good and only carries pictures.
  const audioRef = useRef<HTMLAudioElement>(null);
  const boosterRef = useRef<Booster | null>(null);
  const receiverRef = useRef<Receiver | null>(null);

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

    const receiver = new Receiver(code, {
      log,
      onState: (state) => setStatus(stateText(state, "the sharer")),
      onPath: setPairInfo,
      onVideo: setVideoInfo,
      onAudio: setAudioInfo,
      onTrack: (track, stream) => {
        const video = videoRef.current;
        if (!video) return;
        if (video.srcObject !== stream) video.srcObject = stream;
        if (track.kind === "video") setHasVideo(true);
        if (track.kind === "audio") {
          boosterRef.current?.close();
          boosterRef.current = createBooster(track, volume / 100);
          if (audioRef.current) audioRef.current.srcObject = boosterRef.current.stream;
          // A muted *track* means no audio packets are arriving, unlike a muted element.
          log(`audio track: ${track.muted ? "waiting for packets" : "live"}`);
          track.onmute = () => log("audio track: packets stopped");
          track.onunmute = () => log("audio track: packets flowing");
          setHasAudio(true);
        }
      },
      onPeerGone: () => {
        setHasVideo(false);
        setHasAudio(false);
        if (videoRef.current) videoRef.current.srcObject = null;
        if (audioRef.current) audioRef.current.srcObject = null;
        boosterRef.current?.close();
        boosterRef.current = null;
      },
    });
    receiver.start();
    receiverRef.current = receiver;
    setJoinedCode(code);
  }

  function leave() {
    receiverRef.current?.stop();
    receiverRef.current = null;
    setJoinedCode(null);
  }

  async function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!muted) {
      audio.pause();
      setMuted(true);
      log("muted");
      return;
    }
    audio.muted = false;
    try {
      // Called straight from the button press, which is what autoplay policies require.
      await boosterRef.current?.resume();
      await audio.play();
      setMuted(false);
      log("unmuted, audio playing");
    } catch (err) {
      log(`audio play refused: ${(err as Error).name}: ${(err as Error).message}`);
    }
  }

  function changeVolume(percent: number) {
    setVolume(percent);
    boosterRef.current?.setGain(percent / 100);
    saveVolume(percent);
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
            <div className="grow">
              {pairInfo && <div className="muted small-text">path: {pairInfo}</div>}
              {videoInfo && <div className="muted small-text">video: {videoInfo}</div>}
              {audioInfo && <div className="muted small-text">audio: {audioInfo}</div>}
            </div>
            <div className="col">
              <button className="button small" onClick={() => void toggleMute()} disabled={!hasAudio}>
                {!hasAudio ? "No audio" : muted ? "Unmute" : "Mute"}
              </button>
              <button className="button small" onClick={fullscreen} disabled={!hasVideo}>Fullscreen</button>
              <button className="button small danger" onClick={() => { leave(); setStatus("Enter a room code"); }}>Leave</button>
            </div>
          </div>
        </section>
      )}

      <video ref={videoRef} className={`video ${hasVideo ? "" : "hidden"}`} autoPlay muted playsInline />
      <audio ref={audioRef} />
      {hasAudio && muted && <p className="muted small-text">Audio is available. Click Unmute to hear it.</p>}
      {hasAudio && (
        <div className="row start volume">
          <span className="label">Volume</span>
          <input
            type="range"
            min={0}
            max={300}
            step={10}
            value={volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Volume"
          />
          <span className={`small-text ${volume > 100 ? "warn" : "muted"}`}>{volume}%</span>
          {volume !== 100 && (
            <button className="button small secondary" onClick={() => changeVolume(100)}>Reset</button>
          )}
        </div>
      )}
      {hasVideo && !hasAudio && (
        <p className="muted small-text">
          The sharer isn't sending sound. Window shares never carry audio. Share the entire screen (Windows, recent
          Chrome on Mac) or a browser tab, and tick "Share audio" in the picker.
        </p>
      )}

      <LogPanel lines={lines} />
    </main>
  );
}

const VOLUME_KEY = "argus.viewerVolume";

function readVolume(): number {
  try {
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    return saved >= 0 && saved <= 300 && localStorage.getItem(VOLUME_KEY) !== null ? saved : 100;
  } catch {
    return 100;
  }
}

function saveVolume(percent: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(percent));
  } catch {
    // Storage blocked; the level just won't be remembered.
  }
}
