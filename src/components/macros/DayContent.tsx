import { todayISO } from "./date";
import { DayNav } from "./DayNav";
import { DayRollup } from "./DayRollup";
import { EntryList } from "./EntryList";
import type { DayRollupData, WeekDay } from "./types";

type EntryAction = (entryId: string, formData: FormData) => void | Promise<void>;

/**
 * The macros page body: day nav → rollup → entries → add-entry. Presentational; the page loads
 * the data and passes it in. `basePath` is where day-nav links route. Entry correction actions are
 * passed only by the gated app (the preview is read-only).
 */
export function DayContent({
  rollup,
  week,
  basePath,
  patchEntryAction,
  deleteEntryAction,
}: {
  rollup: DayRollupData;
  week: WeekDay[];
  basePath: string;
  patchEntryAction?: EntryAction;
  deleteEntryAction?: EntryAction;
}) {
  const today = todayISO();
  return (
    <>
      <DayNav week={week} selected={rollup.day.date} isToday={rollup.day.date === today} today={today} basePath={basePath} canNext={rollup.day.date < today} />
      <DayRollup rollup={rollup} />
      <EntryList entries={rollup.entries} patchAction={patchEntryAction} deleteAction={deleteEntryAction} />
    </>
  );
}
