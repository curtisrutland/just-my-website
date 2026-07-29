import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { mdShort, weekLine, weekStartOf } from "@/components/rides/format";
import { mockDetail, mockRides } from "@/components/rides/mock";
import { RideCard } from "@/components/rides/RideCard";
import { RideDetail } from "@/components/rides/RideDetail";

export const dynamic = "force-dynamic";

const mono = "var(--font-mono)";

/** Dev-only preview of the rides module against mock data (read-only — actions are absent). */
export default function PreviewRides() {
  if (process.env.NODE_ENV === "production") notFound();

  const cycling = mockRides.filter((r) => r.sport === "cycling");
  const week = {
    rides: cycling.length,
    dist: cycling.reduce((a, r) => a + (r.distanceMeters ?? 0), 0),
    asc: cycling.reduce((a, r) => a + (r.totalAscentMeters ?? 0), 0),
    mov: cycling.reduce((a, r) => a + r.movingSeconds, 0),
  };

  return (
    <AppShell routeSegment="rides" activeModule="rides">
      {/* log */}
      <section style={{ display: "flex", alignItems: "baseline", gap: 16, paddingBottom: 16, borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>THIS WEEK</span>
        <span style={{ fontFamily: mono, fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>{weekLine(week)}</span>
      </section>
      <div style={{ padding: "18px 0 14px" }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600 }}>ride log</h1>
        <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 5 }}>
          {mockRides.length} rides recorded · files arrive from the watch
        </div>
      </div>
      <section style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: 9, borderBottom: "1px solid var(--color-border)" }}>
          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>
            WEEK OF {mdShort(weekStartOf(mockRides[0].localDate)).toUpperCase()}
          </span>
        </div>
        {mockRides.map((r) => (
          <RideCard key={r.id} r={r} localStart="7:46 PM" />
        ))}
      </section>

      {/* detail */}
      <div style={{ margin: "40px 0 18px", borderTop: "2px solid var(--color-border)", paddingTop: 24, fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>
        DETAIL PREVIEW — THE REAL FIRST RIDE
      </div>
      <RideDetail ride={mockDetail} localStart="7:46 PM" />
    </AppShell>
  );
}
