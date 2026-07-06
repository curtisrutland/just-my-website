import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { trendDisplay } from "@/components/weight/format";
import { mockToday, mockWeightEntries, mockWeightRollup } from "@/components/weight/mock";
import { WeightEntryForm } from "@/components/weight/WeightEntryForm";
import { WeightList } from "@/components/weight/WeightList";
import { WeightStats } from "@/components/weight/WeightStats";
import { WeightTrend } from "@/components/weight/WeightTrend";

export const dynamic = "force-dynamic";

/** Dev-only preview of the full weight module against mock data (read-only — no server actions). */
export default function PreviewWeight() {
  if (process.env.NODE_ENV === "production") notFound();
  const rollup = mockWeightRollup;
  const trend = trendDisplay(rollup.summary.trendPerWeek);
  const logged = rollup.series.filter((p) => p.weight != null).length;

  return (
    <AppShell
      routeSegment="weight"
      activeModule="weight"
      headerRight={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.1em" }}>TREND</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: trend.color, fontVariantNumeric: "tabular-nums" }}>
            {trend.arrow} {trend.text}
          </span>
        </div>
      }
    >
      <WeightEntryForm todayWeight={177.6} todayNote="morning, fasted" />
      <WeightTrend rollup={rollup} window="90" basePath="/preview/weight" />
      <WeightStats summary={rollup.summary} window="90" />
      <WeightList entries={mockWeightEntries} today={mockToday} loggedCount={logged} gapCount={rollup.series.length - logged} />
    </AppShell>
  );
}
