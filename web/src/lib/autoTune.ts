// "Auto" screen-share tuning: start sharp (Text), drop to smooth (Video/motion) when the
// link can't keep up, and go back once it recovers. Pure logic, no React or WebRTC, so
// it can be tested on its own (see the decision table in stepAuto).
import type { Tuning } from "./capture";

/** Slow link this long → switch to motion. */
export const TO_MOTION_AFTER_MS = 7000;
/** Healthy link this long → back to text. Much longer than the way down, so it can't flap. */
export const TO_TEXT_AFTER_MS = 20000;
/** Below this the picture looks choppy. */
export const LOW_FPS = 12;

export interface LinkSample {
  /** The encoder says the network is what's holding quality back. */
  bandwidthLimited: boolean;
  fps: number;
}

/** Reads the sender's video summary line ("1920×1080 · 4fps · H264 · … · limited by bandwidth"). */
export function parseVideoSummary(summary: string | null): LinkSample | null {
  if (!summary) return null;
  const fps = /(\d+)fps/.exec(summary);
  if (!fps) return null;
  return { fps: Number(fps[1]), bandwidthLimited: summary.includes("limited by bandwidth") };
}

export interface AutoState {
  tuning: Tuning;
  /** When the current "should switch" streak began; null when there is none. */
  since: number | null;
}

/**
 * One step of the decision. In text: bandwidth-limited AND choppy for TO_MOTION_AFTER_MS
 * → motion (a static screen also has low fps, but isn't bandwidth-limited). In motion:
 * not bandwidth-limited for TO_TEXT_AFTER_MS → text. Any sample that breaks the streak
 * restarts the clock.
 */
export function stepAuto(state: AutoState, sample: LinkSample | null, now: number): AutoState {
  const wantsSwitch =
    sample !== null &&
    (state.tuning === "text" ? sample.bandwidthLimited && sample.fps < LOW_FPS : !sample.bandwidthLimited);
  if (!wantsSwitch) return state.since === null ? state : { ...state, since: null };
  const since = state.since ?? now;
  const hold = state.tuning === "text" ? TO_MOTION_AFTER_MS : TO_TEXT_AFTER_MS;
  if (now - since >= hold) return { tuning: state.tuning === "text" ? "motion" : "text", since: null };
  return since === state.since ? state : { ...state, since };
}
