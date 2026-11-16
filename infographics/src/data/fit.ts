import { decodeFitSamples } from "../../../src/lib/rides/fit";
import { type Api, unwrap } from "./client";

/**
 * One ride at full resolution: its raw FIT file (GET /api/rides/{id}/fit), decoded by the site's
 * own decoder. There is no second decoder, so the channel names and unit conversions are exactly
 * the ones ingestion uses (docs/infographics.md §4). `t` is each sample's own offset in seconds.
 *
 * Only for a piece that needs every sample. The 10 s stream on the ride detail answers most
 * questions, including which rides are in an area.
 */
export async function fullResolution(api: Api, rideId: string) {
  const bytes = unwrap(await api.rides.GET("/api/rides/{id}/fit", { params: { path: { id: rideId } }, parseAs: "arrayBuffer" }));
  const { startedAt, data } = decodeFitSamples(Buffer.from(bytes));
  return { startedAt: startedAt.toISOString(), data };
}
