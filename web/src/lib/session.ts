// One side of a room: Signaling plus the calls (RTCPeerConnections) it negotiates, so
// pages only deal with UI state. The Sender owns local media and makes one call per
// viewer (a mesh: the sharer uploads one stream per viewer); the Receiver answers the
// sender's offer and hands incoming tracks to the page. Screen share, camera share and
// phone-as-mic are all built from these two classes.
//
// Joining is knock-based: a viewer announces itself ("knock", with an optional name),
// and the sender decides whether and when to offer. In a private room the sharer's page
// is asked first (admit/deny); in a public room the offer goes out straight away.

import { Call, type CallOptions, type CallState } from "./call";
import { loadIceServers, preferH264, type Logger } from "./peer";
import { Signaling, type Role, type SignalMessage } from "./signaling";

/**
 * "waiting" covers both "no peer yet" and "peer left". "reconnecting": our link to the
 * room dropped and is coming back. "replaced": this room/role (or viewer slot) was
 * opened elsewhere. "full": no viewer slot free. Receiver only: "need-name" (private
 * room, say who you are), "lobby" (waiting to be let in), "declined" (sharer said no).
 */
export type PeerState =
  | "waiting"
  | "connecting"
  | "connected"
  | "failed"
  | "reconnecting"
  | "replaced"
  | "full"
  | "need-name"
  | "lobby"
  | "declined";

export interface SessionHandlers {
  log: Logger;
  onState?: (state: PeerState) => void;
  /** Candidate pair carrying media, e.g. "srflx ↔ host"; null when there is no call. */
  onPath?: (path: string | null) => void;
  /** Video health line (resolution, fps, codec, decoder/encoder); null when there is no call. */
  onVideo?: (summary: string | null) => void;
  onAudio?: (summary: string | null) => void;
  /** Talk-over voice from `peer` (a viewer id on the sender, "sharer" on the receiver); null when it's gone. */
  onVoiceTrack?: (peer: string, track: MediaStreamTrack | null) => void;
}

export interface ReceiverHandlers extends SessionHandlers {
  onTrack?: (track: MediaStreamTrack, stream: MediaStream) => void;
  /** The current call ended; drop any media that came from it. */
  onPeerGone?: () => void;
}

/** One viewer as the sharer sees it. */
export interface ViewerInfo {
  peer: string;
  /** Display name the viewer gave; "" if none. */
  name: string;
  /** "pending": knocked on a private room, waiting for Allow/Deny. */
  status: CallState | "pending" | "waiting";
  path: string | null;
  video: string | null;
  voice: string | null;
}

export interface SenderHandlers extends SessionHandlers {
  onViewers?: (viewers: ViewerInfo[]) => void;
}

export const MAX_VIEWERS = 4; // same as worker/room.ts
const AUTO_RETRY_DELAY_MS = 2500;
const AUTO_RETRY_MAX = 3;
const NAME_MAX = 40;

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
    case "full":
      return "Room full";
    case "need-name":
      return "Name needed";
    case "lobby":
      return "Waiting to be let in";
    case "declined":
      return "Declined";
  }
}

/** States about getting into the room rather than about the connection. */
export function isAdmissionState(state: PeerState): boolean {
  return state === "need-name" || state === "lobby" || state === "declined" || state === "full";
}

