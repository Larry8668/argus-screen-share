import { useEffect } from "react";
import type { Logger } from "./peer";
import { holdWakeLock } from "./wakeLock";

/** Keeps the screen on while `active` (e.g. stops a TV's screensaver mid-share). `log` must be stable. */
export function useWakeLock(active: boolean, log: Logger): void {
  useEffect(() => {
    if (!active) return;
    const release = holdWakeLock(log);
    return () => {
      release();
      log("screen wake lock released");
    };
  }, [active, log]);
}
