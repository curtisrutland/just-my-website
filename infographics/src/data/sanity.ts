/**
 * Data sanity rules (docs/infographics.md §4). A fact that is probably not what it claims to be
 * is asked about, never quietly included and never quietly dropped.
 */

/** A bike ride with a top speed above this is questionable: most likely the watch kept recording in a car. */
export const MAX_PLAUSIBLE_MPH = 30;

const MPS_TO_MPH = 2.2369363;

/** What Curtis said about one questionable ride. Recorded in the piece's data.ts, with the reason. */
export type RideDecision = { action: "exclude" | "include"; why: string };

type RideLike = { id: string; localDate: string; sportProfileName: string | null; maxSpeedMps: number | null };

/** The rides whose top speed is over the limit. */
export function questionableRides<R extends RideLike>(rides: R[], maxMph: number = MAX_PLAUSIBLE_MPH): R[] {
  return rides.filter((ride) => (ride.maxSpeedMps ?? 0) * MPS_TO_MPH > maxMph);
}

/**
 * Apply Curtis's decisions to the questionable rides. A questionable ride with no decision stops
 * the data step with the list to ask him about: nothing questionable reaches a snapshot unasked.
 * Returns the rides to use, and the ones left out with the reason, so a piece can say so.
 */
export function settleQuestionableRides<R extends RideLike>(
  rides: R[],
  decisions: Record<string, RideDecision>,
  maxMph: number = MAX_PLAUSIBLE_MPH
): { rides: R[]; excluded: { ride: R; why: string }[] } {
  const flagged = questionableRides(rides, maxMph);
  const unasked = flagged.filter((ride) => !decisions[ride.id]);
  if (unasked.length > 0) {
    const lines = unasked.map(
      (ride) => `  ${ride.localDate}  ${ride.sportProfileName ?? "ride"}  top speed ${((ride.maxSpeedMps ?? 0) * MPS_TO_MPH).toFixed(1)} mph  id ${ride.id}`
    );
    throw new Error(
      `${unasked.length} ride${unasked.length === 1 ? " has" : "s have"} a top speed over ${maxMph} mph. Ask Curtis about each, then record his answer in this piece's data.ts:\n${lines.join("\n")}`
    );
  }
  const excluded = flagged.filter((ride) => decisions[ride.id].action === "exclude").map((ride) => ({ ride, why: decisions[ride.id].why }));
  const out = new Set(excluded.map((e) => e.ride.id));
  return { rides: rides.filter((ride) => !out.has(ride.id)), excluded };
}
