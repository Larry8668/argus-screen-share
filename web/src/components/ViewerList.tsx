import { stateText, MAX_VIEWERS, type PeerState, type ViewerInfo } from "../lib/session";
import { toneOf } from "../lib/tone";
import { Icon } from "./Icon";
import "./rooms.css";

/**
 * Sharer's view of the room: "N watching" with names, plus Allow/Deny for viewers
 * knocking on a private room. Names are viewer-supplied text and only ever rendered as
 * text.
 */
export function ViewerList({
  state,
  viewers,
  onAdmit,
  onDeny,
  onRetry,
}: {
  state: PeerState | "idle";
  viewers: ViewerInfo[];
  onAdmit: (peer: string) => void;
  onDeny: (peer: string) => void;
  onRetry: () => void;
}) {
  const watching = viewers.filter((v) => v.status === "connected");
  const joining = viewers.filter((v) => v.status === "connecting");
  const pending = viewers.filter((v) => v.status === "pending");
  const summary =
    watching.length > 0
      ? `${watching.length} watching`
      : joining.length > 0
        ? "Viewer connecting…"
        : state === "waiting" || state === "connected" || state === "connecting"
          ? "No one watching yet"
          : stateText(state as PeerState, "a viewer");
  const tone = watching.length > 0 ? "ok" : toneOf(state);

  return (
    <div className="viewer-list">
      <div className={`viewer-state tone-${tone}`}>
        <span className="dot" aria-hidden />
        <span>{summary}</span>
        {watching.length >= MAX_VIEWERS && <span className="muted small-text">(room full)</span>}
        {state === "failed" && (
          <button className="btn btn-ghost small" onClick={onRetry}>
            <Icon name="refresh" size={14} /> Retry
          </button>
        )}
      </div>
      {(watching.length > 0 || joining.length > 0) && (
        <ul className="viewer-names">
          {[...watching, ...joining].map((v) => (
            <li key={v.peer}>
              <Icon name="eye" size={14} /> {v.name || "Unnamed viewer"}
              {v.status === "connecting" && <span className="muted"> · connecting</span>}
            </li>
          ))}
        </ul>
      )}
      {pending.map((v) => (
        <div key={v.peer} className="knock" role="alert">
          <span>
            <strong>{v.name}</strong> wants to watch
          </span>
          <div className="btn-row">
            <button className="btn btn-primary small" onClick={() => onAdmit(v.peer)}>
              Allow
            </button>
            <button className="btn btn-ghost small" onClick={() => onDeny(v.peer)}>
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
