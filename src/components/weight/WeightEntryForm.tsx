import { fmt1 } from "./format";

type FormAction = (formData: FormData) => void | Promise<void>;

/** Today's-weight entry (web write path). A single number by hand — Claude doesn't estimate weight. */
export function WeightEntryForm({
  todayWeight,
  todayNote,
  action,
}: {
  todayWeight: number | null;
  todayNote: string | null;
  action?: FormAction;
}) {
  const logged = todayWeight != null;
  const hint = logged
    ? `Today is already logged at ${fmt1(todayWeight)} lb — edit and update, or leave it. One number, by hand; Claude doesn’t estimate weight.`
    : "Log today’s weight — one number, by hand; Claude doesn’t estimate weight.";

  return (
    <section style={{ marginBottom: 22 }}>
      <form
        action={action}
        style={{ display: "flex", alignItems: "center", gap: 14, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "12px 16px", flexWrap: "wrap" }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--color-accent)" }}>weigh ›</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <input
            name="weight"
            type="text"
            inputMode="decimal"
            defaultValue={todayWeight ?? ""}
            placeholder="000.0"
            style={{ width: 88, background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", color: "var(--color-text)", fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, fontVariantNumeric: "tabular-nums", padding: "6px 10px", caretColor: "var(--color-accent)" }}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-text-muted)" }}>lb</span>
        </div>
        <input
          name="note"
          type="text"
          defaultValue={todayNote ?? ""}
          placeholder="note (optional) — e.g. morning, fasted"
          style={{ flex: 1, minWidth: 180, background: "none", border: "none", borderBottom: "1px solid var(--color-border)", color: "var(--color-text)", fontFamily: "var(--font-mono)", fontSize: 12.5, padding: "6px 2px", caretColor: "var(--color-accent)" }}
        />
        <button
          type="submit"
          disabled={!action}
          style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.04em", padding: "8px 16px", borderRadius: "var(--radius)", cursor: action ? "pointer" : "default", border: "1px solid var(--color-accent)", background: "var(--color-accent)", color: "var(--color-bg)", fontWeight: 600 }}
        >
          {logged ? "update" : "log"}
        </button>
      </form>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 9, paddingLeft: 2 }}>{hint}</div>
    </section>
  );
}
