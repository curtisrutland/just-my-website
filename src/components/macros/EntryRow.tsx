"use client";

import { useState } from "react";
import type { Confidence, RollupEntry } from "./types";

const TAG: Record<Confidence, string> = { measured: "MEAS", estimated: "EST", logged_serving: "SRV" };
const fmt = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

type FormAction = (formData: FormData) => void | Promise<void>;

function tagStyle(estimated: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    letterSpacing: "0.06em",
    padding: "2px 5px",
    borderRadius: 3,
    flex: "none",
    border: `1px solid ${estimated ? "var(--color-accent)" : "var(--color-border)"}`,
    color: estimated ? "var(--color-accent)" : "var(--color-text-muted)",
  };
}

const num: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text)",
  textAlign: "right",
};

/**
 * One logged food (UI-CONTRACT §3). Confidence marker + name + quantity; macro contributions in
 * mono tabular; estimated rows get the dotted-accent kcal underline. The caret expands the note
 * and — when correction is enabled (gated app) — an inline edit form + soft-delete.
 */
export function EntryRow({
  entry,
  patchAction,
  deleteAction,
}: {
  entry: RollupEntry;
  patchAction?: FormAction;
  deleteAction?: FormAction;
}) {
  const [open, setOpen] = useState(false);
  const estimated = entry.confidence === "estimated";
  const hasNote = estimated && !!entry.note;
  const editable = !!patchAction || !!deleteAction;
  const expandable = hasNote || editable;

  return (
    <>
      <div className="entry-grid" style={{ display: "grid", alignItems: "center", padding: "11px 14px", borderTop: "1px solid var(--color-border)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={tagStyle(estimated)}>{TAG[entry.confidence]}</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 13.5, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.foodName ?? "ad-hoc"}
            </span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 3 }}>{fmt(entry.quantityGrams)} g</div>
        </div>
        <span style={{ ...num, ...(estimated ? { borderBottom: "1px dotted var(--color-accent)", paddingBottom: 1 } : {}) }}>{fmt(entry.calories)}</span>
        <span style={num}>{fmt(entry.proteinContent)}</span>
        <span style={num}>{fmt(entry.fatContent)}</span>
        <span style={num}>{fmt(entry.carbohydrateContent)}</span>
        <span style={{ textAlign: "right" }}>
          {expandable ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Collapse" : "Expand"}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-accent)", fontFamily: "var(--font-mono)", fontSize: 13, padding: 0, lineHeight: 1 }}
            >
              {open ? "⌄" : "›"}
            </button>
          ) : null}
        </span>
      </div>

      {open && expandable && (
        <div style={{ padding: "12px 14px 14px", borderTop: "1px solid var(--color-border)", borderLeft: "2px solid var(--color-accent)", background: "var(--band)", display: "flex", flexDirection: "column", gap: 12 }}>
          {hasNote && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-text-muted)" }}>
              ≈ Claude&apos;s estimate — &ldquo;{entry.note}&rdquo;
            </span>
          )}
          {patchAction && (
            <form action={patchAction} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <NumField name="quantityGrams" label="qty (g)" value={entry.quantityGrams} />
              <NumField name="calories" label="kcal" value={entry.calories} />
              <NumField name="proteinContent" label="P" value={entry.proteinContent} />
              <NumField name="fatContent" label="F" value={entry.fatContent} />
              <NumField name="carbohydrateContent" label="C" value={entry.carbohydrateContent} />
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={labelStyle}>confidence</span>
                <select name="confidence" defaultValue={entry.confidence} style={{ ...inputStyle, width: 130 }}>
                  <option value="measured">measured</option>
                  <option value="estimated">estimated</option>
                  <option value="logged_serving">logged_serving</option>
                </select>
              </label>
              <button type="submit" style={btn("var(--color-accent)")}>save</button>
            </form>
          )}
          {deleteAction && (
            <form action={deleteAction}>
              <button type="submit" style={btn("var(--color-over)")}>delete entry</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text)",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  padding: "5px 7px",
  width: 66,
};

function NumField({ name, label, value }: { name: string; label: string; value: number | null }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      <input type="number" step="any" min="0" name={name} defaultValue={value ?? ""} style={inputStyle} />
    </label>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.04em",
    color,
    background: "transparent",
    border: `1px solid ${color}`,
    borderRadius: "var(--radius)",
    padding: "6px 12px",
    cursor: "pointer",
  };
}
