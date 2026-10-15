import type { Logger } from "./peer";

// Keeps the phone screen on while the mic is live. Mobile browsers pause the mic when the
// screen sleeps, and the browser drops the lock whenever the page is hidden, so it is
// re-requested each time the page becomes visible again. Returns a release function.
export function holdWakeLock(log: Logger): () => void {
  if (!("wakeLock" in navigator)) {
    log("screen wake lock unsupported; keep the screen on manually");
    return () => {};
  }

  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  const request = async () => {
    if (released || document.visibilityState !== "visible") return;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      log("screen wake lock held");
    } catch (err) {
      log(`screen wake lock refused: ${(err as Error).message}`);
    }
  };
  const onVisibility = () => void request();

  document.addEventListener("visibilitychange", onVisibility);
  void request();

  return () => {
    released = true;
    document.removeEventListener("visibilitychange", onVisibility);
    void sentinel?.release().catch(() => {});
    sentinel = null;
  };
}
