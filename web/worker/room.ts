import { DurableObject } from "cloudflare:workers";

/**
 * RoomDO — one instance per room code, acting as a WebSocket relay for WebRTC signaling.
 *
 * Two roles connect: "share" (the device sending its screen) and "view" (devices
 * watching). The room holds one live sharer socket and up to MAX_VIEWERS viewer
 * sockets. Each viewer gets a peer id; the relay stamps it on everything that viewer
 * sends ("from"), and the sharer addresses replies to one viewer with "to". SDP and ICE
 * payloads pass through untouched.
 *
 * Uses the WebSocket Hibernation API (ctx.acceptWebSocket + webSocketMessage handlers)
 * so an idle room is evicted from memory and costs nothing while sockets stay open.
 * Media never touches this object; it goes peer to peer, so the sharer uploads one
 * stream per viewer, which is what caps the room size.
 */

export type Role = "share" | "view";

export const MAX_VIEWERS = 4;

const ROLES: Role[] = ["share", "view"];
type Attachment = { room: string; peer?: string; replaced?: boolean };

// Close codes the client acts on (src/lib/signaling.ts).
const CLOSE_REPLACED = 4000;
const CLOSE_FULL = 4001;

const ACCEPTED_TYPES = new Set(["offer", "answer", "ice", "bye", "stats", "knock", "lobby", "admit", "deny"]);
const PEER_ID = /^[a-z0-9]{8,16}$/;
const MAX_NAME = 40;

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
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    if (!isRole(role)) {
      return new Response("role must be 'share' or 'view'", { status: 400 });
    }
    const room = url.pathname.split("/")[3] ?? "?";
    const resume = url.searchParams.get("resume") === "1";
    const askedPeer = url.searchParams.get("peer") ?? "";

    // The sharer is one socket; a viewer is identified by its peer id. A reconnecting
    // client (same role, or same viewer id) replaces its previous socket rather than
    // being rejected or taking a second slot. Mark the stale socket first: its close
    // event lands later (possibly after the newcomer's offer), and must not be
    // announced as "peer-left" or the other side drops the new call.
    const peer = role === "view" ? (PEER_ID.test(askedPeer) ? askedPeer : newPeerId()) : undefined;
    const stale = role === "share" ? this.live("share") : this.live("view").filter((ws) => attachmentOf(ws).peer === peer);

    if (role === "view" && stale.length === 0 && this.live("view").length >= MAX_VIEWERS) {
      log({ event: "full", room, viewers: MAX_VIEWERS });
      return rejectFull();
    }
    for (const ws of stale) {
      ws.serializeAttachment({ ...attachmentOf(ws), replaced: true } satisfies Attachment);
      ws.close(CLOSE_REPLACED, "replaced by a newer connection");
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ room, peer } satisfies Attachment);

    const other = otherRole(role);
    const peerPresent = this.live(other).length > 0;
    const peers = role === "share" ? this.live("view").map((ws) => attachmentOf(ws).peer) : undefined;
    server.send(JSON.stringify({ type: "hello", role, peerPresent, peer, peers }));
    // Diagnostics for `wrangler tail` / Workers Logs. The browser string helps spot odd
    // clients (TV browsers, old WebViews) when a connection fails.
    log({ event: "join", room, role, peer, peerPresent, resume, reclaimed: stale.length > 0, ua: request.headers.get("User-Agent") ?? "?" });
    this.broadcast(other, { type: "peer-joined", role, peer, resume });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    const role = this.roleOf(ws);
    if (!role) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(message);
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "messages must be JSON objects" }));
      return;
    }
    if (typeof parsed.type !== "string" || !ACCEPTED_TYPES.has(parsed.type)) {
      ws.send(JSON.stringify({ type: "error", message: `unknown message type: ${String(parsed.type)}` }));
      return;
    }
    const { room, peer } = attachmentOf(ws);

    if (parsed.type === "stats") {
      // Diagnostics only: logged, never forwarded to the other peer.
      const text = parsed.text;
      log({ event: "stats", room, from: role, peer, text: typeof text === "string" ? text.slice(0, 500) : "" });
      return;
    }
    logSignal(room, role, peer, parsed);

    if (role === "view") {
      // Stamp the sender's id ourselves; a viewer can't speak for another viewer.
      const out: Record<string, unknown> = { ...parsed, from: peer };
      delete out.to;
      if (parsed.type === "knock") out.name = cleanName(parsed.name);
      this.broadcast("share", out);
      return;
    }

    // Sharer → one viewer. Only "bye" (the sharer stopping) may go to everyone.
    const to = parsed.to;
    if (typeof to !== "string") {
      if (parsed.type === "bye") return this.broadcast("view", parsed);
      ws.send(JSON.stringify({ type: "error", message: `${parsed.type} needs a "to" peer id` }));
      return;
    }
    const target = this.live("view").find((v) => attachmentOf(v).peer === to);
    if (!target) {
      ws.send(JSON.stringify({ type: "error", message: `no viewer ${to} in the room` }));
      return;
    }
    target.send(message);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const { room, peer } = attachmentOf(ws);
    log({ event: "close", room, role: this.roleOf(ws), peer, code, replaced: isReplaced(ws) });
    ws.close(code, reason);
    this.announceLeave(ws);
  }

  webSocketError(ws: WebSocket): void {
    ws.close(1011, "socket error");
    this.announceLeave(ws);
  }

  private announceLeave(ws: WebSocket): void {
    const role = this.roleOf(ws);
    if (role && !isReplaced(ws)) this.broadcast(otherRole(role), { type: "peer-left", role, peer: attachmentOf(ws).peer });
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

/**
 * Browsers can't read the HTTP status of a refused WebSocket upgrade, so a full room is
 * an accepted socket that immediately says why and closes with a code the client knows.
 * Not hibernatable (plain accept), which is fine for a socket that lives a moment.
 */
function rejectFull(): Response {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ type: "error", code: "room-full", message: `room full (${MAX_VIEWERS} viewers max)` }));
  server.close(CLOSE_FULL, "room full");
  return new Response(null, { status: 101, webSocket: client });
}

function newPeerId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Display names are plain text, one line, short. Rendered as text by React, never HTML. */
function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
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

/**
 * Logs signaling traffic with ICE addresses reduced to a kind; IPs are never logged.
 * Names from knocks aren't logged either, only whether one was given.
 */
function logSignal(room: string, from: Role, peer: string | undefined, message: Record<string, unknown>): void {
  const to = typeof message.to === "string" ? message.to : undefined;
  const base = { event: message.type, room, from, peer, to };
  if (message.type === "offer" || message.type === "answer") return log({ ...base, media: describeSdp(message.sdp) });
  if (message.type === "knock") return log({ ...base, named: typeof message.name === "string" && message.name.trim() !== "" });
  if (message.type !== "ice") return log(base);
  const candidate = message.candidate as { candidate?: unknown } | undefined;
  const line = typeof candidate?.candidate === "string" ? candidate.candidate : "";
  const parts = line.split(" ");
  const typ = parts.indexOf("typ");
  log({ ...base, candidate: typ > 0 ? `${parts[typ + 1]} ${parts[2]?.toLowerCase()} ${addressKind(parts[4] ?? "")}` : "end-of-candidates" });
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
