import { useEffect, useRef, useState } from "react";
import { generateCode, isValidCode, normalizeCode } from "../lib/code";
import { createBooster, type Booster } from "../lib/audio";
import { Receiver, stateText, type PeerState } from "../lib/session";
import { useLog } from "../lib/useLog";
import { Shell } from "../components/Shell";
import { toneOf } from "../lib/tone";
import { CodeEntry } from "../components/CodeEntry";
import { Player } from "../components/Player";
import { Details } from "../components/Details";
import { Icon } from "../components/Icon";
import { TvCode } from "../components/TvCode";
import { useWakeLock } from "../lib/useWakeLock";
import { AdmissionOverlay, NameChip } from "../components/Admission";
import { isAdmissionState } from "../lib/session";
import { VoiceControls } from "../components/VoiceControls";
import { useVoiceChat } from "../lib/useVoiceChat";
import { readName, saveName } from "../lib/prefs";

export function View() {
  const params = new URLSearchParams(location.search);
  const initialCode = normalizeCode(params.get("code") ?? "");
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  // This screen made the room and shows its code ("tv=1" in the URL survives reloads).
  const [hosting, setHosting] = useState(params.get("tv") === "1");
  const [state, setState] = useState<PeerState>("waiting");
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<string | null>(null);
  const [audioInfo, setAudioInfo] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [audioTrack, setAudioTrack] = useState(false);
  // The sharer's audio section exists even when they share no sound; this says if it carries any.
  const [sharerSound, setSharerSound] = useState(true);
  const hasAudio = audioTrack && sharerSound;
  const [muted, setMuted] = useState(true); // autoplay policy: must start muted
  const [volume, setVolume] = useState(readVolume); // percent; above 100 is boosted
  const [lines, log] = useLog();
  const [name, setName] = useState(readName);
  const voice = useVoiceChat(log);

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
    if (isValidCode(initialCode)) join(initialCode, hosting);
    return () => leave();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function join(code: string, showCode = false) {
    leave();
    history.replaceState(null, "", `/view?code=${code}${showCode ? "&tv=1" : ""}`);
    setHosting(showCode);
    if (showCode) log(`showing code ${code} for the computer to enter`);

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
          setAudioTrack(true);
          // Sound was on before a reconnect: keep it on if the browser allows.
          if (audioRef.current && !audioRef.current.paused) void boosterRef.current.resume();
        }
      },
      onPeerGone: () => {
        setHasVideo(false);
        setAudioTrack(false);
        if (videoRef.current) videoRef.current.srcObject = null;
        if (audioRef.current) audioRef.current.srcObject = null;
        boosterRef.current?.close();
        boosterRef.current = null;
      },
      onVoiceTrack: voice.onVoiceTrack,
      onScreenAudio: setSharerSound,
    }, { name });
    voice.bind(receiver);
    receiver.start();
    receiverRef.current = receiver;
    setJoinedCode(code);
  }

  function changeName(next: string) {
    setName(next);
    saveName(next);
    receiverRef.current?.setName(next);
  }

  function leave() {
    voice.bind(null);
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
    voice.unlock(); // same tap allows the sharer's voice to play
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

  const showTvCode =
    joinedCode !== null && hosting && !hasVideo && (state === "waiting" || state === "connecting" || state === "reconnecting");
  // Keep a TV/monitor from dimming or starting its screensaver while there's a picture
  // (or a code to read).
  useWakeLock(hasVideo || showTvCode, log);

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
          <CodeEntry initial={initialCode} action="Watch" onSubmit={(code) => join(code)} autoFocus={hasFinePointer()} />
        </section>
        <div className="or-divider" role="separator"><span>or, on a TV</span></div>
        <button className="choice tv-choice" onClick={() => join(generateCode(), true)} autoFocus={!hasFinePointer()}>
          <span className="choice-icon"><Icon name="tv" size={26} /></span>
          <span className="choice-title">Show a code on this screen</span>
          <span className="choice-body">No typing with the remote: enter the code on the computer instead.</span>
        </button>
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
          <NameChip name={name} onChange={changeName} />
          {voice.available && <VoiceControls voice={voice} who="the sharer" />}
          <button className="btn btn-ghost" onClick={() => receiverRef.current?.retry()} title="Rejoin the room">
            <Icon name="refresh" size={16} /> <span className="btn-label">Reconnect</span>
          </button>
          <button className="btn btn-ghost danger" onClick={exit} title="Leave">
            <Icon name="logout" size={16} /> <span className="btn-label">Leave</span>
          </button>
        </div>
      </div>

      {/* While the code shows, CSS hides the player that follows it (it stays mounted to receive the stream). */}
      {showTvCode && <TvCode code={joinedCode} connecting={state === "connecting"} />}
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
        overlay={
          isAdmissionState(state) ? (
            <AdmissionOverlay
              state={state}
              name={name}
              onName={changeName}
              onAskAgain={() => receiverRef.current?.knock()}
              onRetry={() => receiverRef.current?.retry()}
            />
          ) : undefined
        }
        micOn={voice.micOn}
        onToggleMic={voice.available ? () => void voice.toggleMic() : undefined}
      />
      <audio ref={audioRef} />

      {hasVideo && !hasAudio && (
        <p className="hint">
          <Icon name="info" size={16} /> No sound from the sharer. Window shares never include audio. Ask them to share the
          entire screen or a browser tab with "Share audio" ticked.
        </p>
      )}
      {hasVideo && <p className="hint subtle desktop-only">Shortcuts: M mute · F fullscreen · ↑ ↓ volume · + − zoom · 0 fit · double-click for fullscreen</p>}

      <Details stats={stats} lines={lines} />
    </Shell>
  );
}

// Mouse/trackpad: type the code right away. TVs and phones: don't pop up a keyboard.
function hasFinePointer(): boolean {
  return window.matchMedia?.("(pointer: fine)").matches ?? true;
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
