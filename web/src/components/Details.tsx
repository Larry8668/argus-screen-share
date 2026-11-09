import { useEffect, useRef, useState } from "react";
import { downloadReport, sendReport } from "../lib/diagnostics";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";

export interface StatLine {
  label: string;
  value: string | null;
}

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; id: string } | { kind: "error"; message: string };

/** Collapsed "Connection details": live stats, the log, and Send report / Download. */
export function Details({ stats = [], lines }: { stats?: StatLine[]; lines: string[] }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const [send, setSend] = useState<SendState>({ kind: "idle" });

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [lines]);

  async function submit() {
    setSend({ kind: "sending" });
    try {
      const id = await sendReport({ lines, stats, note });
      setSend({ kind: "sent", id });
    } catch (err) {
      setSend({ kind: "error", message: (err as Error).message });
    }
  }

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
        <div className="btn-row">
          <CopyButton text={lines.join("\n")} label="Copy log" />
          <button className="btn btn-ghost" onClick={() => setReporting((v) => !v)}>
            <Icon name="info" size={16} /> Report a problem
          </button>
        </div>
      </div>

      {reporting && (
        <div className="report">
          {send.kind === "sent" ? (
            <p className="ok-box">
              <Icon name="check" size={16} /> Sent. Report ID <strong className="code-inline">{send.id}</strong>
              <CopyButton text={send.id} label="Copy ID" />
            </p>
          ) : (
            <>
              <textarea
                className="input"
                rows={2}
                maxLength={500}
                placeholder="What went wrong? (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="btn-row">
                <button className="btn btn-primary" onClick={() => void submit()} disabled={send.kind === "sending"}>
                  {send.kind === "sending" ? "Sending…" : "Send report"}
                </button>
                <button className="btn btn-ghost" onClick={() => downloadReport({ lines, stats, note })}>
                  Download instead
                </button>
              </div>
              {send.kind === "error" && <p className="field-error left">Couldn't send ({send.message}). Use Download instead.</p>}
              <p className="hint subtle">
                Sends this page's log, stats, errors and browser details. No video, audio or IP addresses. Kept 30 days.
              </p>
            </>
          )}
        </div>
      )}

      <pre ref={preRef} className="log">{lines.length ? lines.join("\n") : "Nothing yet."}</pre>
    </details>
  );
}
