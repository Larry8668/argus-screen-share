// One side of a room: Signaling plus one RTCPeerConnection at a time, so pages only
// deal with UI state. The Sender owns local media and makes a fresh offer to every
// peer that joins; the Receiver answers offers and hands incoming tracks to the page.
// Screen share, camera share and phone-as-mic are all built from these two classes.

import {
  createPeer,
  describeCandidate,
  describePairs,
  describeSelectedPair,
  describeAudio,
  describeVideo,
  loadIceServers,
  type VideoCounters,
  preferH264,
  type Logger,
} from "./peer";
import { Signaling, type Role, type SignalMessage } from "./signaling";

/**
 * "waiting" covers both "no peer yet" and "peer left". "reconnecting": our link to the
 * room dropped and is coming back. "replaced": this room/role was opened elsewhere.
 */
export type PeerState = "waiting" | "connecting" | "connected" | "failed" | "reconnecting" | "replaced";

export interface SessionHandlers {
  log: Logger;
  onState?: (state: PeerState) => void;
  /** Candidate pair carrying media, e.g. "srflx ↔ host"; null when there is no call. */
  onPath?: (path: string | null) => void;
  /** Video health line (resolution, fps, codec, decoder/encoder); null when there is no call. */
  onVideo?: (summary: string | null) => void;
  onAudio?: (summary: string | null) => void;
}

export interface ReceiverHandlers extends SessionHandlers {
  onTrack?: (track: MediaStreamTrack, stream: MediaStream) => void;
  /** The current call ended; drop any media that came from it. */
  onPeerGone?: () => void;
}

const STATS_INTERVAL_MS = 2000;
const STATS_REPORT_EVERY = 3; // polls; i.e. one relay log line per 6s
const AUTO_RETRY_DELAY_MS = 2500;
const AUTO_RETRY_MAX = 3;

export function stateText(state: PeerState, waitingFor: string): string {
  switch (state) {
    case "waiting":
      return `Waiting for ${waitingFor}`;
    case "connecting":
      return "Connecting…";
    case "connected":
      return "Connected";
    case "failed":
      return "Couldn't connect";
    case "reconnecting":
      return "Reconnecting…";
    case "replaced":
      return "Opened in another tab";
  }
}

abstract class Session {
  protected pc: RTCPeerConnection | null = null;
  /** Offer id of the current call; see SignalMessage. */
  protected callId: string | null = null;
  private sig: Signaling | null = null;
  private statsTimer: number | undefined;
  private iceServers: RTCIceServer[] = [];
  private active = false;
  // Last view of the candidate pairs while ICE was still trying; Chrome can drop them
  // from getStats once the connection has failed.
  private lastPairs: string[] = [];
  protected readonly code: string;
  private readonly role: Role;
  private readonly handlers: SessionHandlers;

  constructor(code: string, role: Role, handlers: SessionHandlers) {
    this.code = code;
    this.role = role;
    this.handlers = handlers;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener("pagehide", this.onPageHide);
    this.setState("waiting");
    // Servers must be known before signaling starts: openPeer runs synchronously when an
    // offer arrives, so that ICE for it isn't mistaken for stale.
    void loadIceServers(this.handlers.log).then((servers) => {
      if (!this.active) return;
      this.iceServers = servers;
      this.connectSignaling();
    });
  }

  private connectSignaling(): void {
    const sig = new Signaling(this.code, this.role);
    sig.onStatus = (status, detail) => {
      this.log(`signaling socket: ${status}${detail ? ` (${detail})` : ""}`);
      // A live call doesn't need the room link; media keeps flowing peer to peer.
      if (status === "reconnecting" && !this.isConnected()) this.setState("reconnecting");
      if (status === "replaced") {
        // Another tab/device took our place. Drop the call and don't auto-retry, or the
        // two would keep kicking each other out; only a deliberate Retry takes it back.
        this.closePeer();
        this.setState("replaced");
      }
    };
    sig.onMessage = (message) => {
      if (message.type === "hello" && !this.isConnected()) this.setState("waiting");
      this.handle(message).catch((err: Error) => this.log(`failed handling ${message.type}: ${err.message}`));
    };
    sig.connect();
    this.sig = sig;
  }

  /** Drop the current attempt and rejoin the room from scratch; the sender re-offers. */
  retry(): void {
    if (!this.active) return;
    this.log("retrying: rejoining the room");
    this.closePeer();
    this.sig?.close();
    this.setState("waiting");
    this.connectSignaling();
  }

  protected isConnected(): boolean {
    return this.pc?.connectionState === "connected";
  }

  // Tab closed or navigated away: tell the other side right away instead of letting
  // it wait for the connection to time out.
  private readonly onPageHide = () => this.stop();

