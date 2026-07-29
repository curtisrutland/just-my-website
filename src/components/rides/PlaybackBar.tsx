"use client";

import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "./playback";
import { hms } from "./format";

const mono = "var(--font-mono)";

/**
 * The playback transport — the strip that ties the charts and the map together: play/pause,
 * ride-time speed multiples (60× = one ride-minute per second), the scrubber, and the elapsed
 * readout. Chart hover previews a moment; THIS owns the playhead. Calm mono, no chrome.
 */
export function PlaybackBar({
  duration,
  playheadT,
  displayT,
  playing,
  speed,
  onTogglePlay,
  onSpeedChange,
  onScrub,
}: {
  duration: number;
  playheadT: number | null;
  /** What's currently shown (hover preview wins over the playhead) — drives the readout. */
  displayT: number | null;
  playing: boolean;
  speed: PlaybackSpeed;
  onTogglePlay: () => void;
  onSpeedChange: (s: PlaybackSpeed) => void;
  onScrub: (t: number) => void;
}) {
  return (
    <section
      className="ride-transport"
      style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "9px 14px" }}
    >
      <button
        onClick={onTogglePlay}
        aria-label={playing ? "pause" : "play"}
        style={{ flex: "none", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: playing ? "var(--band)" : "none", border: `1px solid ${playing ? "var(--color-accent)" : "var(--color-border)"}`, borderRadius: "var(--radius)", color: playing ? "var(--color-accent)" : "var(--color-text)", fontFamily: mono, fontSize: 12, lineHeight: 1, cursor: "pointer" }}
      >
        {playing ? "⏸" : "▶"}
      </button>

      <span style={{ display: "flex", gap: 4, flex: "none" }}>
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.04em", padding: "3px 7px", borderRadius: 3, cursor: "pointer", fontVariantNumeric: "tabular-nums", background: speed === s ? "var(--band)" : "none", border: `1px solid ${speed === s ? "var(--color-accent)" : "var(--color-border)"}`, color: speed === s ? "var(--color-accent)" : "var(--color-text-muted)" }}
          >
            {s}×
          </button>
        ))}
      </span>

      <input
        className="ride-scrub"
        type="range"
        min={0}
        max={Math.ceil(duration)}
        step={1}
        value={Math.round(playheadT ?? 0)}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="scrub ride playback"
        style={{ flex: 1, minWidth: 80 }}
      />

      <span style={{ flex: "none", fontFamily: mono, fontSize: 11, color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
        {hms(displayT ?? 0)}
        <span style={{ color: "var(--color-text-muted)" }}> / {hms(duration)}</span>
      </span>
    </section>
  );
}
