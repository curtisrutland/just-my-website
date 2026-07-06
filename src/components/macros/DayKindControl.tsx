import type { Kind } from "./types";

const OPTS: Kind[] = ["training", "rest", "unspecified"];

const wrap: React.CSSProperties = {
  display: "flex",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  overflow: "hidden",
  flex: "none",
};

function seg(active: boolean, leftBorder: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    letterSpacing: "0.04em",
    padding: "5px 10px",
    background: active ? "var(--color-surface-raised)" : "transparent",
    color: active ? "var(--color-text)" : "var(--color-text-muted)",
    borderLeft: leftBorder ? "1px solid var(--color-border)" : "none",
  };
}

/**
 * The day-kind control in the terminal header. When an `action` is supplied it persists the choice
 * (training/rest set the tag; unspecified clears it) via a server action; otherwise it renders
 * static (used by the mock preview).
 */
export function DayKindControl({
  kind,
  action,
}: {
  kind: Kind;
  action?: (formData: FormData) => void | Promise<void>;
}) {
  if (!action) {
    return (
      <div style={wrap}>
        {OPTS.map((o, i) => (
          <span key={o} style={seg(o === kind, i > 0)}>
            {o}
          </span>
        ))}
      </div>
    );
  }
  return (
    <form action={action} style={wrap}>
      {OPTS.map((o, i) => (
        <button
          key={o}
          type="submit"
          name="kind"
          value={o}
          style={{ ...seg(o === kind, i > 0), border: "none", borderLeft: i ? "1px solid var(--color-border)" : "none", cursor: "pointer" }}
        >
          {o}
        </button>
      ))}
    </form>
  );
}
