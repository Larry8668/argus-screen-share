import { useEffect, useRef } from "react";
import { parseVideoSummary, stepAuto, type AutoState } from "./autoTune";
import type { Tuning } from "./capture";

/**
 * Feeds each sender video summary (every ~2s while a viewer is connected) into the Auto
 * decision and calls `apply` when it says to switch. `tuning` is what's live right now.
 */
export function useAutoTune(enabled: boolean, videoSummary: string | null, tuning: Tuning, apply: (next: Tuning, why: string) => void) {
  const state = useRef<AutoState>({ tuning, since: null });
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });

  // A manual change or turning Auto on starts a fresh streak from the live tuning.
  useEffect(() => {
    state.current = { tuning, since: null };
  }, [tuning, enabled]);

  useEffect(() => {
    if (!enabled) return;
    // A switch that failed to apply leaves the live tuning unchanged; follow reality.
    if (state.current.tuning !== tuning) state.current = { tuning, since: null };
    const sample = parseVideoSummary(videoSummary);
    const next = stepAuto(state.current, sample, Date.now());
    state.current = next;
    if (next.tuning !== tuning && sample) {
      applyRef.current(
        next.tuning,
        next.tuning === "motion"
          ? `link is slow (bandwidth-limited, ${sample.fps}fps)`
          : "link has been healthy for a while",
      );
    }
  }, [videoSummary]); // eslint-disable-line react-hooks/exhaustive-deps
}
