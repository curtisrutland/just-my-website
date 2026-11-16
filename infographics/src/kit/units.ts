/**
 * Unit formatters (docs/infographics.md §5): a quantity reads exactly as the web UI shows it, so
 * these ARE the web UI's formatters, re-exported. No piece formats a unit by hand.
 *
 * Rides read imperial: miles and mph at one decimal, whole feet, h:mm:ss. Formatters for other
 * modules join this file when a piece first needs them, from that module's own UI code.
 */
export { ft, hms, mdLong, mdShort, mi, mph, rideTitle, watts } from "../../../src/components/rides/format";
