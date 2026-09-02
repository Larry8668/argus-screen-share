// RTCPeerConnection helpers shared by the share and view pages.

export type Logger = (line: string) => void;

// Not in the DOM lib typings; only the field we read.
type CandidateStats = { candidateType?: string };

// STUN only for now. TURN (relay) is Phase 4 and conditional — see docs/agent/PLAN.md.
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

export function createPeer(log: Logger): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.oniceconnectionstatechange = () => log(`ice: ${pc.iceConnectionState}`);
  pc.onicegatheringstatechange = () => log(`ice gathering: ${pc.iceGatheringState}`);
  pc.onsignalingstatechange = () => log(`signaling: ${pc.signalingState}`);

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
  return `${local?.candidateType ?? "?"} ↔ ${remote?.candidateType ?? "?"}`;
}
