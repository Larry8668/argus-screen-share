import type { VoiceChat } from "../lib/useVoiceChat";
import { Icon } from "./Icon";
import "./rooms.css";

/**
 * Talk-over voice buttons: your mic (off until you turn it on) and whether you hear the
 * others. Each side controls only its own mic and its own listening.
 */
export function VoiceControls({ voice, who }: { voice: VoiceChat; who: string }) {
  return (
    <div className="voice-controls">
      <button
        className={`btn ${voice.micOn ? "btn-primary" : "btn-ghost"}`}
        onClick={() => void voice.toggleMic()}
        aria-pressed={voice.micOn}
        title={voice.micOn ? "Stop talking" : `Talk to ${who}`}
      >
        <Icon name={voice.micOn ? "mic" : "micOff"} size={16} /> {voice.micOn ? "Mic on" : "Mic off"}
      </button>
      <button
        className="btn btn-ghost"
        onClick={voice.toggleVoice}
        aria-pressed={voice.voiceOn}
        disabled={!voice.available}
        title={voice.available ? (voice.voiceOn ? `Mute ${who}'s voice` : `Hear ${who}'s voice`) : "No one to hear yet"}
      >
        <Icon name={voice.voiceOn && !voice.locked ? "volume" : "volumeOff"} size={16} />{" "}
        {voice.locked && voice.available ? "Tap to hear voice" : voice.voiceOn ? "Voice on" : "Voice off"}
      </button>
      {voice.micError && <p className="field-error">{voice.micError}</p>}
    </div>
  );
}
