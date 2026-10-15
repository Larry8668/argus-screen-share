// Capture source selection. Screen capture (getDisplayMedia) is a desktop-browser
// feature: phone browsers don't expose it to web pages at all, so the page must
// detect it rather than assume it. Camera capture (getUserMedia) works everywhere.

export type Source = "screen" | "camera";

/** Text = sharp, full 1080p, fps may drop. Motion = smooth, 720p, sharpness may drop. */
export type Tuning = "text" | "motion";

/**
 * Tunes a live screen-share video track. Fewer pixels at 720p means each frame gets more
 * bits, which matters on a slow or relayed path; the hint tells the encoder what to protect.
 */
export async function tuneTrack(track: MediaStreamTrack, tuning: Tuning): Promise<RTCDegradationPreference> {
  track.contentHint = tuning === "text" ? "detail" : "motion";
  const size = tuning === "text" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  await track.applyConstraints({
    width: { max: size.width },
    height: { max: size.height },
    frameRate: { ideal: 30, max: 30 },
  });
  return tuning === "text" ? "maintain-resolution" : "maintain-framerate";
}

export function canCapture(source: Source): boolean {
  const md = navigator.mediaDevices;
  if (!md) return false; // insecure context or very old browser
  return source === "screen"
    ? typeof md.getDisplayMedia === "function"
    : typeof md.getUserMedia === "function";
}

export async function captureStream(source: Source): Promise<MediaStream> {
  if (source === "screen") {
    // audio: true asks the browser to offer system/tab audio in its picker.
    // What's actually offered depends on platform: Chrome/Edge on Windows can
    // include system audio for "Entire screen"; tab shares get tab audio on all
    // desktop OSes; window shares usually have no audio; Firefox/Safari offer none.
    // systemAudio is a Chrome-only hint; other browsers ignore unknown keys.
    // Capped at 1080p: a Retina screen is ~3000px wide, which costs bandwidth (worse
    // over a TURN relay) and swamps weak decoders like a Fire TV Stick, for no visible
    // gain on a TV. The browser downscales; aspect ratio is kept.
    return navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 30, max: 30 } },
      audio: true,
      systemAudio: "include",
    } as DisplayMediaStreamOptions);
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" }, // rear camera on phones
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
}

/** Human explanation for why a source isn't available, for the idle screen. */
export function unavailableReason(source: Source): string {
  if (!navigator.mediaDevices) {
    return "This page isn't in a secure context, so the browser hides all media APIs.";
  }
  return source === "screen"
    ? "This browser can't capture its own screen. Phone browsers don't offer screen capture to websites; use a desktop browser to share a screen, or share the camera instead."
    : "This browser has no camera access.";
}
