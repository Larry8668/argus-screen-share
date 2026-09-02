import { useEffect, useRef } from "react";

export function LogPanel({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines]);
  return (
    <details className="log" open>
      <summary>Diagnostics</summary>
      <pre ref={ref}>{lines.length ? lines.join("\n") : "—"}</pre>
    </details>
  );
}