/** Same rules as the relay: one line of plain text, short. */
export function cleanName(name: string): string {
  return name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

abstract class Session {
  protected sig: Signaling | null = null;
  private iceServers: RTCIceServer[] = [];
  private active = false;
  /** Our own talk-over mic; null = not talking. Applied to every call's voice sender. */
  protected mic: MediaStreamTrack | null = null;
  protected readonly code: string;
  private readonly role: Role;
  protected readonly handlers: SessionHandlers;

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
    // Servers must be known before signaling starts: a call opens synchronously when an
    // offer arrives, so that ICE for it isn't mistaken for stale.
    void loadIceServers(this.handlers.log).then((servers) => {
      if (!this.active) return;
      this.iceServers = servers;
      this.connectSignaling();
    });
  }

  private connectSignaling(): void {
    const sig = new Signaling(this.code, this.role, this.peerId());
    sig.onStatus = (status, detail) => {
      this.log(`signaling socket: ${status}${detail ? ` (${detail})` : ""}`);
      // A live call doesn't need the room link; media keeps flowing peer to peer.
      if (status === "reconnecting" && !this.isConnected()) this.setState("reconnecting");
      if (status === "replaced" || status === "full") {
        // replaced: another tab/device took our place. Drop the call and don't
        // auto-retry, or the two would keep kicking each other out; only a deliberate
        // Retry takes it back. full: no slot; Retry tries again.
        this.closeAll();
        this.setState(status);
      }
      this.onSignalStatus(status);
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
    this.closeAll();
    this.sig?.close();
    this.setState("waiting");
    this.connectSignaling();
  }

  // Tab closed or navigated away: tell the other side right away instead of letting
  // it wait for the connection to time out.
  private readonly onPageHide = () => this.stop();

  stop(): void {
    window.removeEventListener("pagehide", this.onPageHide);
    this.active = false;
    this.sig?.send({ type: "bye" });
    this.closeAll();
    this.sig?.close();
    this.sig = null;
  }

  /**
   * Start or stop sending our talk-over voice. Swaps the track on the existing voice
   * sender (RTCRtpSender.replaceTrack), so no renegotiation is needed; null sends nothing.
   */
  setMic(track: MediaStreamTrack | null): void {
    this.mic = track;
    for (const call of this.calls()) this.applyMic(call);
  }

  protected applyMic(call: Call): void {
    if (!call.voice) return;
    call.voice.sender.replaceTrack(this.mic).catch((err: Error) => this.log(`couldn't switch mic: ${err.message}`));
  }

  protected abstract handle(message: SignalMessage): Promise<void>;
  protected abstract isConnected(): boolean;
  protected abstract calls(): Call[];
  protected abstract closeAll(): void;
  /** Viewer slot id to ask the relay for; the sender has none. */
  protected peerId(): string | null {
    return null;
  }
  protected onSignalStatus(_status: string): void {}

  /** extra.to addresses every message about this call to one viewer (sender side). */
  protected openCall(id: string, log: Logger, extra: { to?: string }, events: Pick<CallOptions, "onState" | "onStats">): Call {
    const statsPrefix = extra.to ? `[${extra.to.slice(0, 6)}] ` : "";
    return new Call({
      id,
      iceServers: this.iceServers,
      log,
      send: (message) => this.send({ ...message, ...extra } as SignalMessage),
      report: (text) => this.send({ type: "stats", text: statsPrefix + text }),
      ...events,
    });
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
}

interface Viewer {
  peer: string;
  name: string;
  call: Call | null;
  pending: boolean;
}

export interface SenderOptions {
  /** Add a sendrecv audio section for talk-over voice (screen share). Off for phone-as-mic. */
  voice?: boolean;
  /** Ask the page before letting each viewer in. */
  private?: boolean;
}

export class Sender extends Session {
  private readonly stream: MediaStream;
  private readonly senderHandlers: SenderHandlers;
  private readonly withVoice: boolean;
  // A stream of its own for the voice track, so it never shares an msid with the screen.
  private readonly voiceStream = new MediaStream();
  private readonly viewers = new Map<string, Viewer>();
  private privateRoom: boolean;
  // What the encoder gives up first when bandwidth runs short.
  private degradation: RTCDegradationPreference = "balanced";
  private lastState: PeerState | null = null;

  constructor(code: string, stream: MediaStream, handlers: SenderHandlers, options: SenderOptions = {}) {
    super(code, "share", handlers);
    this.stream = stream;
    this.senderHandlers = handlers;
    this.withVoice = options.voice ?? false;
    this.privateRoom = options.private ?? false;
  }

  protected calls(): Call[] {
    return [...this.viewers.values()].flatMap((v) => (v.call ? [v.call] : []));
  }

  protected isConnected(): boolean {
    return this.calls().some((c) => c.connected);
  }

  protected closeAll(): void {
    for (const v of this.viewers.values()) {
      v.call?.close();
      this.handlers.onVoiceTrack?.(v.peer, null);
    }
    this.viewers.clear();
    this.update();
  }

  protected async handle(message: SignalMessage): Promise<void> {
    switch (message.type) {
      case "hello": {
        const n = message.peers?.length ?? 0;
        this.log(`joined room ${this.code}${n ? `, ${n} viewer${n > 1 ? "s" : ""} here` : ""}`);
        break;
      }
      case "peer-joined":
        if (!message.peer) break;
        if (message.resume && this.viewers.get(message.peer)?.call?.connected) {
          this.log(`${this.label(message.peer)}'s room link came back; call still up`);
        } else {
          this.log(`viewer ${message.peer.slice(0, 6)} joined the room`);
        }
        break;
      case "knock":
        if (message.from) await this.onKnock(message.from, cleanName(message.name ?? ""), message.connected === true);
        break;
      case "answer": {
        const call = message.from ? this.viewers.get(message.from)?.call : null;
        if (!call || call.id !== message.id) return this.log("answer for an old offer, ignoring");
        await call.pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
        await call.flushIce();
        this.log(`${this.label(message.from!)}: answer applied`);
        await this.applyDegradation(call);
        break;
      }
      case "ice": {
        const call = message.from ? this.viewers.get(message.from)?.call : null;
        if (call && call.id === message.id) await call.addIce(message.candidate);
        break;
      }
      case "peer-left":
        if (!message.peer || !this.viewers.has(message.peer)) break;
        // Only the viewer's *room link* closed. A live call survives that (a Wi-Fi blip
        // on their signaling socket), so keep it; a real departure arrives as "bye", or
        // as the connection failing.
        if (this.viewers.get(message.peer)?.call?.connected) {
          this.log(`${this.label(message.peer)}'s room link dropped; call still up`);
        } else {
          this.dropViewer(message.peer, "left");
        }
        break;
      case "bye":
        if (message.from) this.dropViewer(message.from, "left");
        break;
      case "error":
        this.log(`relay error: ${message.message}`);
        break;
    }
  }

  private async onKnock(peer: string, name: string, theyreConnected: boolean): Promise<void> {
    const known = this.viewers.get(peer);
    const viewer: Viewer = known ?? { peer, name, call: null, pending: false };
    if (name) viewer.name = name;
    this.viewers.set(peer, viewer);

    // Their link to the room came back but the call never dropped: nothing to redo.
    if (theyreConnected && viewer.call?.connected) {
      this.log(`${this.label(peer)} is back in the room; call still up`);
      return this.update();
    }
    if (this.privateRoom && !this.isAdmitted(peer)) {
      if (!viewer.name) {
        this.send({ type: "lobby", to: peer, needName: true });
        this.log(`viewer ${peer.slice(0, 6)} knocked without a name; asked for one`);
        return this.update();
      }
      viewer.pending = true;
      this.send({ type: "lobby", to: peer, needName: false });
      this.log(`${this.label(peer)} wants to watch; waiting for Allow/Deny`);
      return this.update();
    }
    await this.offer(peer);
  }

  /** Private room: let a knocking viewer in. Remembered for this room in this tab. */
  async admit(peer: string): Promise<void> {
    const viewer = this.viewers.get(peer);
    if (!viewer) return this.log(`can't admit ${peer.slice(0, 6)}: no longer here`);
    this.rememberAdmitted(peer);
    viewer.pending = false;
    this.log(`allowed ${this.label(peer)}`);
    this.send({ type: "admit", to: peer });
    await this.offer(peer);
  }

  deny(peer: string): void {
    if (!this.viewers.has(peer)) return;
    this.log(`declined ${this.label(peer)}`);
    this.send({ type: "deny", to: peer });
    this.dropViewer(peer, "declined");
  }

  /** Switching to private keeps everyone already watching; switching to public lets everyone waiting in. */
  setPrivate(on: boolean): void {
    if (on === this.privateRoom) return;
    this.privateRoom = on;
    this.log(`room is now ${on ? "private: new viewers need your OK" : "public: anyone with the code can watch"}`);
    for (const v of [...this.viewers.values()]) {
      if (on && v.call) this.rememberAdmitted(v.peer);
      if (!on && v.pending) void this.admit(v.peer);
    }
  }

  /** "maintain-resolution" keeps text sharp (fps drops); "maintain-framerate" keeps motion smooth (resolution drops). */
  async setDegradation(preference: RTCDegradationPreference): Promise<void> {
    this.degradation = preference;
    await Promise.all(this.calls().map((c) => this.applyDegradation(c)));
  }

  private async applyDegradation(call: Call): Promise<void> {
    const sender = call.pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    try {
      const params = sender.getParameters();
      params.degradationPreference = this.degradation;
      await sender.setParameters(params);
    } catch (err) {
      this.log(`couldn't set degradation preference: ${(err as Error).message}`);
    }
  }

  private async offer(peer: string): Promise<void> {
    const viewer = this.viewers.get(peer);
    if (!viewer) return;
    viewer.call?.close();
    const label = this.label(peer);
    const log = (line: string) => this.log(`${label}: ${line}`);
    const call = this.openCall(crypto.randomUUID(), log, { to: peer }, { onState: () => this.onCallState(peer, call), onStats: () => this.update() });
    viewer.call = call;
    viewer.pending = false;

    const { pc } = call;
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    if (this.withVoice) {
      // Voice rides each sharer↔viewer call, so the sharer hears every viewer and every
      // viewer hears the sharer. Viewers don't hear each other: that would need
      // viewer↔viewer connections (or the sharer re-mixing voices), which this mesh
      // deliberately doesn't have.
      call.voice = pc.addTransceiver("audio", { direction: "sendrecv", streams: [this.voiceStream] });
      this.applyMic(call);
      pc.ontrack = (event) => {
        if (event.transceiver !== call.voice) return;
        log("receiving their voice channel");
        this.handlers.onVoiceTrack?.(peer, event.track);
      };
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (viewer.call !== call || this.viewers.get(peer) !== viewer) return; // superseded meanwhile
    this.send({ type: "offer", to: peer, id: call.id, sdp: offer.sdp!, voiceMid: call.voice?.mid ?? undefined });
    log("offer sent");
    this.update();
  }

  private onCallState(peer: string, call: Call): void {
    if (this.viewers.get(peer)?.call !== call) return;
    if (call.state === "failed") this.log(`${this.label(peer)}: call failed; they'll rejoin to retry`);
    this.update();
  }

  private dropViewer(peer: string, why: string): void {
    const viewer = this.viewers.get(peer);
    if (!viewer) return;
    this.log(`${this.label(peer)} ${why}`);
    viewer.call?.close();
    this.viewers.delete(peer);
    this.handlers.onVoiceTrack?.(peer, null);
    this.update();
  }

  /** Recompute the page-facing summary: overall state, the viewer list, and stats lines. */
  private update(): void {
    const list = [...this.viewers.values()];
    const calls = list.flatMap((v) => (v.call ? [v.call] : []));
    const state: PeerState = calls.some((c) => c.connected)
      ? "connected"
      : calls.some((c) => c.state === "connecting")
        ? "connecting"
        : calls.some((c) => c.state === "failed")
          ? "failed"
          : "waiting";
    if (state !== this.lastState) this.setState(state);
    this.senderHandlers.onViewers?.(
      list.map((v) => ({
        peer: v.peer,
        name: v.name,
        status: v.pending ? "pending" : v.call ? (v.call.connected ? "connected" : v.call.state) : "waiting",
        path: v.call?.path ?? null,
        video: v.call?.video ?? null,
        voice: v.call?.voiceStats ?? null,
      })),
    );
    // Single-figure stats follow the first live call (phone-as-mic only ever has one).
    const first = calls.find((c) => c.connected);
    this.handlers.onPath?.(first?.path ?? null);
    this.handlers.onVideo?.(first?.video ?? null);
    this.handlers.onAudio?.(first?.audio ?? null);
  }

  // Tracks states set from anywhere (e.g. "reconnecting"), so update() knows when its
  // summary is news.
  protected setState(state: PeerState): void {
    this.lastState = state;
    super.setState(state);
  }

  private label(peer: string): string {
    return this.viewers.get(peer)?.name || `viewer ${peer.slice(0, 6)}`;
  }

  // Admitted viewers are remembered per tab, so reloading the share page doesn't make
  // everyone ask again.
  private admittedKey(): string {
    return `argus.admitted.${this.code}`;
  }

  private isAdmitted(peer: string): boolean {
    return readList(this.admittedKey()).includes(peer);
  }

  private rememberAdmitted(peer: string): void {
    const list = readList(this.admittedKey());
    if (!list.includes(peer)) writeList(this.admittedKey(), [...list, peer].slice(-32));
  }
}

export class Receiver extends Session {
  private readonly receiverHandlers: ReceiverHandlers;
  private call: Call | null = null;
  private retries = 0;
  private retryTimer: number | undefined;
  private peer: string | null;
  private name: string;
  private wasReplaced = false;

  constructor(code: string, handlers: ReceiverHandlers, options: { name?: string } = {}) {
    super(code, "view", handlers);
    this.receiverHandlers = handlers;
    this.name = cleanName(options.name ?? "");
    this.peer = readPeer(code);
  }

  protected peerId(): string | null {
    return this.peer;
  }

  protected calls(): Call[] {
    return this.call ? [this.call] : [];
  }

  protected isConnected(): boolean {
    return this.call?.connected ?? false;
  }

  protected onSignalStatus(status: string): void {
    if (status === "replaced") this.wasReplaced = true;
  }

  retry(): void {
    // Our slot was taken by another tab holding the same id (a duplicated tab copies
    // sessionStorage). Come back with a fresh id so both can watch.
    if (this.wasReplaced) {
      this.wasReplaced = false;
      this.peer = null;
      forgetPeer(this.code);
    }
    super.retry();
  }

  /** Ask the sharer to let us watch (again). Also how a new name reaches the sharer. */
  knock(): void {
    this.send({ type: "knock", name: this.name || undefined, connected: this.isConnected() });
  }

  setName(name: string): void {
    this.name = cleanName(name);
    this.knock();
  }

  // The receiver can't re-offer, so it rejoins the room, which makes it knock again and
  // the sender offer again. A few automatic tries cover transient failures; after that
  // the page's Retry.
  private onFailed(): void {
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
        if (message.peer) {
          this.peer = message.peer;
          if (this.sig) this.sig.peer = message.peer;
          savePeer(this.code, message.peer);
        }
        this.log(`joined room ${this.code} as ${message.peer?.slice(0, 6) ?? "?"}${message.peerPresent ? ", sender is here" : ", no sender yet"}`);
        if (message.peerPresent) this.knock();
        break;
      case "peer-joined":
        if (message.role !== "share") break;
        this.log("sender joined; asking to watch");
        this.knock();
        break;
      case "lobby":
        this.log(message.needName ? "private room: the sharer needs your name" : "private room: waiting for the sharer to let you in");
        if (!this.isConnected()) this.setState(message.needName ? "need-name" : "lobby");
        break;
      case "admit":
        this.log("the sharer let you in");
        break;
      case "deny":
        this.log("the sharer declined");
        this.closeCall();
        this.setState("declined");
        break;
      case "offer":
        await this.answer(message.id, message.sdp, message.voiceMid);
        break;
      case "ice":
        if (this.call && this.call.id === message.id) await this.call.addIce(message.candidate);
        break;
      case "peer-left":
        if (message.role !== "share") break;
        if (this.isConnected()) {
          this.log("sender's room link dropped; call still up");
          break;
        }
        this.log("sender left");
        this.closeCall();
        this.setState("waiting");
        break;
      case "bye":
        this.log("sender left");
        this.closeCall();
        this.setState("waiting");
        break;
      case "error":
        this.log(`relay error: ${message.message}`);
        break;
    }
  }

  protected closeAll(): void {
    this.closeCall();
  }

  private closeCall(): void {
    if (!this.call) return;
    const hadVoice = !!this.call.voice;
    this.call.close();
    this.call = null;
    this.handlers.onPath?.(null);
    this.handlers.onVideo?.(null);
    this.handlers.onAudio?.(null);
    if (hadVoice) this.handlers.onVoiceTrack?.("sharer", null);
    this.receiverHandlers.onPeerGone?.();
  }

  private async answer(id: string, sdp: string, voiceMid: string | undefined): Promise<void> {
    this.closeCall();
    const log = (line: string) => this.log(line);
    const call = this.openCall(id, log, {}, {
      onState: (c) => {
        if (this.call !== c) return;
        this.setState(c.state);
        if (c.state === "connected") this.retries = 0;
        if (c.state === "failed") this.onFailed();
      },
      onStats: (c) => {
        if (this.call !== c) return;
        this.handlers.onPath?.(c.path);
        if (c.video) this.handlers.onVideo?.(c.video);
        if (c.audio) this.handlers.onAudio?.(c.audio);
      },
    });
    this.call = call;
    const { pc } = call;
    pc.ontrack = (event) => {
      // Voice is told apart by its media section id, announced in the offer; it plays
      // separately so it never goes through the screen-audio path (booster, mute).
      if (voiceMid && event.transceiver.mid === voiceMid) {
        log("receiving the sharer's voice channel");
        this.handlers.onVoiceTrack?.("sharer", event.track);
        return;
      }
      const [stream] = event.streams;
      if (!stream) return;
      log(`receiving ${event.track.kind} track`);
      this.receiverHandlers.onTrack?.(event.track, stream);
    };

    await pc.setRemoteDescription({ type: "offer", sdp });
    if (this.call !== call) return; // a newer offer arrived meanwhile
    if (voiceMid) {
      // Answer the voice section as sendrecv so our mic can go out on it later
      // (replaceTrack), without another offer/answer round.
      call.voice = pc.getTransceivers().find((t) => t.mid === voiceMid) ?? null;
      if (call.voice) {
        call.voice.direction = "sendrecv";
        this.applyMic(call);
      } else {
        log(`voice section ${voiceMid} not found in the offer`);
      }
    }
    preferH264(pc, log);
    await call.flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (this.call !== call) return;
    this.send({ type: "answer", id, sdp: answer.sdp! });
    this.setState("connecting");
    log("answer sent");
  }
}

// ---- per-tab storage (sessionStorage: each tab is its own viewer) ----

function readPeer(code: string): string | null {
  try {
    return sessionStorage.getItem(`argus.peer.${code}`);
  } catch {
    return null;
  }
}

function savePeer(code: string, peer: string): void {
  try {
    sessionStorage.setItem(`argus.peer.${code}`, peer);
  } catch {
    // Storage blocked; a reload will take a new slot instead of reclaiming this one.
  }
}

function forgetPeer(code: string): void {
  try {
    sessionStorage.removeItem(`argus.peer.${code}`);
  } catch {
    // Nothing stored to forget.
  }
}

function readList(key: string): string[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage blocked; admitted viewers just get asked again after a reload.
  }
}
