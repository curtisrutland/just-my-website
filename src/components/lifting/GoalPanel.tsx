"use client";

import { useState, useTransition } from "react";
import { monthDay, year } from "@/lib/date";
import type { GoalView } from "@/lib/lifting/types";

const mono = "var(--font-mono)";

type Props = {
  goal: GoalView | null;
  /** Optional so the /preview harness can render read-only (matches the module convention). */
  save?: (statement: string) => Promise<void>;
};

/**
 * The goal statement, atop the journal. Module-level, not per-session: it's the frame every session
 * below is read against, which is why it's ambient here rather than tucked behind its own route. The
 * prose is the point — no targets, no progress bar, no percentage. Editing rewords today's goal;
 * stating a new one on a later day supersedes it and keeps the old one in history.
 */
export function GoalPanel({ goal, save }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(goal?.statement ?? "");
  const [pending, start] = useTransition();

  const commit = () => {
    if (!save || pending) return;
    if (!value.trim() || value === goal?.statement) {
      setEditing(false);
      setValue(goal?.statement ?? "");
      return;
    }
    start(async () => {
      await save(value);
      setEditing(false);
    });
  };

  const since = goal ? `since ${monthDay(goal.effectiveFrom)}, ${year(goal.effectiveFrom)}` : null;

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderLeft: "2px solid var(--color-accent)",
        borderRadius: "calc(var(--radius) * 1.5)",
        background: "var(--color-surface)",
        padding: "16px 20px",
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>
          THE GOAL <span style={{ opacity: 0.55 }}>· YOURS</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {since && !editing && (
            <span style={{ fontFamily: mono, fontSize: 9.5, color: "var(--color-text-muted)", letterSpacing: "0.04em" }}>{since}</span>
          )}
          {save && (
            <button
              onClick={() => (editing ? commit() : setEditing(true))}
              disabled={pending}
              style={{
                fontFamily: mono,
                fontSize: 9.5,
                letterSpacing: "0.06em",
                padding: "3px 9px",
                borderRadius: 3,
                cursor: pending ? "default" : "pointer",
                border: "1px solid " + (editing ? "var(--color-accent)" : "var(--color-border)"),
                background: editing ? "var(--band)" : "transparent",
                color: editing ? "var(--color-accent)" : "var(--color-text-muted)",
              }}
            >
              {pending ? "saving…" : editing ? "save" : goal ? "edit" : "set a goal"}
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <>
          <textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="what is the training for right now?"
            rows={4}
            style={{
              width: "100%",
              resize: "vertical",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              color: "var(--color-text)",
              fontFamily: "var(--font-body)",
              fontSize: 15,
              lineHeight: 1.65,
              padding: "12px 13px",
              caretColor: "var(--color-accent)",
            }}
          />
          <div style={{ fontFamily: mono, fontSize: 9.5, color: "var(--color-text-muted)", marginTop: 9, lineHeight: 1.5 }}>
            Saving supersedes today&apos;s goal. Earlier goals are kept — an old read stays judged against the goal that
            applied when it was written.
          </div>
        </>
      ) : goal ? (
        <p style={{ fontFamily: "var(--font-body)", fontSize: 15.5, lineHeight: 1.68, color: "var(--color-text)", margin: 0, textWrap: "pretty" }}>
          {goal.statement}
        </p>
      ) : (
        <p style={{ fontFamily: "var(--font-body)", fontSize: 14.5, lineHeight: 1.6, color: "var(--color-text-muted)", margin: 0, fontStyle: "italic" }}>
          no goal set — the reads below have nothing to aim at yet.
        </p>
      )}
    </div>
  );
}
