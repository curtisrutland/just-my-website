import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/shell/AppShell";
import { WINDOW_DAYS, type WindowKey } from "@/components/vitals/format";
import { SleepStages } from "@/components/vitals/SleepStages";
import { VitalsGaps } from "@/components/vitals/VitalsGaps";
import { VitalsTable } from "@/components/vitals/VitalsTable";
import { VitalsTrends } from "@/components/vitals/VitalsTrends";
import { getRollup, listDays } from "@/lib/vitals/repo";

export const dynamic = "force-dynamic";

const WINDOW_KEYS: WindowKey[] = ["14", "30", "90", "all"];
const mono = "var(--font-mono)";

/**
 * The Clerk-gated vitals module — READ-ONLY by design.
 *
 * There is no entry form and no inline edit: these numbers come off a wrist, and a hand-typed HRV
 * would be a fiction. The only writer is the Garmin daemon (docs/garmin-daemon.md); corrections
 * happen by reprocessing the stored payload, not by editing here.
 *
 * No hero. A dated table of measurements, three quiet trends, and an honest list of the days that
 * have nothing — because the module's argument is that the watch's verdicts are worth less than
 * what it actually measured.
 */
export default async function VitalsPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const window: WindowKey = WINDOW_KEYS.includes(w as WindowKey) ? (w as WindowKey) : "30";
  const days = WINDOW_DAYS[window];

  const [rollup, list] = await Promise.all([getRollup({ window: days }), listDays({ limit: days })]);
  const latest = list.items[0] ?? null;

  return (
    <AppShell
      routeSegment="vitals"
      activeModule="vitals"
      navFooter={<UserButton />}
      headerRight={
        <span style={{ fontFamily: mono, fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.1em" }}>
          {list.count} DAYS
        </span>
      }
    >
      <VitalsTrends rollup={rollup} window={window} basePath="/vitals" />

      {latest && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontFamily: mono, fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--color-text-muted)", margin: 0 }}>
            last night · Garmin&apos;s stage classification
          </h2>
          <SleepStages day={latest} />
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontFamily: mono, fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--color-text-muted)", margin: 0 }}>
          measurements
        </h2>
        <VitalsTable days={list.items} />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontFamily: mono, fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--color-text-muted)", margin: 0 }}>
          gaps
        </h2>
        <VitalsGaps gaps={rollup.gaps} window={days} />
      </section>
    </AppShell>
  );
}
