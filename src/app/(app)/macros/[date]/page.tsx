import { UserButton } from "@clerk/nextjs";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { DayContent } from "@/components/macros/DayContent";
import { DayKindControl } from "@/components/macros/DayKindControl";
import type { DayRollupData } from "@/lib/macros/types";
import { isValidDate } from "@/lib/http/params";
import { getDayRollup } from "@/lib/macros/repo";
import { buildWeek } from "@/lib/macros/week";
import { deleteEntryAction, patchEntryAction, setDayKindAction } from "../actions";

// Live, per-request data (entries + day-kind mutate).
export const dynamic = "force-dynamic";

/** The real, Clerk-gated macros day view — reads the live rollup and week via the repo. */
export default async function MacrosDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();

  const rollup = (await getDayRollup(date)) as unknown as DayRollupData;
  const week = await buildWeek(date);

  return (
    <AppShell
      routeSegment={`macros/${date}`}
      activeModule="macros"
      headerRight={<DayKindControl kind={rollup.day.kind} action={setDayKindAction.bind(null, date)} />}
      navFooter={<UserButton />}
    >
      <DayContent
        rollup={rollup}
        week={week}
        basePath="/macros"
        patchEntryAction={patchEntryAction.bind(null, date)}
        deleteEntryAction={deleteEntryAction.bind(null, date)}
      />
    </AppShell>
  );
}
