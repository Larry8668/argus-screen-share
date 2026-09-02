// Argus Worker entry.
// - /api/health            → liveness check
// - /api/room/:code/ws     → WebSocket upgrade, routed to the room's Durable Object
// - everything else        → static assets; unknown paths fall back to index.html so
//                            the React app can own routes like /share and /view.
export { RoomDO } from "./room.js";

const ROOM_CODE = /^[A-Z0-9]{6}$/;
const ROOM_WS = /^\/api\/room\/([^/]+)\/ws$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/health") {
        return Response.json({ ok: true, service: "argus" });
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
