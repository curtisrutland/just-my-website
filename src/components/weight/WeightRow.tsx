"use client";

import { useState } from "react";
import type { WeightEntry } from "@/lib/db/schema";
import { fmt1, monthDayPad, relLabel, WEIGHT_GRID } from "./format";

type FormAction = (formData: FormData) => void | Promise<void>;

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: WEIGHT_GRID,
  gap: 10,
  alignItems: "center",
  padding: "11px 14px",
  borderTop: "1px solid var(--color-border)",
};

function iconBtn(color: string, size = 13): React.CSSProperties {
  return { background: "none", border: "none", cursor: "pointer", color, fontFamily: "var(--font-mono)", fontSize: size, padding: 0, lineHeight: 1 };
}

/** One weigh-in. Inline-edit the raw number (✎ → input → ✓) or delete (×). */
export function WeightRow({
  entry,
  today,
  delta,
  patchAction,
  deleteAction,
}: {
  entry: WeightEntry;
  today: string;
  delta: string;
  patchAction?: FormAction;
  deleteAction?: FormAction;
}) {
  const [editing, setEditing] = useState(false);

  const dateCell = (
    <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontVariantNumeric: "tabular-nums", color: "var(--color-text)" }}>{monthDayPad(entry.measuredOn)}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.04em", color: "var(--color-text-muted)" }}>{relLabel(entry.measuredOn, today)}</span>
    </span>
  );
  const deltaCell = <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontVariantNumeric: "tabular-nums", textAlign: "right", color: "var(--color-text-muted)" }}>{delta}</span>;
  const noteCell = <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.note ?? ""}</span>;

  if (editing && patchAction) {
    return (
      <form action={patchAction} style={rowStyle} onSubmit={() => setEditing(false)}>
        {dateCell}
        <input
          name="weight"
          type="text"
          inputMode="decimal"
          defaultValue={fmt1(entry.weight)}
          autoFocus
          style={{ width: "100%", textAlign: "right", background: "var(--color-surface-raised)", border: "1px solid var(--color-accent)", borderRadius: 3, color: "var(--color-text)", fontFamily: "var(--font-mono)", fontSize: 13, fontVariantNumeric: "tabular-nums", padding: "3px 6px", caretColor: "var(--color-accent)" }}
        />
        {deltaCell}
        {noteCell}
        <span style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
          <button type="submit" style={iconBtn("var(--color-accent)")}>✓</button>
        </span>
      </form>
    );
  }

  return (
    <div style={rowStyle}>
      {dateCell}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, fontWeight: 500, fontVariantNumeric: "tabular-nums", textAlign: "right", color: "var(--color-text)" }}>{fmt1(entry.weight)}</span>
      {deltaCell}
      {noteCell}
      <span style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
        {patchAction && (
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit" style={iconBtn("var(--color-text-muted)")}>
            ✎
          </button>
        )}
        {deleteAction && (
          <form action={deleteAction}>
            <button type="submit" aria-label="Delete" style={iconBtn("var(--color-text-muted)", 15)}>
              ×
            </button>
          </form>
        )}
      </span>
    </div>
  );
}
