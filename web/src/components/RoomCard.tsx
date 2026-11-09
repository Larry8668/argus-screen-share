import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

/** Big, readable room code plus the link to send to the other device. */
export function RoomCard({
  code,
  link,
  linkLabel,
  log,
  children,
}: {
  code: string;
  link: string;
  linkLabel: string;
  log?: (line: string) => void;
  children?: ReactNode;
}) {
  const report = (ok: boolean) => log?.(ok ? "copied to clipboard" : "clipboard blocked; select and copy manually");
  return (
    <section className="card room">
      <div className="eyebrow">Room code</div>
      <div className="code" aria-label={`Room code ${code.split("").join(" ")}`}>
        {code.split("").map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </div>
      <div className="eyebrow">{linkLabel}</div>
      <div className="link-box">
        <span className="link-text">{link.replace(/^https?:\/\//, "")}</span>
      </div>
      <div className="btn-row">
        <CopyButton text={link} label="Copy link" onResult={report} />
        <CopyButton text={code} label="Copy code" onResult={report} />
      </div>
      {children}
    </section>
  );
}
