import Link from "next/link";
import { addDays, dayOfMonth, monthDay, weekday2, weekdayFull, year } from "@/lib/date";
import type { Kind, WeekDay } from "@/lib/macros/types";

const kindDot = (kind: Kind) =>
  kind === "training" ? "var(--color-warning)" : kind === "rest" ? "var(--color-success)" : "var(--color-accent)";

/**
 * Day-navigation row. Prev/next + the big display date + weekday, and a week strip of day-chips
 * with kind dots. Navigation is link-based: each control routes to `{basePath}/{date}`.
 */
export function DayNav({
  week,
  selected,
  isToday,
  today,
  basePath,
  canNext,
}: {
  week: WeekDay[];
  selected: string;
  isToday?: boolean;
  today: string;
  basePath: string;
  canNext: boolean;
}) {
  return (
    <div className="day-nav" style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <NavButton glyph="‹" href={`${basePath}/${addDays(selected, -1)}`} />
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {monthDay(selected)}{" "}
            <span style={{ color: "var(--color-text-muted)", fontSize: 16, fontWeight: 500 }}>{year(selected)}</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)", marginTop: 4 }}>
            {weekdayFull(selected)}
            {isToday ? " · TODAY" : ""}
          </div>
        </div>
        <NavButton glyph="›" href={canNext ? `${basePath}/${addDays(selected, 1)}` : null} />
        {selected !== today && (
          <Link
            href={`${basePath}/${today}`}
            style={{
              height: 34,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 12px",
              marginLeft: 2,
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              color: "var(--color-accent)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.04em",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            today
          </Link>
        )}
      </div>

      <div className="week-strip" style={{ display: "flex", gap: 6 }}>
        {week.map((d) => (
          <DayChip key={d.date} day={d} selected={d.date === selected} basePath={basePath} />
        ))}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  color: "var(--color-text-muted)",
  fontFamily: "var(--font-mono)",
  fontSize: 15,
  textDecoration: "none",
};

function NavButton({ glyph, href }: { glyph: string; href: string | null }) {
  if (!href) {
    return (
      <button type="button" disabled style={{ ...navBtn, opacity: 0.35, cursor: "default" }}>
        {glyph}
      </button>
    );
  }
  return (
    <Link href={href} style={navBtn}>
      {glyph}
    </Link>
  );
}

function DayChip({ day, selected, basePath }: { day: WeekDay; selected: boolean; basePath: string }) {
  return (
    <Link
      href={`${basePath}/${day.date}`}
      style={{
        width: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        padding: "7px 0 8px",
        borderRadius: "var(--radius)",
        border: `1px solid ${selected ? "var(--color-accent)" : "transparent"}`,
        background: selected ? "var(--band)" : "transparent",
        textDecoration: "none",
      }}
    >
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, letterSpacing: "0.1em", color: "var(--color-text-muted)" }}>
        {weekday2(day.date)}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          color: selected ? "var(--color-text)" : "var(--color-text-muted)",
        }}
      >
        {dayOfMonth(day.date)}
      </span>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: kindDot(day.kind) }} />
    </Link>
  );
}
