import { DATA_SAVER_GB_PER_HOUR, type Quality } from "../lib/bitrate";
import type { Tuning } from "../lib/capture";

const TUNING_NAME: Record<Tuning, string> = { text: "Text", motion: "Video" };

/** Sharing toolbar settings: Optimize for (Auto / Text / Video, screen only) and Quality. */
export function ShareSettings({
  showTuning,
  auto,
  tuning,
  onAuto,
  onTuning,
  quality,
  onQuality,
}: {
  showTuning: boolean;
  auto: boolean;
  tuning: Tuning;
  onAuto: () => void;
  onTuning: (t: Tuning) => void;
  quality: Quality;
  onQuality: (q: Quality) => void;
}) {
  return (
    <div className="settings-row">
      {showTuning && (
        <div className="segmented" role="group" aria-label="Optimize for">
          <span className="segmented-label">Optimize for</span>
          <button
            className={auto ? "active" : ""}
            onClick={onAuto}
            aria-pressed={auto}
            title="Sharp text, switching to smooth video while the connection is slow"
          >
            Auto{auto && <span className="auto-pick"> · {TUNING_NAME[tuning]}</span>}
          </button>
          <button
            className={!auto && tuning === "text" ? "active" : ""}
            onClick={() => onTuning("text")}
            aria-pressed={!auto && tuning === "text"}
            title="Sharp text, fps drops on slow links"
          >
            Text
          </button>
          <button
            className={!auto && tuning === "motion" ? "active" : ""}
            onClick={() => onTuning("motion")}
            aria-pressed={!auto && tuning === "motion"}
            title="Smooth motion, resolution drops on slow links"
          >
            Video
          </button>
        </div>
      )}
      <div className="segmented" role="group" aria-label="Quality">
        <span className="segmented-label">Quality</span>
        <button
          className={quality === "best" ? "active" : ""}
          onClick={() => onQuality("best")}
          aria-pressed={quality === "best"}
          title="As much as the connection carries (roughly 1–2 GB per hour)"
        >
          Best
        </button>
        <button
          className={quality === "saver" ? "active" : ""}
          onClick={() => onQuality("saver")}
          aria-pressed={quality === "saver"}
          title={`Caps video at about 1 Mbps: ≈${DATA_SAVER_GB_PER_HOUR} GB per hour. For mobile data or metered links.`}
        >
          Data saver
        </button>
      </div>
      {quality === "saver" && <span className="hint subtle">≈{DATA_SAVER_GB_PER_HOUR} GB/hour</span>}
    </div>
  );
}
