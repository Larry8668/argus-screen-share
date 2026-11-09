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
