import type { RideFacts } from "@/lib/garage/schema";
import type { RideView } from "@/lib/rides/types";

/**
 * A ride's facts as the garage copies them in (CONVENTIONS §9). Surface glue: the web reads a ride
 * through the rides module and hands these to the garage's write path, so neither module reads
 * the other.
 */
export function rideFacts(r: Pick<RideView, "id" | "localDate" | "startedAt" | "sportProfileName" | "movingSeconds" | "distanceMeters">): RideFacts {
  return {
    activityId: r.id,
    localDate: r.localDate,
    startedAt: r.startedAt,
    sportProfileName: r.sportProfileName,
    movingSeconds: r.movingSeconds,
    distanceMeters: r.distanceMeters,
  };
}
