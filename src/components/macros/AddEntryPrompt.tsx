/** The add-entry prompt (UI-CONTRACT §3). Non-wired in this pass — real submit (Claude estimates →
 *  new Entry) lands with server actions in Phase 3. */
export function AddEntryPrompt() {
  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          padding: "12px 14px",
          background: "var(--color-surface)",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--color-accent)", flex: "none" }}>log ›</span>
        <input
          placeholder="a couple handfuls of almonds, a big chicken thigh…"
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: "var(--color-text)",
            caretColor: "var(--color-accent)",
          }}
        />
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 8, paddingLeft: 2 }}>
        Describe it plainly. Claude estimates the macros — you can correct any number.
      </div>
    </div>
  );
}
