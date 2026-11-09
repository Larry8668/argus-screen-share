// Thin WebSocket client for the RoomDO signaling relay (worker/room.ts).
// Sends/receives JSON messages; keeps the socket alive with a ping every 25s.

export type Role = "share" | "view";

/**
 * Routing between the one sharer and its viewers. "from" is a viewer's peer id, stamped
 * by the relay on everything a viewer sends; the sharer sets "to" to address one
 * viewer. Viewers never set either.
 */
type Routed = { to?: string; from?: string };

export type SignalMessage =
  // peer: our own id (viewers). peers: viewer ids already in the room (sharer).
  | { type: "hello"; role: Role; peerPresent: boolean; peer?: string; peers?: string[] }
  // resume: the peer's socket dropped and came back; its call may still be up.
  | { type: "peer-joined"; role: Role; peer?: string; resume?: boolean }
  | { type: "peer-left"; role: Role; peer?: string }
  // id ties an answer and ICE candidates to the offer (and peer connection) they belong
  // to, so replies to a superseded offer can be recognised and dropped.
  // voiceMid: the media section carrying talk-over voice, as opposed to screen audio.
  | ({ type: "offer"; id: string; sdp: string; voiceMid?: string } & Routed)
  | ({ type: "answer"; id: string; sdp: string } & Routed)
  | ({ type: "ice"; id: string; candidate: RTCIceCandidateInit } & Routed)
  | ({ type: "bye" } & Routed)
  // Viewer → sharer: "I'd like the stream". connected: my call from you is still up.
  | ({ type: "knock"; name?: string; connected?: boolean } & Routed)
  // Sharer → viewer admission. lobby = wait for the sharer (needName: send a name first).
  | ({ type: "lobby"; needName: boolean } & Routed)
  | ({ type: "admit" } & Routed)
  | ({ type: "deny" } & Routed)
  // Sent to the relay only (never forwarded) so call health shows up in Worker logs.
  | { type: "stats"; text: string }
  | { type: "error"; message: string; code?: string };

/**
 * "replaced": another tab/device took this role (or this viewer slot) in the room.
 * "full": the room already has the maximum number of viewers.
 * Neither reconnects by itself.
 */
export type SignalStatus = "connecting" | "open" | "reconnecting" | "replaced" | "full" | "closed";

const PING_INTERVAL_MS = 25_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 10_000];
// Close codes from worker/room.ts.
const REPLACED = 4000;
const FULL = 4001;

/**
 * Reconnects by itself after an unexpected close (Wi-Fi blip, laptop sleep, server
 * restart), with backoff, and immediately when the browser reports it's back online.
 * Reconnects carry ?resume=1 so the other side knows not to tear down a live call.
 */
export class Signaling {
  private ws: WebSocket | null = null;
  private pingTimer: number | undefined;
  private retryTimer: number | undefined;
  private attempt = 0;
  private stopped = false;
  private everOpened = false;
  private readonly code: string;
  private readonly role: Role;
  /** Viewer slot id; sent on every (re)connect so the relay hands back the same slot. */
  peer: string | null;
  private readonly onOnline = () => {
    if (this.stopped || this.ws) return;
    window.clearTimeout(this.retryTimer);
    this.open();
  };

  onMessage: (message: SignalMessage) => void = () => {};
  onStatus: (status: SignalStatus, detail?: string) => void = () => {};

  constructor(code: string, role: Role, peer: string | null = null) {
    this.code = code;
    this.role = role;
    this.peer = peer;
  }

  connect(): void {
    this.stopped = false;
    window.addEventListener("online", this.onOnline);
    this.open();
  }

  private open(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const resume = this.everOpened ? "&resume=1" : "";
    const peer = this.peer ? `&peer=${encodeURIComponent(this.peer)}` : "";
    const url = `${proto}://${location.host}/api/room/${this.code}/ws?role=${this.role}${peer}${resume}`;
    this.onStatus(this.everOpened ? "reconnecting" : "connecting");

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.everOpened = true;
      this.onStatus("open");
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, PING_INTERVAL_MS);
    };
    ws.onmessage = (event) => {
      if (event.data === "pong") return;
      try {
        this.onMessage(JSON.parse(event.data) as SignalMessage);
      } catch {
        console.warn("signaling: ignoring non-JSON message", event.data);
      }
    };
    ws.onclose = (event) => {
      window.clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      const detail = `${event.code}${event.reason ? ` ${event.reason}` : ""}`;
      if (this.stopped) return this.onStatus("closed", detail);
      if (event.code === REPLACED) {
        this.stopped = true;
        return this.onStatus("replaced", detail);
      }
      if (event.code === FULL) {
        this.stopped = true;
        return this.onStatus("full", detail);
      }
      const delay = RETRY_DELAYS_MS[Math.min(this.attempt++, RETRY_DELAYS_MS.length - 1)];
      this.onStatus("reconnecting", `${detail}; retry in ${delay / 1000}s`);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => {
      // onclose follows with the code; nothing useful is exposed here.
    };
  }

  send(message: SignalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("signaling: dropped message, socket not open", message.type);
    }
  }

  close(): void {
    this.stopped = true;
    window.removeEventListener("online", this.onOnline);
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.retryTimer);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000, "done");
    this.ws = null;
  }
}
