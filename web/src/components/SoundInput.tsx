import { useState } from "react";
import { listSoundInputs, looksLikeSystemSound } from "../lib/capture";
import type { Logger } from "../lib/peer";
import { Icon } from "./Icon";

/**
 * Picks a sound input (Stereo Mix, BlackHole, a virtual cable) to send as the share's
 * sound, for browsers or share types that give none.
 */
export function SoundInput({ active, onPick, onRemove, log }: {
  active: string | null;
  onPick: (device: MediaDeviceInfo) => void;
  onRemove: () => void;
  log: Logger;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    try {
      const found = await listSoundInputs();
      // Likely system-sound devices first.
      found.sort((a, b) => Number(looksLikeSystemSound(b.label)) - Number(looksLikeSystemSound(a.label)));
      setDevices(found);
      log(`sound inputs: ${found.map((d) => d.label || "unnamed").join(", ") || "none"}`);
    } catch (err) {
      log(`sound inputs unavailable: ${(err as Error).name}: ${(err as Error).message}`);
      setError("Couldn't list sound inputs. Allow the microphone for this site, then try again.");
    }
  }

  if (active) {
    return (
      <div className="stack">
        <p className="hint subtle">Sound from: <strong>{active}</strong></p>
        <button className="btn btn-ghost" onClick={onRemove}>
          <Icon name="volumeOff" size={16} /> Stop this sound
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      {devices === null ? (
        <button className="btn btn-ghost" onClick={() => void open()}>
          <Icon name="volume" size={16} /> Use a sound input
        </button>
      ) : (
        <select
          className="input"
          defaultValue=""
          onChange={(e) => {
            const d = devices.find((x) => x.deviceId === e.target.value);
            if (d) onPick(d);
          }}
        >
          <option value="" disabled>Pick a sound input…</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Unnamed input"}{looksLikeSystemSound(d.label) ? " (computer sound)" : ""}
            </option>
          ))}
        </select>
      )}
      {error && <p className="field-error left">{error}</p>}
      <details className="guide">
        <summary className="hint subtle">How to send the computer's sound this way</summary>
        <ol className="hint subtle">
          <li><strong>Windows:</strong> Sound settings → More sound settings → Recording → right-click → Show disabled devices → enable <strong>Stereo Mix</strong>. Pick it here.</li>
          <li>No Stereo Mix, or on a Mac: install a virtual cable (VB-Cable, or BlackHole on Mac), send the computer's sound to it, and pick it here.</li>
          <li>Voice chat: viewers' voices playing here go out through this input too. Mute Voice if they hear an echo.</li>
        </ol>
      </details>
    </div>
  );
}
