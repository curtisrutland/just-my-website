import { addDays, dateRange } from "@/lib/date";

/** The 7-day window ending at `selected`, as plain dates. Purely derived from the date — the week
 *  strip is navigation, so it needs no per-day state (the day-type dots it once carried are gone). */
export function buildWeek(selected: string): string[] {
  return dateRange(addDays(selected, -6), selected);
}
