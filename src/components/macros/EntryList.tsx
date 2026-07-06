import { ENTRY_GRID, EntryRow } from "./EntryRow";
import type { RollupEntry } from "./types";

type EntryAction = (entryId: string, formData: FormData) => void | Promise<void>;

/**
 * The day's entries (UI-CONTRACT §3). No meal-slot grouping. Empty state is an invitation.
 * When correction actions are supplied (gated app), each row can be corrected/deleted; otherwise
 * the list is read-only (mock preview).
 */
export function EntryList({
  entries,
  patchAction,
  deleteAction,
}: {
  entries: RollupEntry[];
  patchAction?: EntryAction;
  deleteAction?: EntryAction;
}) {
  const headers = ["FOOD", "KCAL", "P", "F", "C", ""];
  return (
    <div style={{ marginTop: 24, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: ENTRY_GRID, gap: 8, padding: "9px 14px", background: "var(--color-surface)" }}>
        {headers.map((h, i) => (
          <span key={h || i} style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--color-text-muted)", textAlign: i === 0 ? "left" : "right" }}>
            {h}
          </span>
        ))}
      </div>
      {entries.length === 0 ? (
        <EmptyState />
      ) : (
        entries.map((e) => (
          <EntryRow
            key={e.id}
            entry={e}
            patchAction={patchAction ? patchAction.bind(null, e.id) : undefined}
            deleteAction={deleteAction ? deleteAction.bind(null, e.id) : undefined}
          />
        ))
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: "28px 16px", borderTop: "1px solid var(--color-border)", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--color-text)" }}>Nothing logged yet.</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 6 }}>
        Tell Claude what you ate — it estimates the macros.
      </div>
    </div>
  );
}
