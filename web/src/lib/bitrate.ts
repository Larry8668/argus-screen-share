// "Data saver": a ceiling on the video bitrate the sender's encoder may use, set per
// RTP sender with setParameters (no renegotiation, applies within a second).

export type Quality = "best" | "saver";

export const DATA_SAVER_BPS = 1_000_000;
/** Rough data use, for the hint: 1 Mbps × 3600 s ÷ 8 bits ≈ 0.45 GB per hour. */
export const DATA_SAVER_GB_PER_HOUR = 0.45;

const QUALITY_KEY = "argus.quality";

export function readQuality(): Quality {
  try {
    return localStorage.getItem(QUALITY_KEY) === "saver" ? "saver" : "best";
  } catch {
    return "best";
  }
}

export function saveQuality(quality: Quality): void {
  try {
    localStorage.setItem(QUALITY_KEY, quality);
  } catch {
    // Storage blocked; the choice just won't be remembered.
  }
}

/**
 * Sets (or with null, removes) the max bitrate on every video sender of `pc`.
 * Returns true if anything changed.
 */
export async function capVideoBitrate(pc: RTCPeerConnection, maxBitrate: number | null): Promise<boolean> {
  let changed = false;
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    const params = sender.getParameters();
    // Empty before negotiation finishes; the caller re-applies once connected.
    const encodings = params.encodings ?? [];
    if (!encodings.length || encodings.every((e) => (e.maxBitrate ?? null) === maxBitrate)) continue;
    for (const enc of encodings) {
      if (maxBitrate === null) delete enc.maxBitrate;
      else enc.maxBitrate = maxBitrate;
    }
    await sender.setParameters(params);
    changed = true;
  }
  return changed;
}

/**
 * Stopgap: the Sender (lib/session.ts) doesn't expose its RTCPeerConnection or a
 * bitrate setter yet, so read its current `pc` field. Returns null if that ever changes;
 * the cap then silently doesn't apply, which is logged by the caller.
 */
export function currentPeer(session: object | null): RTCPeerConnection | null {
  const pc = (session as { pc?: unknown } | null)?.pc;
  return pc instanceof RTCPeerConnection ? pc : null;
}
