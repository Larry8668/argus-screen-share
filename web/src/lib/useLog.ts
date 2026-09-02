import { useCallback, useState } from "react";

const MAX_LINES = 200;

/** Timestamped, capped log lines for on-page diagnostics. */
export function useLog(): [string[], (line: string) => void] {
  const [lines, setLines] = useState<string[]>([]);
  const log = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), `${stamp}  ${line}`]);
  }, []);
  return [lines, log];
}
