import { all, unwrap } from "../../src/data/client";
import type { PieceData } from "../../src/data/piece";

/** What the composition reads. Everything here is frozen to data.json. */
export type Snapshot = {
  /** The ride's own facts, from the API, under the API's names. */
  ride: {
    name: string | null;
    sport: string;
    sportProfileName: string | null;
    localDate: string;
    distanceMeters: number | null;
    movingSeconds: number;
    totalAscentMeters: number | null;
  };
  /** The full-resolution track: one entry per sample that carried a position. */
  track: { t: number[]; lon: number[]; lat: number[] };
  /** How much the look-first step found, for the line that says what the picture covers. */
  counts: { samplesInFile: number; samplesWithPosition: number; tenSecondBuckets: number };
};

const build: PieceData<Snapshot> = async ({ api, fit, log }) => {
  const rides = await all((limit, offset) =>
    api.rides.GET("/api/rides", { params: { query: { sport: "cycling", limit, offset } } }).then(unwrap)
  );
  log(`${rides.length} cycling rides in the log`);

  // The 10 s stream is enough to tell whether a ride has GPS; the raw file is fetched for one ride only.
  for (const candidate of rides) {
    const detail = unwrap(
      await api.rides.GET("/api/rides/{id}", { params: { path: { id: candidate.id }, query: { streams: "1" } } })
    );
    const coarseLat = detail.stream?.data.lat;
    if (!coarseLat?.some((v) => v != null)) continue;

    const { data } = await fit(detail.id);
    const track: Snapshot["track"] = { t: [], lon: [], lat: [] };
    data.t.forEach((t, i) => {
      const lon = data.lon?.[i];
      const lat = data.lat?.[i];
      if (t == null || lon == null || lat == null) return;
      track.t.push(t);
      track.lon.push(lon);
      track.lat.push(lat);
    });
    log(`${detail.localDate}: ${data.t.length} samples in the file, ${track.t.length} with a position`);

    return {
      ride: {
        name: detail.name,
        sport: detail.sport,
        sportProfileName: detail.sportProfileName,
        localDate: detail.localDate,
        distanceMeters: detail.distanceMeters,
        movingSeconds: detail.movingSeconds,
        totalAscentMeters: detail.totalAscentMeters,
      },
      track,
      counts: {
        samplesInFile: data.t.length,
        samplesWithPosition: track.t.length,
        tenSecondBuckets: detail.stream!.data.t.length,
      },
    };
  }
  throw new Error("No cycling ride with GPS was found.");
};

export default build;