  stop(): void {
    window.removeEventListener("pagehide", this.onPageHide);
    this.active = false;
    this.sig?.send({ type: "bye" });
    this.closePeer();
    this.sig?.close();
    this.sig = null;
  }

  protected abstract handle(message: SignalMessage): Promise<void>;
  protected onConnected(): void {}
  protected onFailed(): void {}

  /**
   * peer-left only means the other side's *room link* closed. A live call survives
   * that (a Wi-Fi blip on their signaling socket), so keep it; a real departure arrives
   * as "bye", or as the connection failing.
   */
  protected peerLeft(who: string): void {
    if (this.isConnected()) {
      this.log(`${who}'s room link dropped; call still up`);
      return;
    }
    this.log(`${who} left`);
    this.closePeer();
    this.setState("waiting");
  }

  protected peerSaidBye(who: string): void {
    this.log(`${who} left`);
    this.closePeer();
    this.setState("waiting");
  }

  protected log(line: string): void {
    this.handlers.log(line);
  }

  protected setState(state: PeerState): void {
    this.handlers.onState?.(state);
  }

  protected send(message: SignalMessage): void {
    this.sig?.send(message);
  }

  /** Replace any existing call with a fresh peer connection for offer `id`. */
  protected openPeer(id: string): RTCPeerConnection {
    this.closePeer();
    const pc = createPeer(this.handlers.log, this.iceServers);
    this.lastPairs = [];
    this.pc = pc;
    this.callId = id;
    pc.onicecandidate = (event) => {
      if (event.candidate) this.send({ type: "ice", id, candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      this.log(`connection: ${pc.connectionState}`);
      if (pc.connectionState === "connecting") {
        this.watchPairs(pc);
      } else if (pc.connectionState === "connected") {
        this.setState("connected");
        this.onConnected();
        this.pollStats(pc);
      } else if (pc.connectionState === "failed") {
        this.setState("failed");
        void this.logPairs(pc);
        this.onFailed();
      }
    };
    return pc;
  }

  protected closePeer(): void {
    window.clearInterval(this.statsTimer);
    this.handlers.onPath?.(null);
    this.handlers.onVideo?.(null);
    this.handlers.onAudio?.(null);
    this.pc?.close();
    this.pc = null;
    this.callId = null;
  }

  /** True if this message belongs to a call that has since been replaced. */
  protected isStale(message: { id: string }): boolean {
    return message.id !== this.callId;
  }

  protected async addIce(pc: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
    if (candidate.candidate) this.log(`remote candidate: ${describeCandidate(candidate.candidate)}`);
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      this.log(`bad ice candidate: ${(err as Error).message}`);
    }
  }

  private watchPairs(pc: RTCPeerConnection): void {
    window.clearInterval(this.statsTimer);
    this.statsTimer = window.setInterval(async () => {
      if (pc.connectionState !== "connecting") return;
      const pairs = await describePairs(pc);
      if (pairs.length) this.lastPairs = pairs;
    }, 1000);
  }

  private async logPairs(pc: RTCPeerConnection): Promise<void> {
    window.clearInterval(this.statsTimer);
    const now = await describePairs(pc);
    const pairs = now.length ? now : this.lastPairs;
    if (!pairs.length) return this.log("no candidate pairs were formed (no usable remote candidates)");
    this.log(`candidate pairs tried (${pairs.length}):`);
    for (const line of pairs.slice(0, 12)) this.log(`  ${line}`);
  }

  private pollStats(pc: RTCPeerConnection): void {
    window.clearInterval(this.statsTimer);
    const counters: { current?: VideoCounters } = {};
    let polls = 0;
    this.statsTimer = window.setInterval(async () => {
      if (pc.connectionState !== "connected") return;
      const path = await describeSelectedPair(pc);
      if (path) this.handlers.onPath?.(path);
      const video = await describeVideo(pc, counters);
      if (video) this.handlers.onVideo?.(video);
      const audio = await describeAudio(pc);
      if (audio) this.handlers.onAudio?.(audio);
      if (++polls % STATS_REPORT_EVERY === 0) {
        this.send({ type: "stats", text: [path, video && `video ${video}`, audio && `audio ${audio}`].filter(Boolean).join(" | ") });
      }
    }, STATS_INTERVAL_MS);
  }

}

export class Sender extends Session {
  private readonly stream: MediaStream;
  // What the encoder gives up first when bandwidth runs short.
  private degradation: RTCDegradationPreference = "balanced";

  constructor(code: string, stream: MediaStream, handlers: SessionHandlers) {
    super(code, "share", handlers);
    this.stream = stream;
  }

