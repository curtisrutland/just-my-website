import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/AppShell";
import { todayISO } from "@/lib/date";
import { trendDisplay, WINDOW_DAYS, type WindowKey } from "@/components/weight/format";
import { WeightEntryForm } from "@/components/weight/WeightEntryForm";
import { WeightList } from "@/components/weight/WeightList";
import { WeightStats } from "@/components/weight/WeightStats";
import { WeightTrend } from "@/components/weight/WeightTrend";
import { getEntryByDay, getRollup, listEntries } from "@/lib/weight/repo";
import { deleteWeightAction, patchWeightAction, setWeightAction } from "./actions";

export const dynamic = "force-dynamic";

const WINDOW_KEYS: WindowKey[] = ["30", "90", "365", "all"];

/** The Clerk-gated weight module — live trend, stat tiles, entry form, and the weigh-in list. */
export default async function WeightPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const window: WindowKey = WINDOW_KEYS.includes(w as WindowKey) ? (w as WindowKey) : "90";
  const today = todayISO();

  const [rollup, list, todayEntry] = await Promise.all([
    getRollup({ window: WINDOW_DAYS[window] }),
    listEntries({ limit: 12 }),
    getEntryByDay(today),
  ]);

  const trend = trendDisplay(rollup.summary.trendPerWeek);
  const loggedCount = rollup.series.filter((p) => p.weight != null).length;
  const gapCount = rollup.series.length - loggedCount;

  return (
    <AppShell
      routeSegment="weight"
      activeModule="weight"
      navFooter={<UserButton />}
      headerRight={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.1em" }}>TREND</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: trend.color, fontVariantNumeric: "tabular-nums" }}>
            {trend.arrow} {trend.text}
          </span>
        </div>
      }
    >
      <WeightEntryForm todayWeight={todayEntry?.weight ?? null} todayNote={todayEntry?.note ?? null} action={setWeightAction.bind(null, today)} />
      <WeightTrend rollup={rollup} window={window} basePath="/weight" />
      <WeightStats summary={rollup.summary} window={window} />
      <WeightList
        entries={list.items}
        today={today}
        loggedCount={loggedCount}
        gapCount={gapCount}
        patchAction={patchWeightAction}
        deleteAction={deleteWeightAction}
      />
    </AppShell>
  );
}
