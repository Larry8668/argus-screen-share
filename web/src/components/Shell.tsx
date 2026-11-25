import type { ReactNode } from "react";
import type { Tone } from "../lib/tone";
import { webrtcAvailable } from "../lib/peer";

const NAV = [
  { href: "/share", label: "Share" },
  { href: "/view", label: "Watch" },
  { href: "/listen", label: "Phone mic" },
];

/** Page frame: header with brand, nav and a live status pill. */
export function Shell({ status, tone = "idle", children }: { status?: string; tone?: Tone; children: ReactNode }) {
  const here = location.pathname.replace(/\/+$/, "");
  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="brand">
          <img className="brand-mark" src="/icon.svg" alt="" aria-hidden />
          Argus
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={here === n.href ? "active" : ""}>
              {n.label}
            </a>
          ))}
        </nav>
        {status && <StatusPill tone={tone}>{status}</StatusPill>}
      </header>
      <main className="page">
        {here !== "" && here !== "/setup" && !webrtcAvailable() && (
          <div className="warn-box webrtc-off" role="alert">
            <span>
              <strong>This browser has WebRTC switched off</strong>, so it can't connect to other devices.
              In Firefox: open <code>about:config</code>, set <code>media.peerconnection.enabled</code> to <code>true</code>,
              and check privacy add-ons that block WebRTC. Or use Chrome or Edge.
            </span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`pill pill-${tone}`} role="status">
      <span className="dot" aria-hidden />
      {children}
    </span>
  );
}
