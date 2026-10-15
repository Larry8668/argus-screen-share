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
type Attachment = { room: string; replaced?: boolean };

const ACCEPTED_TYPES = new Set(["offer", "answer", "ice", "bye", "stats"]);

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
    // Mark it first: its close event lands later (possibly after the newcomer's offer),
    // and must not be announced as "peer-left" or the other side drops the new call.
    const room = new URL(request.url).pathname.split("/")[3] ?? "?";
    for (const stale of this.live(role)) {
      stale.serializeAttachment({ ...attachmentOf(stale), replaced: true } satisfies Attachment);
      stale.close(4000, "replaced by a newer connection");
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ room } satisfies Attachment);

    const other = otherRole(role);
    const peerPresent = this.live(other).length > 0;
    server.send(JSON.stringify({ type: "hello", role, peerPresent }));
    // Diagnostics for `wrangler tail` / Workers Logs. The browser string helps spot odd
    // clients (TV browsers, old WebViews) when a connection fails.
    log({ event: "join", room, role, peerPresent, ua: request.headers.get("User-Agent") ?? "?" });
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
    if (typeof parsed.type !== "string" || !ACCEPTED_TYPES.has(parsed.type)) {
      ws.send(JSON.stringify({ type: "error", message: `unknown message type: ${String(parsed.type)}` }));
      return;
    }

    if (parsed.type === "stats") {
      // Diagnostics only: logged, never forwarded to the other peer.
      const text = (parsed as { text?: unknown }).text;
      log({ event: "stats", room: attachmentOf(ws).room, from: role, text: typeof text === "string" ? text.slice(0, 500) : "" });
      return;
    }
    logSignal(attachmentOf(ws).room, role, parsed);

    // Forward verbatim to the other side.
    for (const peer of this.live(otherRole(role))) {
      peer.send(message);
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    log({ event: "close", room: attachmentOf(ws).room, role: this.roleOf(ws), code, replaced: isReplaced(ws) });
    ws.close(code, reason);
    this.announceLeave(ws);
  }

  webSocketError(ws: WebSocket): void {
    ws.close(1011, "socket error");
    this.announceLeave(ws);
  }

  private announceLeave(ws: WebSocket): void {
    const role = this.roleOf(ws);
    if (role && !isReplaced(ws)) this.broadcast(otherRole(role), { type: "peer-left", role });
  }

  /** Sockets for a role, minus ones already replaced by a reconnect. */
  private live(role: Role): WebSocket[] {
    return this.ctx.getWebSockets(role).filter((ws) => !isReplaced(ws));
  }

  private roleOf(ws: WebSocket): Role | null {
    const tag = this.ctx.getTags(ws).find(isRole);
    return tag ?? null;
  }

  private broadcast(role: Role, payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const ws of this.live(role)) ws.send(data);
  }
}

function attachmentOf(ws: WebSocket): Attachment {
  return (ws.deserializeAttachment() as Attachment | null) ?? { room: "?" };
}

function isReplaced(ws: WebSocket): boolean {
  return attachmentOf(ws).replaced === true;
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}

/** Logs signaling traffic with ICE addresses reduced to a kind; IPs are never logged. */
function logSignal(room: string, from: Role, message: { type?: unknown; candidate?: { candidate?: unknown } }): void {
  if (message.type === "offer" || message.type === "answer") {
    return log({ event: message.type, room, from, media: describeSdp((message as { sdp?: unknown }).sdp) });
  }
  if (message.type !== "ice") return log({ event: message.type, room, from });
  const line = typeof message.candidate?.candidate === "string" ? message.candidate.candidate : "";
  const parts = line.split(" ");
  const typ = parts.indexOf("typ");
  log({
    event: "ice",
    room,
    from,
    candidate: typ > 0 ? `${parts[typ + 1]} ${parts[2]?.toLowerCase()} ${addressKind(parts[4] ?? "")}` : "end-of-candidates",
  });
}

/** "audio sendonly opus", "video sendonly H264": per media section, kind + direction + first codec. */
function describeSdp(sdp: unknown): string[] {
  if (typeof sdp !== "string") return [];
  return sdp.split(/\r?\nm=/).slice(1).map((section) => {
    const [header] = section.split(/\r?\n/);
    const [kind, port, , firstPayload] = header.split(" ");
    const direction = /a=(sendrecv|sendonly|recvonly|inactive)/.exec(section)?.[1] ?? "?";
    const codec = new RegExp(`a=rtpmap:${firstPayload} ([^/\\s]+)`).exec(section)?.[1] ?? "?";
    return `${kind} ${port === "0" ? "rejected" : direction} ${codec}`;
  });
}

// Same buckets as addressKind in src/lib/peer.ts (separate bundle, so duplicated).
function addressKind(address: string): string {
  if (address.endsWith(".local")) return "mdns";
  if (address.includes(":")) return "ipv6";
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(address)) return "lan-ipv4";
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) return "cgnat-ipv4";
  return "public-ipv4";
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

function otherRole(role: Role): Role {
  return role === "share" ? "view" : "share";
}
