import { DurableObject } from "cloudflare:workers";

/**
 * RoomDO — one instance per room code, acting as a WebSocket relay for WebRTC signaling.
 *
 * Two roles connect: "share" (the desktop sending its screen) and "view" (the device
 * watching). The room holds at most one live socket per role and forwards every JSON
 * message from one role to the other, verbatim. It never inspects SDP or ICE payloads.
 *
 * Uses the WebSocket Hibernation API (ctx.acceptWebSocket + webSocketMessage handlers)
 * so an idle room is evicted from memory and costs nothing while sockets stay open.
 * Media never touches this object — after the handshake it only carries peer
 * join/leave notices.
 */

export type Role = "share" | "view";

const ROLES: Role[] = ["share", "view"];
const RELAYED_TYPES = new Set(["offer", "answer", "ice", "bye"]);

export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive handled by the runtime without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const role = new URL(request.url).searchParams.get("role");
    if (!isRole(role)) {
      return new Response("role must be 'share' or 'view'", { status: 400 });
    }

    // A reconnecting peer replaces its previous socket rather than being rejected.
    for (const stale of this.ctx.getWebSockets(role)) {
      stale.close(4000, "replaced by a newer connection");
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);

    const other = otherRole(role);
    const peerPresent = this.ctx.getWebSockets(other).length > 0;
    server.send(JSON.stringify({ type: "hello", role, peerPresent }));
    this.broadcast(other, { type: "peer-joined", role });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    const role = this.roleOf(ws);
    if (!role) return;

    let parsed: { type?: unknown };
    try {
      parsed = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "messages must be JSON" }));
      return;
    }
    if (typeof parsed.type !== "string" || !RELAYED_TYPES.has(parsed.type)) {
      ws.send(JSON.stringify({ type: "error", message: `unknown message type: ${String(parsed.type)}` }));
      return;
    }

    // Forward verbatim to the other side.
    for (const peer of this.ctx.getWebSockets(otherRole(role))) {
      peer.send(message);
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const role = this.roleOf(ws);
    ws.close(code, reason);
    if (role) this.broadcast(otherRole(role), { type: "peer-left", role });
  }

  webSocketError(ws: WebSocket): void {
    const role = this.roleOf(ws);
    ws.close(1011, "socket error");
    if (role) this.broadcast(otherRole(role), { type: "peer-left", role });
  }

  private roleOf(ws: WebSocket): Role | null {
    const tag = this.ctx.getTags(ws).find(isRole);
    return tag ?? null;
  }

  private broadcast(role: Role, payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets(role)) ws.send(data);
  }
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

function otherRole(role: Role): Role {
  return role === "share" ? "view" : "share";
}
