import { useEffect, useRef, useState } from "react";
import { isValidCode, normalizeCode } from "../lib/code";
import { createBooster, type Booster } from "../lib/audio";
import { Receiver, stateText, type PeerState } from "../lib/session";
import { useLog } from "../lib/useLog";
import { Shell } from "../components/Shell";
import { toneOf } from "../lib/tone";
import { CodeEntry } from "../components/CodeEntry";
import { Player } from "../components/Player";
import { Details } from "../components/Details";
import { Icon } from "../components/Icon";

export function View() {
  const initialCode = normalizeCode(new URLSearchParams(location.search).get("code") ?? "");
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  const [state, setState] = useState<PeerState>("waiting");
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
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    if (isValidCode(initialCode)) join(initialCode);
    return () => leave();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function join(code: string) {
    leave();
    history.replaceState(null, "", `/view?code=${code}`);

    const receiver = new Receiver(code, {
      log,
      onState: setState,
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
          boosterRef.current = createBooster(track, volumeRef.current / 100);
          if (audioRef.current) audioRef.current.srcObject = boosterRef.current.stream;
          // A muted *track* means no audio packets are arriving, unlike a muted element.
          log(`audio track: ${track.muted ? "waiting for packets" : "live"}`);
          track.onmute = () => log("audio track: packets stopped");
          track.onunmute = () => log("audio track: packets flowing");
          setHasAudio(true);
          // Sound was on before a reconnect: keep it on if the browser allows.
          if (audioRef.current && !audioRef.current.paused) void boosterRef.current.resume();
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
    setState("waiting");
  }

  function exit() {
    leave();
    history.replaceState(null, "", "/view");
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

  const stats = [
    { label: "Path", value: pairInfo },
    { label: "Video", value: videoInfo },
    { label: "Audio", value: audioInfo },
  ];

  if (joinedCode === null) {
    return (
      <Shell>
        <section className="hero compact">
          <div className="hero-icon"><Icon name="eye" size={28} /></div>
          <h1>Watch a screen</h1>
          <p className="lede">Enter the code shown on the sharing device.</p>
          <CodeEntry initial={initialCode} action="Watch" onSubmit={join} />
        </section>
      </Shell>
    );
  }

  return (
    <Shell status={stateText(state, "the sharer")} tone={toneOf(state)}>
      <div className="watch-bar">
        <div className="watch-room">
          <span className="eyebrow">Room</span>
          <span className="code-inline">{joinedCode}</span>
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => receiverRef.current?.retry()} title="Rejoin the room">
            <Icon name="refresh" size={16} /> Reconnect
          </button>
          <button className="btn btn-ghost danger" onClick={exit}>
            <Icon name="logout" size={16} /> Leave
          </button>
        </div>
      </div>

      <Player
        ref={videoRef}
        state={state}
        hasVideo={hasVideo}
        hasAudio={hasAudio}
        muted={muted}
        volume={volume}
        onToggleMute={() => void toggleMute()}
        onVolume={changeVolume}
        onRetry={() => receiverRef.current?.retry()}
        stats={stats}
        log={log}
      />
      <audio ref={audioRef} />

      {hasVideo && !hasAudio && (
        <p className="hint">
          <Icon name="info" size={16} /> No sound from the sharer. Window shares never include audio. Ask them to share the
          entire screen or a browser tab with "Share audio" ticked.
        </p>
      )}
      {hasVideo && <p className="hint subtle desktop-only">Shortcuts: M mute · F fullscreen · ↑ ↓ volume · double-click for fullscreen</p>}

      <Details stats={stats} lines={lines} />
    </Shell>
  );
}

const VOLUME_KEY = "argus.viewerVolume";

function readVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const saved = Number(raw);
    return raw !== null && saved >= 0 && saved <= 300 ? saved : 100;
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
