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

/** Plain-text version for pasting into a chat when sending isn't possible. */
export function reportText(input: ReportInput): string {
  const r = buildReport(input);
  const env = r.environment;
  return [
    `Argus report · ${r.createdAt}`,
    `page ${r.page}${r.room ? ` · room ${r.room}` : ""}`,
    r.note && `note: ${r.note}`,
    `browser: ${env.userAgent}`,
    `screen ${env.screen} · ${env.network ? `${env.network.effectiveType ?? "?"} network` : "network ?"} · online ${env.online}`,
    ...Object.entries(r.stats).map(([k, v]) => `${k}: ${v}`),
    r.errors.length ? `errors:\n${r.errors.join("\n")}` : "",
    `log:\n${r.log.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function reportFile(input: ReportInput): File {
  const name = `argus-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  return new File([JSON.stringify(buildReport(input), null, 2)], name, { type: "application/json" });
}

export function canShareReport(): boolean {
  return typeof navigator.share === "function";
}

/** Opens the OS share sheet (WhatsApp, Discord, mail…) with the report attached, or as text. */
export async function shareReport(input: ReportInput): Promise<void> {
  const file = reportFile(input);
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Argus report" });
  else await navigator.share({ title: "Argus report", text: reportText(input) });
}

export function downloadReport(input: ReportInput): void {
  const blob = reportFile(input);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = blob.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
