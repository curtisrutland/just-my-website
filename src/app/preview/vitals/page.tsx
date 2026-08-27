import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { mockDays, mockRollup } from "@/components/vitals/mock";
import { SleepStages } from "@/components/vitals/SleepStages";
import { VitalsGaps } from "@/components/vitals/VitalsGaps";
import { VitalsTable } from "@/components/vitals/VitalsTable";
import { VitalsTrends } from "@/components/vitals/VitalsTrends";

export const dynamic = "force-dynamic";

const mono = "var(--font-mono)";
const heading: React.CSSProperties = {
  fontFamily: mono, fontSize: 11, fontWeight: 500, textTransform: "uppercase",
  letterSpacing: "0.12em", color: "var(--color-text-muted)", margin: 0,
};

/** Dev-only preview of the vitals module against mock data (read-only — the module has no writes). */
export default function PreviewVitals() {
  if (process.env.NODE_ENV === "production") notFound();

  // The newest day here has no sleep block on purpose; the stage bar must say so, not render empty.
  const latest = mockDays.find((d) => d.sleepTotalSeconds != null) ?? mockDays[0];

  return (
    <AppShell routeSegment="vitals" activeModule="vitals">
      <VitalsTrends rollup={mockRollup} window="14" basePath="/preview/vitals" />

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={heading}>last night · Garmin&apos;s stage classification</h2>
        <SleepStages day={latest} />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={heading}>measurements</h2>
        <VitalsTable days={mockDays} />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={heading}>gaps</h2>
        <VitalsGaps gaps={mockRollup.gaps} window={mockRollup.window} />
      </section>
    </AppShell>
  );
}
