// RTCPeerConnection helpers shared by the share and view pages.

export type Logger = (line: string) => void;

// Not in the DOM lib typings; only the fields we read.
type CandidateStats = { candidateType?: string; protocol?: string; address?: string };

// Fallback when /api/ice is unreachable. The Worker owns the real list (STUN, plus TURN
// when its secrets are set) so TURN credentials stay out of the bundle and the repo.
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

export async function loadIceServers(log: Logger): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/ice", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { iceServers } = (await res.json()) as { iceServers: RTCIceServer[] };
    const turn = iceServers.some((s) => [s.urls].flat().some((u) => u.startsWith("turn")));
    log(`ice servers: STUN${turn ? " + TURN relay" : " only (no relay configured)"}`);
    return iceServers;
  } catch (err) {
    log(`couldn't load ice servers (${(err as Error).message}); using STUN only`);
    return FALLBACK_ICE_SERVERS;
  }
}

export function createPeer(log: Logger, iceServers: RTCIceServer[]): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers });

  pc.oniceconnectionstatechange = () => log(`ice: ${pc.iceConnectionState}`);
  pc.onicegatheringstatechange = () => log(`ice gathering: ${pc.iceGatheringState}`);
  pc.onsignalingstatechange = () => log(`signaling: ${pc.signalingState}`);
  // addEventListener, not on*, so the session's own onicecandidate handler stays free.
  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate?.candidate) log(`local candidate: ${describeCandidate(event.candidate.candidate)}`);
  });
  pc.addEventListener("icecandidateerror", (event) => {
    const e = event as RTCPeerConnectionIceErrorEvent;
    log(`ice server error: ${e.url} ${e.errorCode} ${e.errorText}`);
  });

  return pc;
}

/**
 * Describe the candidate pair that actually carries the media, e.g. "srflx ↔ host".
 * Candidate types: host = LAN address, srflx = public address learned via STUN,
 * relay = going through a TURN server. Returns null until a pair is nominated.
 */
export async function describeSelectedPair(pc: RTCPeerConnection): Promise<string | null> {
  const stats = await pc.getStats();
  let selected: RTCIceCandidatePairStats | undefined;

  stats.forEach((report) => {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      selected = stats.get(report.selectedCandidatePairId) as RTCIceCandidatePairStats | undefined;
    }
  });
  if (!selected) {
    stats.forEach((report) => {
      if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
        selected = report as RTCIceCandidatePairStats;
      }
    });
  }
  if (!selected) return null;

  const local = stats.get(selected.localCandidateId) as CandidateStats | undefined;
  const remote = stats.get(selected.remoteCandidateId) as CandidateStats | undefined;
  const rtt = selected.currentRoundTripTime ? ` · rtt ${Math.round(selected.currentRoundTripTime * 1000)}ms` : "";
  // The sender's congestion controller's estimate of how much the path can carry.
  const bwe = selected.availableOutgoingBitrate ? ` · bwe ${formatBitrate(selected.availableOutgoingBitrate)}` : "";
  return `${local?.candidateType ?? "?"} ↔ ${remote?.candidateType ?? "?"}${rtt}${bwe}`;
}

