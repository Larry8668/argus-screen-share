import { useEffect, useRef, useState } from "react";
import { generateCode, isValidCode, normalizeCode } from "../lib/code";
import { canCapture, captureSoundInput, captureStream, noScreenAudioReason, tuneTrack, unavailableReason, type Source, type Tuning } from "../lib/capture";
import { Sender, stateText, type PeerState } from "../lib/session";
import { useLog } from "../lib/useLog";
import { Shell } from "../components/Shell";
import { toneOf } from "../lib/tone";
import { RoomCard } from "../components/RoomCard";
import { LevelMeter } from "../components/LevelMeter";
import { Details } from "../components/Details";
import { Icon } from "../components/Icon";
import { CodeEntry } from "../components/CodeEntry";
import { ShareSettings } from "../components/ShareSettings";
import { readQuality, saveQuality, type Quality } from "../lib/bitrate";
import { useAutoTune } from "../lib/useAutoTune";
import { useDataSaver } from "../lib/useDataSaver";
import { ViewerList } from "../components/ViewerList";
import { PrivacyToggle } from "../components/PrivacyToggle";
import { VoiceControls } from "../components/VoiceControls";
import { useVoiceChat } from "../lib/useVoiceChat";
import { restrictOwnAudioSupported } from "../lib/voice";
import { readPrivate, savePrivate } from "../lib/prefs";
import type { ViewerInfo } from "../lib/session";
import { SoundInput } from "../components/SoundInput";

type Phase = "idle" | "sharing";

// The room code lives in the URL (/share?code=…), so reloading this page keeps the same
// room and a waiting viewer reconnects by itself once sharing starts again.
// "tv=1": the code came from a TV showing it (see View), not from an earlier share.
function codeFromUrl(): { code: string; resumed: boolean; fromTv: boolean } {
  const params = new URLSearchParams(location.search);
  const fromUrl = normalizeCode(params.get("code") ?? "");
  return isValidCode(fromUrl)
    ? { code: fromUrl, resumed: true, fromTv: params.get("tv") === "1" }
    : { code: generateCode(), resumed: false, fromTv: false };
}

