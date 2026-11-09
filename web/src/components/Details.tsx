import { useEffect, useRef } from "react";
import { CopyButton } from "./CopyButton";

export interface StatLine {
  label: string;
  value: string | null;
}

/** Collapsed "Connection details": live stats + the diagnostics log, with copy. */
export function Details({ stats = [], lines }: { stats?: StatLine[]; lines: string[] }) {
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [lines]);
  const shown = stats.filter((s) => s.value);
  return (
    <details className="details">
      <summary>
        Connection details
        <span className="muted">{lines.length ? `${lines.length} log lines` : ""}</span>
      </summary>
      {shown.length > 0 && (
        <dl className="stats">
          {shown.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="log-head">
        <span className="eyebrow">Log</span>
        <CopyButton text={lines.join("\n")} label="Copy log" />
      </div>
      <pre ref={preRef} className="log">{lines.length ? lines.join("\n") : "Nothing yet."}</pre>
    </details>
  );
}
