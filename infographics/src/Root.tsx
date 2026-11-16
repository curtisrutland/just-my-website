import { sampleRide } from "../pieces/2026-11-sample-ride/Piece";

/**
 * Every piece's compositions, registered for Studio and the renderer. A new piece adds one import
 * and one line here (docs/infographics.md §7).
 */
export function Root() {
  return <>{sampleRide}</>;
}
