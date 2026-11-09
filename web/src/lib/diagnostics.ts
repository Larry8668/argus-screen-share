// Everything a bug report needs from this browser: uncaught errors (captured from page
// load), environment facts, and a sender for /api/report. No video, audio or IPs.

const MAX_ERRORS = 50;
const errors: string[] = [];
const loadedAt = new Date().toISOString();

function remember(line: string) {
  errors.push(`${new Date().toISOString()}  ${line}`);
  if (errors.length > MAX_ERRORS) errors.shift();
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => remember(`error: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason);
    remember(`unhandled rejection: ${reason}`);
  });
}

type NetworkInfo = { effectiveType?: string; downlink?: number; rtt?: number; type?: string };

function environment() {
  const conn = (navigator as Navigator & { connection?: NetworkInfo }).connection;
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio}x`,
    viewport: `${innerWidth}×${innerHeight}`,
    online: navigator.onLine,
    network: conn ? { type: conn.type, effectiveType: conn.effectiveType, downlinkMbps: conn.downlink, rttMs: conn.rtt } : null,
    capabilities: {
      getDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === "function",
      getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
      setSinkId: "setSinkId" in HTMLMediaElement.prototype,
      wakeLock: "wakeLock" in navigator,
    },
  };
}

export interface ReportInput {
  lines: string[];
  stats: { label: string; value: string | null }[];
  note: string;
}

/** The full report object; also what "Download" saves. */
export function buildReport({ lines, stats, note }: ReportInput) {
  const params = new URLSearchParams(location.search);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    pageLoadedAt: loadedAt,
    page: location.pathname,
    room: params.get("code") ?? "",
    note: note.trim(),
    stats: Object.fromEntries(stats.filter((s) => s.value).map((s) => [s.label, s.value])),
    log: lines,
    errors: [...errors],
    environment: environment(),
  };
}

export async function sendReport(input: ReportInput): Promise<string> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildReport(input)),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.id;
}

export function downloadReport(input: ReportInput): void {
  const blob = new Blob([JSON.stringify(buildReport(input), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `argus-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
