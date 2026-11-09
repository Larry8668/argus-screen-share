// Argus Worker entry.
// - /api/health            → liveness check
// - /api/ice               → ICE servers for RTCPeerConnection (STUN, plus TURN if configured)
// - /api/room/:code/ws     → WebSocket upgrade, routed to the room's Durable Object
// - POST /api/report       → store a diagnostics report (ReportsDO), returns its id
// - GET /api/reports[/:id] → read reports; needs "Authorization: Bearer <REPORTS_TOKEN>"
// - everything else        → static assets; unknown paths fall back to index.html so
//                            the React app can own routes like /share and /view.
export { RoomDO } from "./room.js";
export { ReportsDO } from "./reports.js";
import { MAX_REPORT_BYTES } from "./reports.js";

const ROOM_CODE = /^[A-Z0-9]{6}$/;

// Same shape as the browser's RTCIceServer (not in the Workers type lib).
type IceServer = { urls: string[]; username?: string; credential?: string };

const STUN: IceServer = { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] };

// TURN is optional and set with `wrangler secret put` so credentials never land in the
// public repo. TURN_URLS is comma-separated, e.g. "turn:host:3478,turn:host:3478?transport=tcp".
type TurnEnv = { TURN_URLS?: string; TURN_USERNAME?: string; TURN_CREDENTIAL?: string };

function iceServers(env: TurnEnv): IceServer[] {
  const { TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL } = env;
  if (!TURN_URLS || !TURN_USERNAME || !TURN_CREDENTIAL) return [STUN];
  const urls = TURN_URLS.split(",").map((u) => u.trim()).filter(Boolean);
  return [STUN, { urls, username: TURN_USERNAME, credential: TURN_CREDENTIAL }];
}
const ROOM_WS = /^\/api\/room\/([^/]+)\/ws$/;
const REPORT_ID = /^\/api\/reports\/(R-[A-Z0-9]{6})$/;

type ReportsEnv = { REPORTS_TOKEN?: string };

function reports(env: Env) {
  return env.REPORTS.get(env.REPORTS.idFromName("reports"));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function receiveReport(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (body.length > MAX_REPORT_BYTES) return Response.json({ error: "report too large" }, { status: 413 });
  let parsed: { page?: unknown; room?: unknown; note?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return Response.json({ error: "report must be JSON" }, { status: 400 });
  }
  const page = typeof parsed.page === "string" ? parsed.page.slice(0, 40) : "?";
  const room = typeof parsed.room === "string" ? parsed.room.slice(0, 6) : "";
  const note = typeof parsed.note === "string" ? parsed.note.slice(0, 120) : "";
  const summary = [page, room && `room ${room}`, note].filter(Boolean).join(" · ");
  // Salted so the stored hash can't be matched against a list of IPs.
  const ipHash = await sha256(`${request.headers.get("CF-Connecting-IP") ?? "?"}|${(env as Env & ReportsEnv).REPORTS_TOKEN ?? "argus"}`);
  const country = (request.cf?.country as string | undefined) ?? "?";
  const id = await reports(env).add(ipHash, country, summary, body);
  if (!id) return Response.json({ error: "too many reports today from this network" }, { status: 429 });
  // Also in Workers Logs, so a report can be matched with the relay's logs for that room.
  console.log(JSON.stringify({ event: "report", id, page, room, country }));
  return Response.json({ id });
}

function authorized(request: Request, env: ReportsEnv): boolean {
  const token = env.REPORTS_TOKEN;
  return !!token && request.headers.get("Authorization") === `Bearer ${token}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/health") {
        return Response.json({ ok: true, service: "argus" });
      }
      if (url.pathname === "/api/ice") {
        return Response.json({ iceServers: iceServers(env as Env & TurnEnv) }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.pathname === "/api/report" && request.method === "POST") {
        return receiveReport(request, env);
      }
      if (url.pathname === "/api/reports" || REPORT_ID.test(url.pathname)) {
        if (!authorized(request, env as Env & ReportsEnv)) return Response.json({ error: "unauthorized" }, { status: 401 });
        const id = REPORT_ID.exec(url.pathname)?.[1];
        if (id) {
          const report = await reports(env).get(id);
          return report ? Response.json(report) : Response.json({ error: "no such report" }, { status: 404 });
        }
        const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);
        return Response.json(await reports(env).list(limit));
      }

      const roomMatch = ROOM_WS.exec(url.pathname);
      if (roomMatch) {
        const code = decodeURIComponent(roomMatch[1]).toUpperCase();
        if (!ROOM_CODE.test(code)) {
          return Response.json({ error: "room code must be 6 letters or digits" }, { status: 400 });
        }
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        return stub.fetch(request);
      }

      return Response.json({ error: "not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