  protected async handle(message: SignalMessage): Promise<void> {
    switch (message.type) {
      case "hello":
        this.log(`joined room ${this.code}${message.peerPresent ? ", peer already waiting" : ""}`);
        if (message.peerPresent && !this.isConnected()) await this.offer();
        break;
      case "peer-joined":
        if (message.resume && this.isConnected()) {
          this.log("peer's room link came back; call still up");
          break;
        }
        this.log("peer joined");
        await this.offer();
        break;
      case "answer":
        if (!this.pc || this.isStale(message)) return this.log("answer for an old offer, ignoring");
        await this.pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
        this.log("answer applied");
        await this.applyDegradation(this.pc);
        break;
      case "ice":
        if (this.pc && !this.isStale(message)) await this.addIce(this.pc, message.candidate);
        break;
      case "peer-left":
        this.peerLeft("peer");
        break;
      case "bye":
        this.peerSaidBye("peer");
        break;
      case "error":
        this.log(`relay error: ${message.message}`);
        break;
    }
  }

  /** "maintain-resolution" keeps text sharp (fps drops); "maintain-framerate" keeps motion smooth (resolution drops). */
  async setDegradation(preference: RTCDegradationPreference): Promise<void> {
    this.degradation = preference;
    if (this.pc) await this.applyDegradation(this.pc);
  }

  private async applyDegradation(pc: RTCPeerConnection): Promise<void> {
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    try {
      const params = sender.getParameters();
      params.degradationPreference = this.degradation;
      await sender.setParameters(params);
    } catch (err) {
      this.log(`couldn't set degradation preference: ${(err as Error).message}`);
    }
  }

  private async offer(): Promise<void> {
    const id = crypto.randomUUID();
    const pc = this.openPeer(id);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.pc !== pc) return; // another peer joined meanwhile and got a newer offer
    this.send({ type: "offer", id, sdp: offer.sdp! });
    this.setState("connecting");
    this.log("offer sent");
  }
}

export class Receiver extends Session {
  private readonly receiverHandlers: ReceiverHandlers;
  private retries = 0;
  private retryTimer: number | undefined;
  // ICE can arrive while the offer is still being applied; hold it until then.
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(code: string, handlers: ReceiverHandlers) {
    super(code, "view", handlers);
    this.receiverHandlers = handlers;
  }

  protected onConnected(): void {
    this.retries = 0;
  }

  // The receiver can't re-offer, so it rejoins the room, which makes the sender offer
  // again. A few automatic tries cover transient failures; after that the page's Retry.
  protected onFailed(): void {
    if (this.retries >= AUTO_RETRY_MAX) return this.log("auto-retry limit reached; use Retry");
    this.retries++;
    this.log(`auto-retry ${this.retries}/${AUTO_RETRY_MAX} in ${AUTO_RETRY_DELAY_MS / 1000}s`);
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.retry(), AUTO_RETRY_DELAY_MS);
  }

  stop(): void {
    window.clearTimeout(this.retryTimer);
    super.stop();
  }

  protected async handle(message: SignalMessage): Promise<void> {
    switch (message.type) {
      case "hello":
        this.log(`joined room ${this.code}${message.peerPresent ? ", sender is here, waiting for offer" : ", no sender yet"}`);
        break;
      case "peer-joined":
        this.log("sender joined, waiting for offer");
        break;
      case "offer":
        await this.answer(message.id, message.sdp);
        break;
      case "ice":
        if (this.isStale(message)) break;
        if (this.pc?.remoteDescription) await this.addIce(this.pc, message.candidate);
        else this.pendingIce.push(message.candidate);
        break;
      case "peer-left":
        this.peerLeft("sender");
        break;
      case "bye":
        this.peerSaidBye("sender");
        break;
      case "error":
        this.log(`relay error: ${message.message}`);
        break;
    }
  }

  protected closePeer(): void {
    super.closePeer();
    this.pendingIce = [];
    this.receiverHandlers.onPeerGone?.();
  }

  private async answer(id: string, sdp: string): Promise<void> {
    const pc = this.openPeer(id);
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      this.log(`receiving ${event.track.kind} track`);
      this.receiverHandlers.onTrack?.(event.track, stream);
    };

    await pc.setRemoteDescription({ type: "offer", sdp });
    if (this.pc !== pc) return; // a newer offer arrived meanwhile
    preferH264(pc, (line) => this.log(line));
    for (const candidate of this.pendingIce.splice(0)) await this.addIce(pc, candidate);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (this.pc !== pc) return;
    this.send({ type: "answer", id, sdp: answer.sdp! });
    this.setState("connecting");
    this.log("answer sent");
  }
}
