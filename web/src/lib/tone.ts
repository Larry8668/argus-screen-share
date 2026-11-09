import type { PeerState } from "./session";

/** Colour family for a connection state: status pill, dots. */
export type Tone = "idle" | "wait" | "ok" | "bad";

export function toneOf(state: PeerState | "idle"): Tone {
  switch (state) {
    case "connected":
      return "ok";
    case "failed":
    case "replaced":
      return "bad";
    case "idle":
      return "idle";
    default:
      return "wait";
  }
}
