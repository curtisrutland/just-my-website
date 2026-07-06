import type { WeightEntry } from "@/lib/db/schema";
import { WEIGHT_GRID } from "./format";
import { WeightRow } from "./WeightRow";

type EntryAction = (entryId: string, formData: FormData) => void | Promise<void>;

const deltaText = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d * 10) / 10).toFixed(1)}`;

/** Recent weigh-ins (newest first), each inline-correctable/deletable. `Δ DAY` = change vs the
 *  previous logged day (raw). */
export function WeightList({
  entries,
  today,
  loggedCount,
  gapCount,
  patchAction,
  deleteAction,
}: {
  entries: WeightEntry[];
  today: string;
  loggedCount: number;
  gapCount: number;
  patchAction?: EntryAction;
  deleteAction?: EntryAction;
}) {
  const cols = [
    { label: "DATE", align: "left" as const },
    { label: "WEIGHT", align: "right" as const },
    { label: "Δ DAY", align: "right" as const },
    { label: "NOTE", align: "left" as const },
    { label: "", align: "left" as const },
  ];

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "0 2px" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>RECENT WEIGH-INS</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)" }}>
          {loggedCount} logged · {gapCount} gaps
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: WEIGHT_GRID, gap: 10, padding: "6px 14px" }}>
        {cols.map((c, i) => (
          <span key={i} style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.08em", color: "var(--color-text-muted)", textAlign: c.align }}>
            {c.label}
          </span>
        ))}
      </div>

      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--color-surface)" }}>
        {entries.length === 0 ? (
          <div style={{ padding: "26px 16px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--color-text-muted)" }}>
            No weigh-ins yet.
          </div>
        ) : (
          entries.map((e, i) => {
            const older = entries[i + 1];
            const delta = older ? deltaText(e.weight - older.weight) : "—";
            return (
              <WeightRow
                key={e.id}
                entry={e}
                today={today}
                delta={delta}
                patchAction={patchAction ? patchAction.bind(null, e.id) : undefined}
                deleteAction={deleteAction ? deleteAction.bind(null, e.id) : undefined}
              />
            );
          })
        )}
      </div>

      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 9, paddingLeft: 2 }}>
        Correct a raw number inline or delete a bad reading — the rolling average absorbs it. Gaps are fine; the line carries through.
      </div>
    </section>
  );
}
