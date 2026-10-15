// Phone-as-mic helpers: capture a voice-tuned mic stream, measure its loudness, and route
// playback to a chosen output device. Routing to a virtual cable's input (VB-Audio's
// "CABLE Input" on Windows, BlackHole on macOS) is what makes the phone's voice appear
// as a real microphone to games and call apps on the desktop: a web page cannot create
// an audio device itself, but it can play into one that a driver created.

export function canCaptureMic(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

export function captureMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      // Voice-call processing done on the phone, where the mic is.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
    video: false,
  });
}

/** Calls onLevel every animation frame with loudness in 0..1. Returns a stop function. */
export function watchLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  if (!stream.getAudioTracks().length) return () => {};
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  void ctx.resume().catch(() => {});

  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    const rms = Math.sqrt(sum / samples.length);
    onLevel(Math.min(1, rms * 5)); // speech RMS sits around 0.02–0.2; stretch it to fill the bar
    frame = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelAnimationFrame(frame);
    source.disconnect();
    void ctx.close();
  };
}

// ---- output devices (desktop side) ----

type SinkElement = HTMLMediaElement & { setSinkId(id: string): Promise<void> };

export function canChooseOutput(): boolean {
  return "setSinkId" in HTMLMediaElement.prototype;
}

export async function listOutputs(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audiooutput" && d.deviceId !== "");
}

/** True when the browser is hiding device names (Chrome does until mic permission is granted). */
export function namesHidden(outputs: MediaDeviceInfo[]): boolean {
  return outputs.length === 0 || outputs.every((d) => !d.label);
}

/**
 * Chrome only lists output devices by name once the page has microphone permission.
 * Ask for it, then release the mic immediately; nothing is recorded. On a desktop whose
 * own mic is broken this still works once a virtual cable is installed, because the
 * cable also adds a recording device.
 */
export async function unlockDeviceNames(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

export async function setOutput(element: HTMLMediaElement, deviceId: string): Promise<void> {
  await (element as SinkElement).setSinkId(deviceId);
}

export function isVirtualCable(device: MediaDeviceInfo): boolean {
  return /cable input|vb-audio|blackhole/i.test(device.label);
}