export function Share() {
  const [{ code, resumed, fromTv }] = useState(codeFromUrl);
  const [phase, setPhase] = useState<Phase>("idle");
  const [state, setState] = useState<PeerState | "idle">("idle");
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<string | null>(null);
  const [audioInfo, setAudioInfo] = useState<string | null>(null);
  const [tuning, setTuning] = useState<Tuning>("text");
  const [autoTune, setAutoTune] = useState(true);
  const [quality, setQuality] = useState<Quality>(readQuality);
  const [source, setSource] = useState<Source>("screen");
  const [captured, setCaptured] = useState<MediaStream | null>(null);
  const [lines, log] = useLog();
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const [privateRoom, setPrivateRoom] = useState(readPrivate);
  const voice = useVoiceChat(log);

  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const senderRef = useRef<Sender | null>(null);
  // Sound picked from an input device (Stereo Mix, BlackHole…); survives switching screens.
  const inputRef = useRef<MediaStreamTrack | null>(null);
  const [inputLabel, setInputLabel] = useState<string | null>(null);

  const viewerUrl = `${location.origin}/view?code=${code}`;

  useEffect(() => {
    history.replaceState(null, "", `/share?code=${code}`);
    return () => stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview <video> only mounts once sharing starts.
  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = captured;
  }, [captured]);

  // Ask the browser for a screen/camera. null = cancelled or unavailable (already logged).
  async function capture(chosen: Source): Promise<MediaStream | null> {
    if (!canCapture(chosen)) {
      log(`${chosen} capture unavailable: ${unavailableReason(chosen)}`);
      return null;
    }
    try {
      return await captureStream(chosen);
    } catch (err) {
      log(`${chosen} capture cancelled or denied: ${(err as Error).name}: ${(err as Error).message}`);
      return null;
    }
  }

  // Tune a fresh capture, wire its end/mute events and log what it carries.
  async function prepare(stream: MediaStream, chosen: Source, wanted: Tuning): Promise<RTCDegradationPreference> {
    const [track] = stream.getVideoTracks();
    const degradation = chosen === "screen" ? await tuneTrack(track, wanted) : "maintain-framerate";
    if (chosen === "camera") track.contentHint = "motion";
    setTuning(chosen === "screen" ? wanted : "motion");
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
      const restricted = (audio.getSettings() as MediaTrackSettings & { restrictOwnAudio?: boolean }).restrictOwnAudio;
      log(
        restricted
          ? "audio: restrictOwnAudio on, viewers' voices played here stay out of the shared sound"
          : "audio: this browser can't keep viewers' voices out of the shared sound; use headphones if you talk",
      );
    } else if (chosen === "screen") {
      // displaySurface: "monitor" | "window" | "browser" (tab). Windows never carry audio.
      const surface = (settings as MediaTrackSettings & { displaySurface?: string }).displaySurface;
      log(
        noScreenAudioReason()
          ? `audio: none — ${noScreenAudioReason()}`
          : surface === "window"
            ? "audio: none — browsers can't capture a single app's sound. Share the entire screen or a tab for audio"
            : "audio: none — the browser didn't offer it or the share-audio box was unchecked",
      );
    }
    streamRef.current = stream;
    setCaptured(stream);
    return degradation;
  }

  async function start(chosen: Source) {
    const stream = await capture(chosen);
    if (!stream) return;
    // Screen starts tuned for text; camera is always motion.
    const degradation = await prepare(stream, chosen, "text");

    const sender = new Sender(code, stream, {
      log,
      onState: setState,
      onPath: setPairInfo,
      onVideo: setVideoInfo,
      onAudio: setAudioInfo,
      onViewers: setViewers,
      onVoiceTrack: voice.onVoiceTrack,
    }, { voice: true, private: privateRoom });
    await sender.setDegradation(degradation);
    voice.bind(sender);
    // Starting the share was a click, so viewers' voices may play from now on.
    voice.unlock();
    sender.start();
    senderRef.current = sender;

    setPhase("sharing");
  }

  // Swap what's shared without ending the share: viewers stay connected.
  async function switchSource(chosen: Source) {
    const old = streamRef.current;
    const stream = await capture(chosen);
    if (!stream || !senderRef.current) {
      stream?.getTracks().forEach((t) => t.stop());
      return;
    }
    if (old) for (const t of old.getTracks()) t.onended = null;
    const input = inputRef.current;
    if (input && stream.getAudioTracks().length) {
      log("the new share has its own sound; stopped the sound input");
      dropInput();
    } else if (input) {
      stream.addTrack(input);
    }
    const degradation = await prepare(stream, chosen, tuning);
    await senderRef.current.replaceSource(stream);
    await senderRef.current.setDegradation(degradation);
    old?.getTracks().forEach((t) => t !== inputRef.current && t.stop());
  }

  // Send a sound input as the share's sound (in place of none).
  async function pickInput(device: MediaDeviceInfo) {
    const stream = streamRef.current;
    if (!stream || !senderRef.current) return;
    let track: MediaStreamTrack;
    try {
      [track] = (await captureSoundInput(device.deviceId)).getAudioTracks();
    } catch (err) {
      log(`sound input refused: ${(err as Error).name}: ${(err as Error).message}`);
      return;
    }
    for (const t of stream.getAudioTracks()) {
      stream.removeTrack(t);
      t.stop();
    }
    inputRef.current?.stop();
    inputRef.current = track;
    stream.addTrack(track);
    track.onended = () => {
      log("sound input ended (unplugged or taken by the system)");
      void removeInput();
    };
    log(`sound from input: ${track.label || device.label}`);
    setInputLabel(track.label || device.label || "sound input");
    setCaptured(new MediaStream(stream.getTracks()));
    await senderRef.current.replaceSource(stream);
  }

  function dropInput() {
    const track = inputRef.current;
    if (!track) return;
    track.onended = null;
    track.stop();
    streamRef.current?.removeTrack(track);
    inputRef.current = null;
    setInputLabel(null);
  }

  async function removeInput() {
    dropInput();
    log("sound input removed");
    const stream = streamRef.current;
    if (!stream) return;
    setCaptured(new MediaStream(stream.getTracks()));
    await senderRef.current?.replaceSource(stream);
  }

  useAutoTune(phase === "sharing" && source === "screen" && autoTune, videoInfo, tuning, (next, why) => {
    log(`auto: ${why}, switching to ${next === "motion" ? "Video" : "Text"}`);
    void changeTuning(next);
  });
  useDataSaver(senderRef, phase === "sharing", quality);

  function chooseQuality(next: Quality) {
    setQuality(next);
    saveQuality(next);
  }

  function chooseTuning(next: Tuning) {
    setAutoTune(false);
    void changeTuning(next);
  }

  function chooseAuto() {
    setAutoTune(true);
    log("auto tuning on: Text, switching to Video while the link is slow");
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

  function changePrivate(on: boolean) {
    setPrivateRoom(on);
    savePrivate(on);
    senderRef.current?.setPrivate(on);
  }

  function stop() {
    voice.bind(null);
    setViewers([]);
    senderRef.current?.stop();
    senderRef.current = null;
    setCaptured(null);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    inputRef.current = null;
    setInputLabel(null);
    setPhase("idle");
    setState("idle");
  }

  const hasSound = !!captured?.getAudioTracks().length;
  const stats = [
    { label: "Path", value: pairInfo },
    { label: "Video", value: videoInfo },
    { label: "Audio", value: audioInfo },
    ...(viewers.length > 1 ? [{ label: "Viewers", value: `${viewers.filter((v) => v.status === "connected").length} watching` }] : []),
    ...(viewers.length > 1
      ? viewers.map((v) => ({
          label: v.name || `Viewer ${v.peer.slice(0, 6)}`,
          value: [v.path, v.video, v.voice && `voice ${v.voice}`].filter(Boolean).join(" · ") || v.status,
        }))
      : []),
  ];

  if (phase === "idle") {
    const screenOk = canCapture("screen");
    const cameraOk = canCapture("camera");
    return (
      <Shell>
        <section className="hero compact">
          <h1>Share your screen</h1>
          <p className="lede">
            {fromTv ? (
              <>
                Pairing with the screen showing <span className="code-inline">{code}</span>. Pick what to share.
              </>
            ) : resumed ? (
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
              {screenOk
                ? noScreenAudioReason() ?? "A whole screen, a window or a browser tab. Tick “Share audio” for sound."
                : unavailableReason("screen")}
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
        {!resumed && (
          <details className="tv-entry">
            <summary>
              <Icon name="tv" size={18} /> Have a code from a TV? Enter it
            </summary>
            <CodeEntry action="Use code" onSubmit={(c) => location.assign(`/share?code=${c}&tv=1`)} />
          </details>
        )}
        <div className="choices-extra">
          <PrivacyToggle on={privateRoom} onChange={changePrivate} />
        </div>
        {lines.length > 0 && <Details lines={lines} />}
      </Shell>
    );
  }

  return (
    <Shell status={stateText(state as PeerState, "a viewer")} tone={toneOf(state)}>
      <div className="share-grid">
        <div className="share-main">
          <div className="preview">
            <video ref={previewRef} autoPlay muted playsInline />
            <span className="preview-label">Preview · only you see this</span>
          </div>
          <div className="toolbar">
            <ShareSettings
              showTuning={source === "screen"}
              auto={autoTune}
              tuning={tuning}
              onAuto={chooseAuto}
              onTuning={chooseTuning}
              quality={quality}
              onQuality={chooseQuality}
            />
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={() => void switchSource(source)} title="Pick another screen, window or tab; viewers stay connected">
                <Icon name="refresh" size={16} /> Change {source === "screen" ? "screen" : "camera"}
              </button>
              <button className="btn btn-danger" onClick={stop}>
                <Icon name="stop" size={16} /> Stop sharing
              </button>
            </div>
          </div>
        </div>

        <aside className="share-side">
          <RoomCard code={code} link={viewerUrl} linkLabel="Viewer link" log={log}>
            <ViewerList
              state={state}
              viewers={viewers}
              onAdmit={(peer) => void senderRef.current?.admit(peer)}
              onDeny={(peer) => senderRef.current?.deny(peer)}
              onRetry={() => senderRef.current?.retry()}
            />
            <PrivacyToggle on={privateRoom} onChange={changePrivate} />
          </RoomCard>

          <section className="card stack">
            <div className="eyebrow">Talk</div>
            <VoiceControls voice={voice} who="viewers" />
            {!restrictOwnAudioSupported() && hasSound && (
              <p className="hint subtle">Wear headphones if you talk: this browser would send viewers' voices back to them inside the shared sound.</p>
            )}
            <p className="hint subtle">You hear every viewer; viewers hear you, not each other.</p>
          </section>

          <section className="card stack">
            <div className="eyebrow">Sound</div>
            {hasSound && <LevelMeter stream={captured} />}
            {hasSound && !inputLabel && (
              <p className="hint subtle">Should move when something plays. Flat? On a Mac, share a Chrome tab instead.</p>
            )}
            {!hasSound && (
              <p className="hint subtle">
                {source === "camera"
                  ? "Camera shares are video only."
                  : noScreenAudioReason() ?? 'Not sharing sound. Window shares never include audio. Pick the entire screen or a tab with "Share audio" ticked.'}
              </p>
            )}
            {!hasSound && source === "screen" && !noScreenAudioReason() && (
              <button className="btn btn-ghost" onClick={() => void switchSource("screen")}>
                <Icon name="refresh" size={16} /> Pick again with sound
              </button>
            )}
            {(!hasSound || inputLabel) && (
              <SoundInput active={inputLabel} onPick={(d) => void pickInput(d)} onRemove={() => void removeInput()} log={log} />
            )}
          </section>
        </aside>
      </div>

      <Details stats={stats} lines={lines} />
    </Shell>
  );
}
