// Capture source selection. Screen capture (getDisplayMedia) is a desktop-browser
// feature: phone browsers don't expose it to web pages at all, so the page must
// detect it rather than assume it. Camera capture (getUserMedia) works everywhere.

export type Source = "screen" | "camera";

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
    return navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 } },
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
