import { QrCode } from "./QrCode";

/**
 * "TV shows the code": a couch-readable room code for a viewer that made its own room,
 * so nobody has to type on a TV remote. The computer enters it on /share.
 */
export function TvCode({ code, connecting }: { code: string; connecting: boolean }) {
  const shareUrl = `${location.origin}/share?code=${code}&tv=1`;
  return (
    <section className="tv-code" aria-live="polite">
      <div className="tv-steps">
        <ol>
          <li>
            On the computer, open <strong className="tv-host">{location.host}/share</strong>
          </li>
          <li>Enter this code</li>
        </ol>
        <div className="tv-digits" aria-label={`Code ${code.split("").join(" ")}`}>
          {code.split("").map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
        <p className="tv-status">
          <span className={`dot ${connecting ? "" : "pulse"}`} aria-hidden />
          {connecting ? "Connecting…" : "Waiting for the computer"}
        </p>
      </div>
      <div className="tv-qr">
        <QrCode text={shareUrl} size={220} label="QR code: open the share page with this code" />
        <span>Or scan with a phone or laptop</span>
      </div>
    </section>
  );
}
