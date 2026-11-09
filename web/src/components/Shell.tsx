import type { ReactNode } from "react";
import type { Tone } from "../lib/tone";

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
      <main className="page">{children}</main>
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
