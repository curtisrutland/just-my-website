import { addDays, dateRange } from "@/components/macros/date";
import type { Kind, WeekDay } from "@/components/macros/types";
import { dayKindsBetween } from "./repo";

/** The 7-day window ending at `selected`, each day resolved to its kind (absent → unspecified). */
export async function buildWeek(selected: string): Promise<WeekDay[]> {
  const from = addDays(selected, -6);
  const kinds = await dayKindsBetween(from, selected);
  return dateRange(from, selected).map((date) => ({ date, kind: (kinds[date] as Kind) ?? "unspecified" }));
}
