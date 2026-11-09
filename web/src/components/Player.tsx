import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import type { PeerState } from "../lib/session";
import { Icon } from "./Icon";

interface PlayerProps {
  state: PeerState;
  hasVideo: boolean;
  hasAudio: boolean;
  muted: boolean;
  volume: number; // percent, 0–300
  onToggleMute: () => void;
  onVolume: (percent: number) => void;
  onRetry: () => void;
  /** Stats shown in the in-player overlay (the "chart" button). */
  stats: { label: string; value: string | null }[];
  log: (line: string) => void;
  /** Replaces the built-in waiting/failed overlay while there's no picture (e.g. admission screens). */
  overlay?: ReactNode;
  /** Talk-over mic toggle; the button shows only when this is given. */
  micOn?: boolean;
  onToggleMic?: () => void;
}

const HIDE_AFTER_MS = 2800;
const VOLUME_STEP = 10;

/**
 * Viewer video player: overlay states (waiting / reconnecting / failed + Retry), a
 * "tap to unmute" prompt, and auto-hiding controls (mute, 0–300% volume, stats,
 * picture-in-picture, fullscreen). Fullscreen targets the wrapper so the controls stay
 * usable. Keyboard and TV remotes: M mute, F fullscreen, ↑/↓ volume, Enter on buttons.
 */
export const Player = forwardRef<HTMLVideoElement, PlayerProps>(function Player(props, videoRef) {
  const { state, hasVideo, hasAudio, muted, volume, onToggleMute, onVolume, onRetry, stats, log, overlay, micOn, onToggleMic } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [idle, setIdle] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const video = () => (typeof videoRef === "function" ? null : videoRef?.current ?? null);

  function wake() {
    setIdle(false);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setIdle(true), HIDE_AFTER_MS);
  }

  useEffect(() => {
    const onFs = () => setIsFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.clearTimeout(hideTimer.current);
    };
  }, []);

  function toggleFullscreen() {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else wrap.requestFullscreen?.().catch((err: Error) => log(`fullscreen refused: ${err.message}`));
  }

  async function togglePip() {
    const v = video();
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch (err) {
      log(`picture-in-picture refused: ${(err as Error).message}`);
    }
  }

  // Shortcuts work anywhere on the page unless the user is typing.
  const latest = useRef({ hasAudio, hasVideo, volume, onToggleMute, onVolume, toggleFullscreen });
  useEffect(() => {
    latest.current = { hasAudio, hasVideo, volume, onToggleMute, onVolume, toggleFullscreen };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || e.metaKey || e.ctrlKey) return;
      const l = latest.current;
      const key = e.key.toLowerCase();
      if (key === "m" && l.hasAudio) l.onToggleMute();
      else if (key === "f" && l.hasVideo) l.toggleFullscreen();
      else if (e.key === "ArrowUp" && l.hasAudio && t.getAttribute("type") !== "range") {
        e.preventDefault();
        l.onVolume(Math.min(300, l.volume + VOLUME_STEP));
      } else if (e.key === "ArrowDown" && l.hasAudio && t.getAttribute("type") !== "range") {
        e.preventDefault();
        l.onVolume(Math.max(0, l.volume - VOLUME_STEP));
      } else return;
      wake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pipSupported = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;
  const shownStats = stats.filter((s) => s.value);

  return (
    <div
      ref={wrapRef}
      className={`player ${hasVideo ? "has-video" : ""} ${idle && hasVideo ? "is-idle" : ""} ${isFull ? "is-full" : ""}`}
      onMouseMove={wake}
      onTouchStart={wake}
      onFocus={wake}
      onDoubleClick={() => hasVideo && toggleFullscreen()}
    >
      <video ref={videoRef} autoPlay muted playsInline />

      {!hasVideo && (overlay ?? <StateOverlay state={state} onRetry={onRetry} />)}

      {hasVideo && hasAudio && muted && (
        <button className="unmute-prompt" onClick={onToggleMute}>
          <Icon name="volumeOff" size={20} />
          Tap to unmute
        </button>
      )}

      {hasVideo && state !== "connected" && (
        <div className="badge badge-wait">
          <span className="spinner small" aria-hidden /> {state === "failed" ? "Connection lost" : "Reconnecting…"}
        </div>
      )}

      {showStats && shownStats.length > 0 && (
        <dl className="stats-overlay">
          {shownStats.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {hasVideo && (
        <div className="controls">
          <div className="controls-left">
            <span className="live">
              <span className="dot" aria-hidden /> LIVE
            </span>
            <IconButton
              label={!hasAudio ? "No audio from the sharer" : muted ? "Unmute (M)" : "Mute (M)"}
              onClick={onToggleMute}
              disabled={!hasAudio}
            >
              <Icon name={!hasAudio || muted ? "volumeOff" : "volume"} />
            </IconButton>
            {hasAudio && (
              <label className={`volume ${volume > 100 ? "boost" : ""}`}>
                <input
                  type="range"
                  min={0}
                  max={300}
                  step={VOLUME_STEP}
                  value={volume}
                  onChange={(e) => onVolume(Number(e.target.value))}
                  onDoubleClick={() => onVolume(100)}
                  aria-label="Volume"
                  style={{ ["--fill" as string]: `${(volume / 300) * 100}%` }}
                />
                <span className="volume-value" title="Double-click the slider to reset to 100%">
                  {volume}%
                </span>
              </label>
            )}
            {onToggleMic && (
              <IconButton label={micOn ? "Mic on: tap to stop talking" : "Talk to the sharer (mic)"} onClick={onToggleMic} active={micOn}>
                <Icon name={micOn ? "mic" : "micOff"} />
              </IconButton>
            )}
          </div>
          <div className="controls-right">
            <IconButton label="Stats" onClick={() => setShowStats((v) => !v)} active={showStats}>
              <Icon name="chart" />
            </IconButton>
            {pipSupported && (
              <IconButton label="Picture in picture" onClick={() => void togglePip()}>
                <Icon name="pip" />
              </IconButton>
            )}
            <IconButton label={isFull ? "Exit fullscreen (F)" : "Fullscreen (F)"} onClick={toggleFullscreen}>
              <Icon name={isFull ? "shrink" : "expand"} />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
});

function StateOverlay({ state, onRetry }: { state: PeerState; onRetry: () => void }) {
  if (state === "failed") {
    return (
      <div className="overlay">
        <div className="overlay-title">Couldn't connect</div>
        <p>The two devices couldn't reach each other. Retrying usually fixes a blip.</p>
        <button className="btn btn-primary" onClick={onRetry} autoFocus>
          <Icon name="refresh" size={16} /> Retry
        </button>
      </div>
    );
  }
  if (state === "replaced") {
    return (
      <div className="overlay">
        <div className="overlay-title">Opened somewhere else</div>
        <p>A copy of this tab took over its place in the room.</p>
        <button className="btn btn-primary" onClick={onRetry}>
          <Icon name="refresh" size={16} /> Watch here too
        </button>
      </div>
    );
  }
  const text: Record<string, [string, string]> = {
    waiting: ["Waiting for the sharer", "The picture appears as soon as they start sharing."],
    connecting: ["Connecting…", "Finding the best route between the two devices."],
    reconnecting: ["Reconnecting…", "Lost the link for a moment. Hang on."],
    connected: ["Connected", "Waiting for the first frame…"],
  };
  const [title, body] = text[state] ?? text.waiting;
  return (
    <div className="overlay">
      <span className="spinner" aria-hidden />
      <div className="overlay-title">{title}</div>
      <p>{body}</p>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className={`icon-btn ${active ? "active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
