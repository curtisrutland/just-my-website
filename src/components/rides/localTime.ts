/**
 * Server-side display helper: an instant's LOCAL wall-clock time ("7:46 PM") in the app
 * timezone (JMW_TZ, same source as src/lib/date.ts). Server components only — the env var
 * doesn't exist client-side. The calendar DATE never comes from here (that's the stored
 * `localDate`, from the device's own clock); this is just the time-of-day garnish beside it.
 */
const APP_TZ = process.env.JMW_TZ || "America/Chicago";

export function localStartTime(startedAtIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startedAtIso));
}
