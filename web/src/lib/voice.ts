// Talk-over voice: playing the other side's voice, and knowing whether the screen
// capture will re-capture it (echo).

import type { Logger } from "./peer";

/**
 * restrictOwnAudio (Chrome 141+) tells getDisplayMedia to leave out sound this page
 * itself plays, so viewers' voices coming out of the sharer's speakers aren't sent back
 * to them inside the screen audio. Without it, the sharer needs headphones.
 */
export function restrictOwnAudioSupported(): boolean {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, boolean> | undefined;
  return supported?.restrictOwnAudio === true;
}

/**
 * One <audio> element per remote voice, kept out of the page. Browsers only start sound
 * after a user gesture, so nothing plays until unlock() runs from a click; after that,
 * voices that arrive later (a new viewer, a reconnect) start by themselves.
 */
export class VoiceOutput {
  private readonly players = new Map<string, HTMLAudioElement>();
  private unlocked = false;
  private on = true;
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  attach(key: string, track: MediaStreamTrack): void {
    this.detach(key);
    const el = new Audio();
    el.srcObject = new MediaStream([track]);
    el.muted = !this.on;
    this.players.set(key, el);
    if (this.unlocked) this.play(key, el);
  }

  detach(key: string): void {
    const el = this.players.get(key);
    if (!el) return;
    el.pause();
    el.srcObject = null;
    this.players.delete(key);
  }

  /** Call from a click/tap handler. */
  unlock(): void {
    this.unlocked = true;
    for (const [key, el] of this.players) if (el.paused) this.play(key, el);
  }

  setOn(on: boolean): void {
    this.on = on;
    for (const el of this.players.values()) el.muted = !on;
  }

  close(): void {
    for (const key of [...this.players.keys()]) this.detach(key);
  }

  private play(key: string, el: HTMLAudioElement): void {
    el.play().catch((err: Error) => this.log(`voice ${key}: playback refused (${err.name}); tap a voice button to allow sound`));
  }
}
