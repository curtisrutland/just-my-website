import { notFound } from "next/navigation";
import { todayISO } from "@/components/macros/date";
import { AppShell } from "@/components/macros/AppShell";
import { DayContent } from "@/components/macros/DayContent";
import { DayKindControl } from "@/components/macros/DayKindControl";
import type { DayRollupData } from "@/components/macros/types";
import { getDayRollup } from "@/lib/macros/repo";
import { buildWeek } from "@/lib/macros/week";

// Reads live data each request.
export const dynamic = "force-dynamic";

/**
 * Dev-only preview of the macro UI against REAL seeded data (read-only: static day-kind control,
 * no Clerk button). Unauthenticated so it can be eyeballed without the gate. 404s in production.
 */
export default async function PreviewMacros() {
  if (process.env.NODE_ENV === "production") notFound();
  const date = todayISO();
  const rollup = (await getDayRollup(date)) as unknown as DayRollupData;
  const week = await buildWeek(date);
  return (
    <AppShell routeSegment={`macros/${date}`} activeModule="macros" headerRight={<DayKindControl kind={rollup.day.kind} />}>
      <DayContent rollup={rollup} week={week} basePath="/macros" />
    </AppShell>
  );
}
