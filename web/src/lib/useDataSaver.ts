import { useEffect, type RefObject } from "react";
import { capVideoBitrate, currentPeer, DATA_SAVER_BPS, type Quality } from "./bitrate";
import type { Logger } from "./peer";

const RETRY_MS = 600;
const ATTEMPTS = 3;

/**
 * Applies the quality setting to the live call, and again after every reconnect (each
 * new viewer gets a fresh RTCPeerConnection with no cap on it).
 */
export function useDataSaver(sessionRef: RefObject<object | null>, connected: boolean, quality: Quality, log: Logger): void {
  useEffect(() => {
    if (!connected) return;
    const pc = currentPeer(sessionRef.current);
    if (!pc) {
      if (quality === "saver") log("data saver: couldn't reach the connection; no bitrate cap applied");
      return;
    }
    const bps = quality === "saver" ? DATA_SAVER_BPS : null;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = async (n: number) => {
      try {
        if (await capVideoBitrate(pc, bps)) {
          log(bps ? `data saver on: video capped at ${bps / 1_000_000} Mbps` : "data saver off: no bitrate cap");
        }
      } catch (err) {
        // setParameters can clash with the Sender's own update right after connecting.
        if (n + 1 < ATTEMPTS && !cancelled) timer = window.setTimeout(() => void attempt(n + 1), RETRY_MS);
        else log(`data saver: couldn't set the bitrate cap: ${(err as Error).message}`);
      }
    };
    void attempt(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connected, quality, sessionRef, log]);
}
