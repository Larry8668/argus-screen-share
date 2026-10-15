import { useState } from "react";

// Virtual cable setup for phone-as-mic: short steps up top, detail in toggles below.
// Used on /setup and inside /listen.

type Os = "windows" | "mac";

const VB_CABLE_URL = "https://vb-audio.com/Cable/";
const BLACKHOLE_URL = "https://existential.audio/blackhole/";

function detectOs(): Os {
  return /Mac/i.test(navigator.userAgent) ? "mac" : "windows";
}

export function CableSetup() {
  const [os, setOs] = useState<Os>(detectOs);
  const win = os === "windows";
  const speaker = win ? "CABLE Input" : "BlackHole 2ch";
  const mic = win ? "CABLE Output" : "BlackHole 2ch";

  return (
    <div className="guide">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={win} className={win ? "active" : ""} onClick={() => setOs("windows")}>
          Windows
        </button>
        <button role="tab" aria-selected={!win} className={!win ? "active" : ""} onClick={() => setOs("mac")}>
          macOS
        </button>
      </div>

      <ol className="steps">
        {win ? (
          <>
            <li>
              Download <a href={VB_CABLE_URL} target="_blank" rel="noreferrer">VB-Cable</a> and unzip it.
            </li>
            <li>
              Right-click <code>VBCABLE_Setup_x64.exe</code> → Run as administrator → Install Driver. Reboot.
            </li>
          </>
        ) : (
          <>
            <li>
              Run <code>brew install blackhole-2ch</code> (or get the{" "}
              <a href={BLACKHOLE_URL} target="_blank" rel="noreferrer">installer</a>).
            </li>
            <li>Restart the browser.</li>
          </>
        )}
        <li>
          Open <a href="/listen">/listen</a> → Start listening → Show all devices → pick <strong>{speaker}</strong>.
        </li>
        <li>
          On the phone, open <code>{location.host}/mic</code>, enter the code, tap Start mic.
        </li>
        <li>
          Set <strong>{mic}</strong> as your mic in {win ? "Windows Sound settings" : "System Settings → Sound"}, Discord or the
          game.
        </li>
      </ol>

      <details className="more">
        <summary>Why install anything?</summary>
        <p>
          A web page can play sound into a device but can't create one, and apps only see mics your computer knows about. The
          cable is a fake speaker wired to a fake mic: this page plays into one end, the game listens on the other.
        </p>
      </details>

      <details className="more">
        <summary>Not working?</summary>
        <ul>
          <li><strong>Bar moves but the game hears nothing:</strong> set the game's mic to {mic}, or restart the game.</li>
          <li><strong>{speaker} not listed:</strong> click Show all devices. Still missing? {win ? "Reboot." : "Restart the browser."}</li>
          <li><strong>All PC sound went quiet:</strong> your speakers stopped being the default output. Set them back in sound settings.</li>
          <li><strong>Echo:</strong> wear headphones on the computer.</li>
          <li><strong>Cuts out:</strong> keep /mic open on the phone with the screen on.</li>
        </ul>
      </details>

      <details className="more">
        <summary>Can I skip the install?</summary>
        <ul>
          <li><strong>Calls:</strong> join from the phone's app, and use <a href="/share">/share</a> for the screen.</li>
          <li><strong>Bluetooth earbuds with a mic:</strong> pair them with the computer and you have a mic.</li>
          <li><strong>In-game voice:</strong> no. Games only hear the computer's own mics.</li>
        </ul>
      </details>
    </div>
  );
}
