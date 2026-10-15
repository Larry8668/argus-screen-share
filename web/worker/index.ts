// Argus Worker entry.
// - /api/health            → liveness check
// - /api/ice               → ICE servers for RTCPeerConnection (STUN, plus TURN if configured)
// - /api/room/:code/ws     → WebSocket upgrade, routed to the room's Durable Object
// - everything else        → static assets; unknown paths fall back to index.html so
//                            the React app can own routes like /share and /view.
export { RoomDO } from "./room.js";

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
