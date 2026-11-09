import { useState } from "react";
import { isValidCode, normalizeCode } from "../lib/code";
import { Icon } from "./Icon";

/** Six-character room code field with inline validation. */
export function CodeEntry({
  initial = "",
  action,
  onSubmit,
  autoFocus = true,
}: {
  initial?: string;
  action: string;
  onSubmit: (code: string) => void;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const code = normalizeCode(value);
  const invalid = touched && !isValidCode(code);
  return (
    <form
      className="code-entry"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (isValidCode(code)) onSubmit(code);
      }}
    >
      <input
        className={`input code-input ${invalid ? "invalid" : ""}`}
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        placeholder="ROOM CODE"
        maxLength={6}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-label="Room code"
        aria-invalid={invalid}
      />
      <button className="btn btn-primary btn-lg" type="submit" disabled={code.length !== 6}>
        {action}
        <Icon name="arrow" size={18} />
      </button>
      {invalid && <p className="field-error">Codes are 6 letters or digits.</p>}
    </form>
  );
}
