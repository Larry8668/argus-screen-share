import { useState, type FormEvent } from "react";
import { MAX_VIEWERS, type PeerState } from "../lib/session";
import { Icon } from "./Icon";
import "./rooms.css";

/**
 * Player overlay for getting into a room: name needed (private room), waiting to be let
 * in, declined (ask again), or room full (try again).
 */
export function AdmissionOverlay({
  state,
  name,
  onName,
  onAskAgain,
  onRetry,
}: {
  state: PeerState;
  name: string;
  onName: (name: string) => void;
  onAskAgain: () => void;
  onRetry: () => void;
}) {
  if (state === "need-name") {
    return (
      <div className="overlay">
        <div className="overlay-title">This room is private</div>
        <p>Tell the sharer who you are. They'll get a prompt to let you in.</p>
        <NameForm initial={name} action="Ask to watch" onSubmit={onName} />
      </div>
    );
  }
  if (state === "lobby") {
    return (
      <div className="overlay">
        <span className="spinner" aria-hidden />
        <div className="overlay-title">Waiting for the sharer to let you in</div>
        <p>They've been asked{name ? ` to let “${name}” watch` : ""}.</p>
      </div>
    );
  }
  if (state === "declined") {
    return (
      <div className="overlay">
        <div className="overlay-title">The sharer declined</div>
        <p>You can ask once more, for example after a quick message to them.</p>
        <button className="btn btn-primary" onClick={onAskAgain}>
          <Icon name="refresh" size={16} /> Ask again
        </button>
      </div>
    );
  }
  if (state === "full") {
    return (
      <div className="overlay">
        <div className="overlay-title">Room full</div>
        <p>{MAX_VIEWERS} people are already watching, the most one sharer can send to. Try again when someone leaves.</p>
        <button className="btn btn-primary" onClick={onRetry}>
          <Icon name="refresh" size={16} /> Try again
        </button>
      </div>
    );
  }
  return null;
}

export function NameForm({ initial, action, onSubmit }: { initial: string; action: string; onSubmit: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  }
  return (
    <form className="name-form" onSubmit={submit}>
      <input
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Your name"
        maxLength={40}
        aria-label="Your name"
        autoFocus
      />
      <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
        {action}
      </button>
    </form>
  );
}

/** "Watching as Alex · Change" in the watch bar; the name shows in the sharer's list. */
export function NameChip({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <NameForm
        initial={name}
        action="Save"
        onSubmit={(n) => {
          setEditing(false);
          onChange(n);
        }}
      />
    );
  }
  return (
    <button className="btn btn-ghost small name-chip" onClick={() => setEditing(true)} title="The name the sharer sees">
      {name ? `Watching as ${name}` : "Add your name"}
    </button>
  );
}
