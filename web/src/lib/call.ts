// One RTCPeerConnection and everything tied to it: the offer id that names it in
// signaling, ICE queuing, the candidate-pair diagnostics and the stats poll. The
// Receiver holds one Call; the Sender holds one per viewer.

import {
  createPeer,
  describeAudio,
  describeCandidate,
  describePairs,
  describeSelectedPair,
  describeVideo,
  type Logger,
  type VideoCounters,
} from "./peer";
import type { SignalMessage } from "./signaling";

export type CallState = "connecting" | "connected" | "failed";

export interface CallOptions {
  /** Offer id; see SignalMessage. */
  id: string;
  iceServers: RTCIceServer[];
  log: Logger;
  /** Sends a signaling message about this call, already addressed to the right peer. */
  send: (message: SignalMessage) => void;
  onState: (call: Call) => void;
  /** New stats in path/video/audio/voice. */
  onStats: (call: Call) => void;
  /** One line for the relay's logs every few polls. */
  report: (text: string) => void;
}

const STATS_INTERVAL_MS = 2000;
const STATS_REPORT_EVERY = 3; // polls; i.e. one relay log line per 6s

export class Call {
  readonly pc: RTCPeerConnection;
  readonly id: string;
  state: CallState = "connecting";
  /** Candidate pair carrying media, e.g. "srflx ↔ host". */
  path: string | null = null;
  video: string | null = null;
  /** Screen audio (or the phone mic) flow. */
  audio: string | null = null;
  /** Talk-over voice flow, when the call has a voice section. */
  voiceStats: string | null = null;
  /** The sendrecv audio section used for talk-over voice; null when the call has none. */
  voice: RTCRtpTransceiver | null = null;
  /** Sharer side: the screen video and screen-sound sections, kept so the source can be swapped live. */
  media: { video: RTCRtpTransceiver | null; audio: RTCRtpTransceiver | null } = { video: null, audio: null };

  private readonly opts: CallOptions;
  private timer: number | undefined;
  private closed = false;
  // Last view of the candidate pairs while ICE was still trying; Chrome can drop them
  // from getStats once the connection has failed.
  private lastPairs: string[] = [];
  // ICE can arrive while the remote description is still being applied; hold it until then.
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(opts: CallOptions) {
    this.opts = opts;
    this.id = opts.id;
    const pc = createPeer(opts.log, opts.iceServers);
    this.pc = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate) opts.send({ type: "ice", id: this.id, candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      opts.log(`connection: ${pc.connectionState}`);
      if (pc.connectionState === "connecting") {
        this.watchPairs();
      } else if (pc.connectionState === "connected") {
        this.setState("connected");
        this.pollStats();
      } else if (pc.connectionState === "failed") {
        this.setState("failed");
        void this.logPairs();
      }
    };
  }

  get connected(): boolean {
    return !this.closed && this.pc.connectionState === "connected";
  }

  async addIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    if (candidate.candidate) this.opts.log(`remote candidate: ${describeCandidate(candidate.candidate)}`);
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      this.opts.log(`bad ice candidate: ${(err as Error).message}`);
    }
  }

  /** Call right after setRemoteDescription. */
  async flushIce(): Promise<void> {
    for (const candidate of this.pendingIce.splice(0)) await this.addIce(candidate);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.timer);
    this.pc.close();
  }

  private setState(state: CallState): void {
    this.state = state;
    this.opts.onState(this);
  }

  private watchPairs(): void {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(async () => {
      if (this.pc.connectionState !== "connecting") return;
      const pairs = await describePairs(this.pc);
      if (pairs.length) this.lastPairs = pairs;
    }, 1000);
  }

  private async logPairs(): Promise<void> {
    window.clearInterval(this.timer);
    const now = await describePairs(this.pc);
    const pairs = now.length ? now : this.lastPairs;
    const log = this.opts.log;
    if (!pairs.length) return log("no candidate pairs were formed (no usable remote candidates)");
    log(`candidate pairs tried (${pairs.length}):`);
    for (const line of pairs.slice(0, 12)) log(`  ${line}`);
  }

  private pollStats(): void {
    window.clearInterval(this.timer);
    const counters: { current?: VideoCounters } = {};
    let polls = 0;
    this.timer = window.setInterval(async () => {
      if (this.pc.connectionState !== "connected") return;
      const voiceMid = this.voice?.mid ?? undefined;
      this.path = await describeSelectedPair(this.pc);
      this.video = await describeVideo(this.pc, counters);
      this.audio = await describeAudio(this.pc, (mid) => mid === undefined || mid !== voiceMid);
      this.voiceStats = voiceMid ? await describeAudio(this.pc, (mid) => mid === voiceMid) : null;
      if (this.closed) return;
      this.opts.onStats(this);
      if (++polls % STATS_REPORT_EVERY === 0) {
        const { path, video, audio, voiceStats } = this;
        this.opts.report(
          [path, video && `video ${video}`, audio && `audio ${audio}`, voiceStats && `voice ${voiceStats}`].filter(Boolean).join(" | "),
        );
      }
    }, STATS_INTERVAL_MS);
  }
}
