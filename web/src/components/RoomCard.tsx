import { useState, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { QrCode } from "./QrCode";

/** Big, readable room code plus the link (and its QR) to send to the other device. */
export function RoomCard({
  code,
  link,
  linkLabel,
  log,
  qrOpen = false,
  children,
}: {
  code: string;
  link: string;
  linkLabel: string;
  log?: (line: string) => void;
  /** Show the QR of the link from the start (e.g. when a phone is the other device). */
  qrOpen?: boolean;
  children?: ReactNode;
}) {
  const [showQr, setShowQr] = useState(qrOpen);
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
      {showQr && (
        <div className="qr-box">
          <QrCode text={link} label={`QR code: ${linkLabel}`} />
          <span className="hint subtle">Scan with a phone camera</span>
        </div>
      )}
      <div className="btn-row">
        <CopyButton text={link} label="Copy link" onResult={report} />
        <CopyButton text={code} label="Copy code" onResult={report} />
        <button
          className={`btn btn-ghost icon-only ${showQr ? "is-on" : ""}`}
          onClick={() => setShowQr((v) => !v)}
          aria-pressed={showQr}
          aria-label={showQr ? "Hide QR code" : "Show QR code"}
          title={showQr ? "Hide QR code" : "Show QR code"}
        >
          <Icon name="qr" size={16} />
        </button>
      </div>
      {children}
    </section>
  );
}
