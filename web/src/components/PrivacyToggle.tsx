import "./rooms.css";

/** "Private room" switch for the sharer: when on, each viewer needs an Allow first. */
export function PrivacyToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>Private room</strong>
        <span className="hint subtle">
          {on ? " Viewers give a name and wait for you to let them in." : " Anyone with the code can watch."}
        </span>
      </span>
    </label>
  );
}
