import { useEffect, type RefObject } from "react";
import { DATA_SAVER_BPS, type Quality } from "./bitrate";
import type { Sender } from "./session";

/**
 * Keeps the Sender's bitrate cap in line with the quality setting. The Sender applies it
 * to every current viewer and to each new viewer once their call is negotiated.
 */
export function useDataSaver(senderRef: RefObject<Sender | null>, active: boolean, quality: Quality): void {
  useEffect(() => {
    if (!active) return;
    void senderRef.current?.setMaxBitrate(quality === "saver" ? DATA_SAVER_BPS : null);
  }, [active, quality, senderRef]);
}
