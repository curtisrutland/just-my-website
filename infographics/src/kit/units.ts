/**
 * Unit formatters (docs/infographics.md §5): a quantity reads exactly as the web UI shows it, so
 * these ARE the web UI's formatters, re-exported. No piece formats a unit by hand.
 *
 * Rides read imperial: miles and mph at one decimal, whole feet, h:mm:ss. Weight reads pounds at
 * one decimal. Formatters for other modules join this file when a piece first needs them, from
 * that module's own UI code.
 */
export { ft, hms, mdLong, mdShort, mi, mph, rideTitle, watts } from "../../../src/components/rides/format";

/** Body weight reads in pounds at one decimal, as the weight pages show it: `lb(238.8)` → "238.8". */
export { fmt1 as lb } from "../../../src/components/weight/format";

/** A total of riding time, as the garage page shows a bike's hours: `hours(131760)` → "36.6". */
export const hours = (seconds: number): string => (seconds / 3600).toFixed(1);
