// Thin WebSocket client for the RoomDO signaling relay (worker/room.ts).
// Sends/receives JSON messages; keeps the socket alive with a ping every 25s.

export type Role = "share" | "view";

export type SignalMessage =
  | { type: "hello"; role: Role; peerPresent: boolean }
  // resume: the peer's socket dropped and came back; its call may still be up.
  | { type: "peer-joined"; role: Role; resume?: boolean }
  | { type: "peer-left"; role: Role }
  // id ties an answer and ICE candidates to the offer (and peer connection) they belong
  // to, so replies to a superseded offer can be recognised and dropped.
  | { type: "offer"; id: string; sdp: string }
  | { type: "answer"; id: string; sdp: string }
  | { type: "ice"; id: string; candidate: RTCIceCandidateInit }
  | { type: "bye" }
  // Sent to the relay only (never forwarded) so call health shows up in Worker logs.
  | { type: "stats"; text: string }
  | { type: "error"; message: string };

/** "replaced": another tab/device took this role in the room, so we don't reconnect. */
export type SignalStatus = "connecting" | "open" | "reconnecting" | "replaced" | "closed";

const PING_INTERVAL_MS = 25_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 10_000];
const REPLACED = 4000; // close code from worker/room.ts

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
  private readonly onOnline = () => {
    if (this.stopped || this.ws) return;
    window.clearTimeout(this.retryTimer);
    this.open();
  };

  onMessage: (message: SignalMessage) => void = () => {};
  onStatus: (status: SignalStatus, detail?: string) => void = () => {};

  constructor(code: string, role: Role) {
    this.code = code;
    this.role = role;
  }

  connect(): void {
    this.stopped = false;
    window.addEventListener("online", this.onOnline);
    this.open();
  }

  private open(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const resume = this.everOpened ? "&resume=1" : "";
    const url = `${proto}://${location.host}/api/room/${this.code}/ws?role=${this.role}${resume}`;
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
