import { hm } from "./format";
import type { VitalsDayView } from "@/lib/vitals/types";

const STAGES = [
  { key: "sleepDeepSeconds", label: "deep", color: "var(--color-accent)", opacity: 1 },
  { key: "sleepRemSeconds", label: "rem", color: "var(--color-accent)", opacity: 0.66 },
  { key: "sleepLightSeconds", label: "light", color: "var(--color-accent)", opacity: 0.38 },
  { key: "sleepAwakeSeconds", label: "awake", color: "var(--color-text-muted)", opacity: 0.5 },
] as const;

/**
 * The night as four proportional segments.
 *
 * Labelled as **Garmin's classification**, not as fact — the stages are a classifier over movement
 * and heart rate, not something the watch measured, and the module's whole argument is that the
 * difference matters (docs/vitals-model.md § "The one kept exception"). Garmin's *grading* of the
 * night — sleep score, restlessness — is not stored at all.
 *
 * The bar shows what Garmin reported, un-rebalanced: if the stages do not sum to the recorded total,
 * the remainder simply goes unfilled rather than being scaled away.
 */
export function SleepStages({ day }: { day: VitalsDayView }) {
  const parts = STAGES.map((s) => ({ ...s, seconds: day[s.key] ?? 0 }));
  const staged = parts.reduce((a, p) => a + p.seconds, 0);
  const total = Math.max(day.sleepTotalSeconds ?? 0, staged);

  if (!total) {
    return (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-muted)" }}>
        no sleep recorded
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", height: 8, borderRadius: 2, overflow: "hidden", background: "var(--color-border)" }}>
        {parts.map((p) =>
          p.seconds ? (
            <div
              key={p.label}
              title={`${p.label} — ${hm(p.seconds)} (Garmin's classification)`}
              style={{ width: `${(p.seconds / total) * 100}%`, background: p.color, opacity: p.opacity }}
            />
          ) : null
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)" }}>
        {parts.map((p) => (
          <span key={p.label}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 1, background: p.color, opacity: p.opacity, marginRight: 5 }} />
            {p.label} {hm(p.seconds || null)}
          </span>
        ))}
      </div>
    </div>
  );
}
