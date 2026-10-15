// Thin WebSocket client for the RoomDO signaling relay (worker/room.ts).
// Sends/receives JSON messages; keeps the socket alive with a ping every 25s.

export type Role = "share" | "view";

export type SignalMessage =
  | { type: "hello"; role: Role; peerPresent: boolean }
  | { type: "peer-joined"; role: Role }
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

export type SignalStatus = "connecting" | "open" | "closed";

const PING_INTERVAL_MS = 25_000;

export class Signaling {
  private ws: WebSocket | null = null;
  private pingTimer: number | undefined;
  private readonly code: string;
  private readonly role: Role;

  onMessage: (message: SignalMessage) => void = () => {};
  onStatus: (status: SignalStatus, detail?: string) => void = () => {};

  constructor(code: string, role: Role) {
    this.code = code;
    this.role = role;
  }

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/api/room/${this.code}/ws?role=${this.role}`;
    this.onStatus("connecting");

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
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
      this.onStatus("closed", `${event.code}${event.reason ? ` ${event.reason}` : ""}`);
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
    window.clearInterval(this.pingTimer);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000, "done");
    this.ws = null;
  }
}
