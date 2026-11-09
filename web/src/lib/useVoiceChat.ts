import { useEffect, useRef, useState } from "react";
import { captureMic } from "./audio";
import type { Logger } from "./peer";
import { VoiceOutput } from "./voice";

/** The slice of Sender/Receiver this hook drives. */
interface VoiceSession {
  setMic(track: MediaStreamTrack | null): void;
}

export interface VoiceChat {
  /** Our mic is going out to the others. */
  micOn: boolean;
  /** We hear the others' voices. */
  voiceOn: boolean;
  /** At least one remote voice channel exists (someone could talk to us). */
  available: boolean;
  /** Voice playback hasn't been allowed by a tap yet (browser autoplay rule). */
  locked: boolean;
  micError: string | null;
  toggleMic: () => Promise<void>;
  toggleVoice: () => void;
  /** Allow voice playback; call from a user gesture (e.g. Tap to unmute). */
  unlock: () => void;
  /** Wire into SessionHandlers.onVoiceTrack. */
  onVoiceTrack: (peer: string, track: MediaStreamTrack | null) => void;
  /** Hand the current mic to a newly created session (null when it ends). */
  bind: (session: VoiceSession | null) => void;
}

/**
 * Talk-over voice for one page: our mic (off by default, permission asked only when
 * first switched on) and playback of the others' voices. Either side switches its own
 * mic and its own listening independently; nothing is renegotiated.
 */
export function useVoiceChat(log: Logger): VoiceChat {
  const [micOn, setMicOn] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [locked, setLocked] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const micRef = useRef<MediaStreamTrack | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const [output] = useState(() => new VoiceOutput(log));

  useEffect(
    () => () => {
      micRef.current?.stop();
      output.close();
    },
    [output],
  );

  function unlock() {
    output.unlock();
    setLocked(false);
  }

  async function toggleMic() {
    unlock(); // this click also counts as permission to play their voices
    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
      sessionRef.current?.setMic(null);
      setMicOn(false);
      log("voice: mic off");
      return;
    }
    try {
      const stream = await captureMic();
      const [track] = stream.getAudioTracks();
      track.onended = () => {
        if (micRef.current !== track) return;
        micRef.current = null;
        sessionRef.current?.setMic(null);
        setMicOn(false);
        log("voice: mic ended by the browser or OS");
      };
      micRef.current = track;
      sessionRef.current?.setMic(track);
      setMicOn(true);
      setMicError(null);
      log(`voice: mic on (${track.label || "default microphone"})`);
    } catch (err) {
      log(`voice: mic denied or unavailable: ${(err as Error).name}: ${(err as Error).message}`);
      setMicError("Microphone blocked. Allow it in the browser's site settings, then try again.");
    }
  }

  function toggleVoice() {
    if (locked) {
      // The first press only allows sound; it doesn't switch voice off.
      unlock();
      log("voice: playback allowed");
      return;
    }
    output.setOn(!voiceOn);
    setVoiceOn(!voiceOn);
    log(`voice: ${voiceOn ? "not listening to the others" : "listening to the others"}`);
  }

  function onVoiceTrack(peer: string, track: MediaStreamTrack | null) {
    if (track) output.attach(peer, track);
    else output.detach(peer);
    setSources((prev) => (track ? [...prev.filter((p) => p !== peer), peer] : prev.filter((p) => p !== peer)));
  }

  function bind(session: VoiceSession | null) {
    sessionRef.current = session;
    session?.setMic(micRef.current);
  }

  return { micOn, voiceOn, available: sources.length > 0, locked, micError, toggleMic, toggleVoice, unlock, onVoiceTrack, bind };
}
