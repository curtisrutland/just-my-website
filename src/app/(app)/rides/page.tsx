import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/AppShell";
import { mdShort, weekLine, weekStartOf } from "@/components/rides/format";
import { localStartTime } from "@/components/rides/localTime";
import { RideCard } from "@/components/rides/RideCard";
import { UploadPanel } from "@/components/rides/UploadPanel";
import { todayISO } from "@/lib/date";
import { listRides } from "@/lib/rides/repo";
import type { RideView } from "@/lib/rides/types";
import { uploadFitAction } from "./actions";

export const dynamic = "force-dynamic";

const mono = "var(--font-mono)";

type Search = { sport?: string; deleted?: string };

/**
 * The ride log (Rides.dc.html §RIDE LOG): weekly strip → header + upload → sport chips →
 * week-grouped ride cards. The log is the value — no hero, no scores; a calm chronological
 * record. Grouping and the weekly line use `localDate` (never the UTC date).
 */
export default async function RideLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  // One read of the (small) history; filtering + weekly aggregates derived in-page.
  const { items, count } = await listRides({ limit: 200, offset: 0 });
  const cycling = items.filter((r) => r.sport === "cycling");

  // Sport chips: rides (default) · any other sports present · all.
  const otherSports = Array.from(new Set(items.filter((r) => r.sport !== "cycling").map((r) => r.sport)));
  const filter = sp.sport && (sp.sport === "all" || otherSports.includes(sp.sport)) ? sp.sport : "rides";
  const shown = filter === "all" ? items : filter === "rides" ? cycling : items.filter((r) => r.sport === filter);

  // Weekly aggregates (cycling only, per the brief), keyed by Monday of the ISO week.
  const weeks = new Map<string, { rides: number; dist: number; asc: number; mov: number }>();
  for (const r of cycling) {
    const w = weekStartOf(r.localDate);
    const agg = weeks.get(w) ?? { rides: 0, dist: 0, asc: 0, mov: 0 };
    agg.rides += 1;
    agg.dist += r.distanceMeters ?? 0;
    agg.asc += r.totalAscentMeters ?? 0;
    agg.mov += r.movingSeconds;
    weeks.set(w, agg);
  }
  const thisWeek = weeks.get(weekStartOf(todayISO()));

  // Group the shown rides by week, preserving newest-first order.
  const groups: { w: string; rides: RideView[] }[] = [];
  for (const r of shown) {
    const w = weekStartOf(r.localDate);
    const last = groups[groups.length - 1];
    if (last && last.w === w) last.rides.push(r);
    else groups.push({ w, rides: [r] });
  }

  const chip = (key: string, label: string) => (
    <Link
      key={key}
      href={key === "rides" ? "/rides" : `/rides?sport=${encodeURIComponent(key)}`}
      style={{
        fontFamily: mono,
        fontSize: 11,
        letterSpacing: "0.02em",
        padding: "5px 11px",
        borderRadius: "calc(var(--radius) * 3)",
        textDecoration: "none",
        whiteSpace: "nowrap",
        border: `1px solid ${filter === key ? "var(--color-accent)" : "var(--color-border)"}`,
        background: filter === key ? "var(--band)" : "none",
        color: filter === key ? "var(--color-accent)" : "var(--color-text-muted)",
      }}
    >
      {label}
    </Link>
  );

  return (
    <AppShell
      routeSegment="rides"
      activeModule="rides"
      navFooter={<UserButton />}
      headerRight={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.1em" }}>LAST RIDE</span>
          <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
            {items.length ? mdShort(items[0].localDate) : "—"}
          </span>
        </div>
      }
    >
      {/* weekly strip — one quiet mono line, not a hero */}
      <section style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", paddingBottom: 16, borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>THIS WEEK</span>
        <span style={{ fontFamily: mono, fontSize: 13.5, color: "var(--color-text)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>
          {thisWeek ? weekLine(thisWeek) : "no rides this week"}
        </span>
      </section>

      <UploadPanel
        title="ride log"
        subline={`${count} ride${count === 1 ? "" : "s"} recorded · files arrive from the watch`}
        upload={uploadFitAction}
      />

      <section className="ride-chips" style={{ alignItems: "center", gap: 8, paddingBottom: 16 }}>
        {chip("rides", "rides")}
        {otherSports.map((s) => chip(s, s))}
        {chip("all", "all")}
      </section>

      {sp.deleted && (
        <div style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", padding: "0 0 14px" }}>
          deleted · {sp.deleted} — re-upload the .fit file to restore
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ border: "1px dashed var(--color-border)", borderRadius: "var(--radius)", padding: "38px 20px", textAlign: "center", fontFamily: mono, fontSize: 12, color: "var(--color-text-muted)" }}>
          no rides yet — drop a .fit file
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.w} style={{ marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, paddingBottom: 9, borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
              <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>
                WEEK OF {mdShort(g.w).toUpperCase()}
              </span>
              <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                {weeks.has(g.w) ? weekLine(weeks.get(g.w)!) : `${g.rides.length} ride${g.rides.length === 1 ? "" : "s"}`}
              </span>
            </div>
            {g.rides.map((r) => (
              <RideCard key={r.id} r={r} localStart={localStartTime(r.startedAt)} />
            ))}
          </section>
        ))
      )}
    </AppShell>
  );
}
