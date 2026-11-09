import { useState } from "react";
import { Icon } from "./Icon";

/** Copies text and flips to "Copied" for a moment, so the click visibly worked. */
export function CopyButton({ text, label, onResult }: { text: string; label: string; onResult?: (ok: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      onResult?.(true);
    } catch {
      onResult?.(false);
    }
  }
  return (
    <button className={`btn btn-ghost ${copied ? "is-done" : ""}`} onClick={() => void copy()}>
      <Icon name={copied ? "check" : "copy"} size={16} />
      {copied ? "Copied" : label}
    </button>
  );
}