function formatBitrate(bps: number): string {
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)}Mbps` : `${Math.round(bps / 1000)}kbps`;
}

// Fields read from inbound-rtp / outbound-rtp video stats; several aren't in the DOM typings.
type RtpVideoStats = {
  type: string;
  kind?: string;
  timestamp: number;
  codecId?: string;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  bytesSent?: number;
  bytesReceived?: number;
  decoderImplementation?: string;
  powerEfficientDecoder?: boolean;
  encoderImplementation?: string;
  powerEfficientEncoder?: boolean;
  qualityLimitationReason?: string;
  jitterBufferDelay?: number;
  jitterBufferEmittedCount?: number;
  framesDropped?: number;
  packetsLost?: number;
  freezeCount?: number;
};

/** Previous counters, so rates cover the last poll interval rather than the whole call. */
export type VideoCounters = { t: number; bytes: number; bufferDelay: number; bufferCount: number };

/**
 * One-line video health summary, e.g.
 * "1920×1080 · 30fps · H264 · 2.4Mbps · decoder MediaCodec (hw) · buffer 40ms".
 * Low bitrate = grainy picture. A buffer that keeps growing = delay building up.
 * "limited by bandwidth" (sender) = the network path can't carry more.
 */
export async function describeVideo(pc: RTCPeerConnection, prev: { current?: VideoCounters }): Promise<string | null> {
  const stats = await pc.getStats();
  let summary: string | null = null;
  stats.forEach((report) => {
    const r = report as RtpVideoStats;
    if (r.kind !== "video" || (r.type !== "inbound-rtp" && r.type !== "outbound-rtp")) return;
    const codec = (stats.get(r.codecId ?? "") as { mimeType?: string } | undefined)?.mimeType?.replace("video/", "");
    const now: VideoCounters = {
      t: r.timestamp,
      bytes: r.bytesSent ?? r.bytesReceived ?? 0,
      bufferDelay: r.jitterBufferDelay ?? 0,
      bufferCount: r.jitterBufferEmittedCount ?? 0,
    };
    const last = prev.current;
    prev.current = now;
    const seconds = last ? (now.t - last.t) / 1000 : 0;

    const parts = [
      r.frameWidth ? `${r.frameWidth}×${r.frameHeight}` : null,
      `${Math.round(r.framesPerSecond ?? 0)}fps`,
      codec ?? null,
      last && seconds > 0 ? formatBitrate(((now.bytes - last.bytes) * 8) / seconds) : null,
    ];
    if (r.type === "inbound-rtp") {
      if (r.decoderImplementation) parts.push(`decoder ${r.decoderImplementation}${r.powerEfficientDecoder ? " (hw)" : ""}`);
      const frames = now.bufferCount - (last?.bufferCount ?? 0);
      if (frames > 0) parts.push(`buffer ${Math.round(((now.bufferDelay - (last?.bufferDelay ?? 0)) / frames) * 1000)}ms`);
      if (r.packetsLost) parts.push(`lost ${r.packetsLost}`);
      if (r.freezeCount) parts.push(`freezes ${r.freezeCount}`);
      if (r.framesDropped) parts.push(`dropped ${r.framesDropped}`);
    } else {
      if (r.encoderImplementation) parts.push(`encoder ${r.encoderImplementation}${r.powerEfficientEncoder ? " (hw)" : ""}`);
      if (r.qualityLimitationReason && r.qualityLimitationReason !== "none") parts.push(`limited by ${r.qualityLimitationReason}`);
    }
    summary = parts.filter(Boolean).join(" · ");
  });
  return summary;
}

/**
 * Ask for H.264 first on the receiving side. TVs and phones decode H.264 in hardware;
 * VP8 (Chrome's default) is software-decoded on most of them, and a weak TV CPU falls
 * behind on a big screen share, which shows up as ever-growing delay. The answerer's
 * codec order decides what the sender encodes, so this runs before createAnswer.
 */
export function preferH264(pc: RTCPeerConnection, log: Logger): void {
  const caps = typeof RTCRtpReceiver.getCapabilities === "function" ? RTCRtpReceiver.getCapabilities("video") : null;
  if (!caps) return;
  const h264 = caps.codecs.filter((c) => c.mimeType.toLowerCase() === "video/h264");
  if (!h264.length) return log("codec: no H.264 decoder here, keeping the default");
  const ordered = [...h264, ...caps.codecs.filter((c) => c.mimeType.toLowerCase() !== "video/h264")];
  for (const t of pc.getTransceivers()) {
    if (t.receiver.track.kind !== "video") continue;
    try {
      t.setCodecPreferences(ordered);
      log("codec: asked for H.264 (hardware decode on TVs/phones)");
    } catch (err) {
      log(`codec: couldn't set preferences: ${(err as Error).message}`);
    }
  }
}

/**
 * Where a candidate address lives, without revealing the address itself.
 * mdns = a random "xxxx.local" name Chrome uses to hide LAN IPs; the other device has
 * to resolve it on the local network, which some browsers (often TVs) can't.
 * cgnat = the ISP shares one public IP between many customers (100.64.0.0/10).
 */
export function addressKind(address: string): string {
  if (address.endsWith(".local")) return "mdns";
  if (address.includes(":")) return "ipv6";
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(address)) return "lan-ipv4";
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) return "cgnat-ipv4";
  return "public-ipv4";
}

/** "host udp mdns" from an SDP candidate line: type, transport, address kind. */
export function describeCandidate(candidate: string): string {
  // candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...
  const parts = candidate.replace(/^a=/, "").split(" ");
  const typeIndex = parts.indexOf("typ");
  if (parts.length < 8 || typeIndex < 0) return "unparsed";
  return `${parts[typeIndex + 1]} ${parts[2].toLowerCase()} ${addressKind(parts[4])}`;
}

/** Every candidate pair ICE tried and how it ended, for the log after a failure. */
export async function describePairs(pc: RTCPeerConnection): Promise<string[]> {
  const stats = await pc.getStats();
  const side = (id: string) => {
    const c = stats.get(id) as CandidateStats | undefined;
    return c ? `${c.candidateType} ${c.protocol} ${c.address ? addressKind(c.address) : "?"}` : "?";
  };
  const lines = new Set<string>();
  stats.forEach((report) => {
    if (report.type !== "candidate-pair") return;
    const pair = report as RTCIceCandidatePairStats;
    lines.add(`${side(pair.localCandidateId)} → ${side(pair.remoteCandidateId)}: ${pair.state}`);
  });
  return [...lines];
}

/**
 * Audio flow summary. Sender: packets sent. Receiver: packets received and the current
 * level (0 = silence), which tells "nothing arriving" apart from "arriving but silent".
 */
export async function describeAudio(pc: RTCPeerConnection): Promise<string | null> {
  const stats = await pc.getStats();
  let summary: string | null = null;
  stats.forEach((report) => {
    const r = report as { type: string; kind?: string; packetsSent?: number; packetsReceived?: number; audioLevel?: number };
    if (r.kind !== "audio") return;
    if (r.type === "outbound-rtp") summary = `sending · ${r.packetsSent ?? 0} packets`;
    if (r.type === "inbound-rtp") {
      summary = `receiving · ${r.packetsReceived ?? 0} packets · level ${(r.audioLevel ?? 0).toFixed(2)}`;
    }
  });
  return summary;
}
