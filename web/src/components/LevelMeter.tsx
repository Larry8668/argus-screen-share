import { useEffect, useRef } from "react";
import { watchLevel } from "../lib/audio";

/** Live loudness bar. Writes straight to the DOM so it doesn't re-render React per frame. */
export function LevelMeter({ stream }: { stream: MediaStream | null }) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fill = fillRef.current;
    if (!stream || !fill) return;
    const stop = watchLevel(stream, (level) => {
      fill.style.transform = `scaleX(${level})`;
    });
    return () => {
      stop();
      fill.style.transform = "scaleX(0)";
    };
  }, [stream]);

  return (
    <div className="meter" aria-hidden>
      <div ref={fillRef} className="meter-fill" />
    </div>
  );
}
