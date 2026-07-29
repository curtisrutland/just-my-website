# Rides module — data model & spec

> Status: **Approved (Curtis, 2026-07-29)** — backend built + verified on `feat/rides-module`
> the same day (see BACKLOG); UI pending the Claude Design handoff (`docs/rides-design-brief.md`).
> Interview run 2026-07-29; every decision below is Curtis's unless marked *open*.

The fifth module, and the **second ingestion module** (after lifting) — but the first whose
input is a **binary file**, not JSON. Garmin **FIT activity files** are uploaded (by hand in v1;
by a local daemon in v2), parsed once, and become the record of what was ridden.

**Named `rides`, deliberately.** The module ingests *any* Garmin activity (a `sport` column keeps
it honest), but riding is its reason for existing, the thing Curtis will talk to the agent about,
and the thing the UI leads with. Runs and hikes are guests in a rides-first house. (Also
load-bearing: the name `activity` is already claimed in this codebase by the audit-feed scoping
draft, `docs/activity-model.md` — a completely different feature. Nothing here uses that word as
a module name.)

**Core principle (the signature): *the log is the value.*** A calm chronological record of what
was actually ridden, with strong per-ride pages — the meter's numbers, honestly presented. No
fitness score, no freshness/fatigue model, no training-load pseudoscience, no gamification.
The module refuses to tell Curtis what the numbers *mean* about his fitness; it shows what the
device measured. (Interpretation, if wanted, is the agent's job in conversation — same division
of labor as lifting.)

---

## How this module departs from the kernel (read this first)

Three departures, all deliberate:

1. **The write is a file, not JSON.** Every other module's writes are
   `schema.parse(json) → repo`. Here the inbound artifact is FIT binary; the pipeline is
   `decode(bytes) → fitRideSchema.parse(normalized) → repo`. The kernel rule survives intact —
   no write path skips validation — the parse just has a decode step in front of it. There is
   **no create-a-ride-by-hand path on either surface**: facts only enter as files.

2. **A third token: `JMW_PUBLISHER_TOKEN`.** The v2 daemon (Curtis's local machine pulling from
   Garmin's unofficial API) needs to push files without holding a full-access key. Same
   least-privilege reasoning as lifting's `HEVY_WEBHOOK_TOKEN`, but this one is a real JMW bearer
   token, checked by the kernel auth helper — just **scoped**: accepted **only** by
   `POST /api/rides/upload`. No reads, no deletes, no other module, ever. It is built in v1 (cheap
   now; avoids a breaking auth change when the daemon arrives). The upload route also accepts the
   normal tokens.

3. **A second store: Vercel Blob (private).** The raw FIT file is kept forever — it is the
   lossless source the way `rawPayload` is for lifting — but binary blobs don't belong in Neon
   (hundreds of MB/yr). Postgres holds the parsed summary + downsampled streams; Blob holds the
   original, keyed on the row, reprocessable at any time.

---

## FIT / parsing (the external dependency)

Grounding facts, **verified 2026-07-29 by decoding a real activity** (Curtis's MTB ride of
2026-07-28, Instinct 3 AMOLED 50mm — the first file this module will ingest; 136 KB, decodes
with `integrity: true`, zero errors):

- **Parser:** `@garmin/fitsdk` (npm, official Garmin FIT SDK for JS, currently 21.208.x).
  Pure-JS decode, runs fine in a Vercel function. Decodes to profile-named camelCase messages;
  FIT timestamps arrive as JS `Date`s (except `localTimestamp`, left as raw FIT-epoch seconds —
  offset **631065600** from Unix).
- **Messages we consume (fields as observed):**
  - `fileIdMesgs` — `manufacturer` (`"garmin"`), `product` (number), **`garminProduct`**
    (readable string, `"instinct3Amoled50mm"` — prefer this for `deviceProduct`),
    `serialNumber` (number), `timeCreated`.
  - `sessionMesgs` — the summary: `sport`/`subSport` (`"cycling"`/`"mountain"`),
    **`sportProfileName`** (`"MTB"` — the device profile name, the best display fallback),
    `startTime`, `totalElapsedTime`, `totalTimerTime` (moving), `totalDistance`,
    `totalAscent`/`totalDescent`, `avgHeartRate`/`maxHeartRate`, `enhancedAvgSpeed`/
    `enhancedMaxSpeed`, `totalCalories`, `numLaps`. Power (`avgPower`/`maxPower`/
    `normalizedPower`), cadence, and `avgTemperature` appear only when a sensor recorded them —
    **absent entirely on this watch ride**, confirming nullable-everything. Also present:
    device-computed training-load numbers (`totalTrainingEffect`, `totalAnaerobicTrainingEffect`,
    `trainingLoadPeak`), MTB dynamics (`totalGrit`, `avgFlow`), and a GPS bounding box
    (`necLat`/`swcLat`/…) — these live in `rawSession` and get no columns (see anti-scope).
  - `activityMesgs` — `numSessions` (the multi-session guard) and **`localTimestamp`**, the
    device-local time: the honest source for the ride's **local calendar date**, no timezone
    assumption needed.
  - `recordMesgs` — samples: `timestamp`, `positionLat`/`positionLong` (**semicircles** —
    convert × 180/2³¹ to degrees), `enhancedAltitude`, `enhancedSpeed` (the **only** altitude/
    speed variants present — there are no plain `altitude`/`speed` keys), `distance`,
    `heartRate`, and (sensor-dependent) `power`, `cadence`, `temperature`, plus `grit`/`flow`
    on MTB profiles. **Smart recording: gaps observed from 1 s to 12 s** — downsampling must
    bucket by timestamp, never by record index.
  - `timeInZoneMesgs` — time-in-HR-zone: a seconds-per-zone array **plus the zone boundaries
    it was computed against** (`hrZoneHighBoundary`, calc type, max HR) — self-describing, so a
    later zone-config change never falsifies old rides. Arrives once per session and once per
    lap; we keep the **session-referenced** one (`referenceMesg: "session"`), verbatim.
  - `lapMesgs` — **ignored in v1** (deliberate; the Blob keeps them). Likewise ignored:
    `gpsMetadataMesgs`, `userProfileMesgs`, `zonesTargetMesgs` (device FTP settings are not
    this module's business).
- **Units are SI natively** (m, s, m/s, W, bpm, kcal, °C) — matching the numeric contract with
  zero conversion. Display units (miles, mph, feet) are a UI concern, like lb in lifting.
- **Multi-session files** (`numSessions > 1`, multisport events) are **rejected loudly** in v1 —
  a validation error, not a silent first-session pick. Deferred until one actually exists.

**Env this module adds:**
- `JMW_PUBLISHER_TOKEN` — upload-only bearer token (the v2 daemon's credential).
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (auto-provisioned in prod; `vercel env pull` locally).

---

## Tables

Audit columns as usual on `ride`: `id` (uuid), `createdAt`, `updatedAt`, nullable `deletedAt`
(soft-delete; reads exclude deleted). Instants are `timestamptz`.

> **Facts vs. the human layer — the ownership split, in one table this time.** Every parsed
> column is an **ingested fact**: immutable from the surfaces, rewritten only by reprocessing
> the file. Exactly two columns are **surface-writable**: `name` and `note`. That's the whole
> annotation layer. Measured data is never hand-editable — a wrong watt is fixed by fixing the
> parser and reprocessing, not by editing the watt.

### `ride` — one row per ingested FIT activity

Identity / dedupe:
- `fileHash` (text, required) — sha256 of the FIT bytes. **Partial-unique on live rows.** The
  primary dedupe: re-uploading the same file (the daemon will) is idempotent — returns the
  existing ride, never a duplicate.
- `startedAt` (timestamptz, required) — session `startTime`. The sort key.
  **Partial-unique on (`startedAt`, `deviceSerial`) among live rows** — catches the same
  activity re-exported with different bytes. One device cannot start two activities in the
  same second; two devices recording the same ride (watch + Edge) legitimately coexist.
- `deviceManufacturer`, `deviceProduct` (text, nullable), `deviceSerial` (text, nullable) —
  from `fileIdMesgs`.
- `blobKey` (text, required) — the Blob pathname, deterministic: `rides/<fileHash>.fit`
  (deterministic key = a crashed upload retries idempotently).

Classification:
- `sport` (text, required) — Garmin's sport string verbatim (`cycling`, `running`, `hiking`, …).
- `subSport` (text, nullable) — verbatim (`mountain`, `road`, `indoor_cycling`, …).
- `sportProfileName` (text, nullable) — the device profile name verbatim (`"MTB"`). The display
  fallback of choice: an unnamed ride renders as "MTB — Jul 28" before falling back to sport.
- `localDate` (date, required) — the ride's **local calendar date, from the file itself**
  (`activityMesgs.localTimestamp`, FIT epoch + 631065600; fallback when absent: `startedAt` in
  Curtis's timezone via `src/lib/date.ts`). Stored, not derived — it's an ingested fact the
  device knew, and it can't be recomputed from `startedAt` without a timezone guess. This is
  the date for the log's grouping and cross-module talk ("Tuesday's ride").

Summary facts (all nullable except durations — honesty about what a given device captured):
- `elapsedSeconds` (real, required), `movingSeconds` (real, required)
- `distanceMeters`, `totalAscentMeters`, `totalDescentMeters` (real)
- `avgPowerWatts`, `maxPowerWatts`, `normalizedPowerWatts` (real) — NP is stored because the
  **device** computed it (an ingested fact); this module computes no power model of its own.
- `avgHeartRate`, `maxHeartRate` (integer)
- `avgCadence`, `maxCadence` (real)
- `avgSpeedMps`, `maxSpeedMps` (real)
- `calories` (integer) — kcal, same energy unit as macros.
- `avgTemperatureC` (real)
- `timeInHrZone` (jsonb, nullable) — the session-referenced `timeInZone` message **verbatim**:
  seconds-per-zone plus the boundaries/calc-type it was computed with. Kept because it is a
  *histogram of measurements* (where the HR samples fell — `avgHeartRate` with shape), not a
  model score; the embedded boundaries make it self-auditing. Surfaced on the detail view and
  `get_ride`. Computed by the device at full sample resolution — our 10 s stream could only
  approximate it, so the device's version is the fact.
- `rawSession` (jsonb, nullable) — the decoded session message verbatim (numbers survive even if
  unmodeled). Convenience only; the Blob is the authoritative raw. **This is deliberately where
  Garmin's training-load numbers (`totalTrainingEffect`, `trainingLoadPeak`, …), MTB dynamics
  (`totalGrit`, `avgFlow`), and the GPS bounding box stay** — present in the data, absent from
  the schema and the UI, per the signature: the module doesn't traffic in fitness scores.

Human layer (the only surface-writable columns):
- `name` (text, nullable) — "the big climb loop". Display falls back to sport + date.
- `note` (text, nullable) — "legs felt dead", "new saddle".

Indexes: partial-unique `fileHash` (live rows); partial-unique (`startedAt`, `deviceSerial`)
(live rows); `startedAt` desc (the log); `sport`.

### `ride_stream` — the downsampled time series (1:1, rebuilt on reprocess)

Like lifting's exercise/set children: a **projection of the raw file, rebuilt wholesale by
reprocess** — `id` + `createdAt` only, no `updatedAt`/`deletedAt`, cascade-deleted with the ride.

- `rideId` (uuid, required, FK → `ride.id` cascade, **unique**).
- `resolutionSeconds` (integer, required) — the downsample bucket, **10** in v1.
- `data` (jsonb, required) — aligned arrays keyed by channel:
  `{ "t": [...], "power": [...], "heartRate": [...], "cadence": [...], "speed": [...],
     "altitude": [...], "lat": [...], "lon": [...], "distance": [...], "grit": [...],
     "flow": [...] }`
  where `t` is seconds-from-start and every other array is the same length with `null` gaps.
  Downsampling **buckets by timestamp, never by record index** — Garmin smart recording spaces
  records irregularly (1–12 s observed on the real file), so an empty bucket is a `null`, not a
  skipped slot. **Bucket mean** for power/HR/cadence/speed; **bucket last** for
  altitude/lat/lon/distance/grit/flow. Channels the device didn't record are simply absent
  (the real MTB file yields `t`/`lat`/`lon`/`altitude`/`speed`/`distance`/`heartRate`/`grit`/
  `flow` — no power, no cadence).

Size honesty: a 5-hour ride at 10s ≈ 1,800 points ≈ low hundreds of KB of jsonb with GPS —
fine at one-user scale, and kept out of the `ride` row so list reads never drag it along.
(The real 44-minute file: 1,582 records → ~260 stream points.)

---

## Derived — computed in `repo`, never stored

Deliberately short — most numbers here are *facts from the device*, not derivations:

- **Weekly rollup** (for the skill's marquee read + a small UI strip): per ISO week — ride
  count, `distanceMeters`, `movingSeconds`, `totalAscentMeters`, and avg power across rides
  that have it. Sport-filterable, defaults to cycling.
- **Dedupe verdicts** — "this file/activity already exists" is computed at ingest, not stored.

(`localDate` is *not* here — it's stored at ingest, because the file's `localTimestamp` is a
fact that can't be recomputed from `startedAt` without a timezone guess.)

**Not derived, ever (anti-scope): no CTL/ATL/TSB, no fitness/freshness, no TSS, no FTP
estimation, no power curve (v1), no calorie reconciliation with macros.** The module stores what
the meter said and stops.

---

## Ingestion — the write path for facts

One pipeline, however the bytes arrive (web upload in v1, daemon in v2). Shared function
(`src/lib/rides/ingest.ts`), used by the API route and the server action identically:

```
FIT bytes
  → sha256 → dedupe check (fileHash, then startedAt+deviceSerial)   — hit? return existing ride, deduped:true
  → @garmin/fitsdk decode → normalize (semicircles→degrees, pick messages)
  → fitRideSchema.parse (Zod — the kernel validation step)
  → Blob put  rides/<fileHash>.fit  (private; deterministic key = idempotent retry)
  → repo.createRideFromFit (ride + ride_stream, one transaction)
```

Blob-then-DB ordering: a crash between the two leaves an orphan blob, which is harmless — the
retry writes the same key and completes the row. (An orphan-sweep is deferred; see Open.)

**Reprocess — the corrections lever.** `POST /api/rides/{id}/reprocess` re-reads the Blob,
re-runs decode → parse, and rebuilds every parsed column + the stream **in place** (same row id).
`name`/`note` are untouched, exactly as a Hevy re-pull never touches the annotation. This is how
a parser improvement back-fills history (e.g. if v1 skipped a field the SDK exposes) and why
"keep the raw file" pays for itself.

---

## Surfaces

- **Web UI** (`/(app)/rides`, Clerk-gated): the **log** — ride cards newest first (name-or-
  fallback, local date, distance, moving time, ascent, avg power/HR, sport tag), sport filter
  chips (**default: rides**, one tap to all). An **upload affordance on the log page**
  (file picker + drag-drop, **multi-file** — the manual era is also the backfill era), each file
  reporting ingested / deduped / failed. **Ride detail** is where the care goes: stat band,
  effort charts from the stream (power/HR/elevation over time), **the route map (v1)** —
  Leaflet + OSM tiles over the stream's lat/lon, simply absent for indoor rides — and inline
  `name`/`note` editing. Server components read via repo; server actions write via the shared
  ingest pipeline / `schema.parse → repo`. The UI never calls the API.
- **Token API** (`/api/rides/**`): upload (the one publisher-token route), reads, the human-layer
  `PATCH`, soft-DELETE (agent barred from hard, per kernel), reprocess. Standard envelope /
  pagination / errors.
- **Skill** (`manage-rides`, ships with v1): the conversation surface. Marquee actions:
  **list_rides** (sport defaults to cycling; `sport=None` for everything), **get_ride** (streams
  excluded by default — the agent wants the summary, not 1,800-point arrays), **weekly** (the
  rollup), **update_ride** (name/note — the agent writes the human layer from conversation,
  loud on unknown fields, house pattern). No upload via skill (the agent has no files); no
  reprocess via skill (a maintenance lever, not a conversation one).

### API routes

- `src/app/api/rides/upload/route.ts` — `POST`, body = raw FIT binary
  (`application/octet-stream`, ~15 MB guard). **Accepts `JMW_PUBLISHER_TOKEN` (its only route)**
  plus the normal tokens. `201` + RideView + `Location`; `200` + `{ ...existing, deduped: true }`
  on dedupe hit; `400 validation_error` on undecodable/multi-session files.
- `src/app/api/rides/route.ts` — `GET` paginated list. Filters: `sport`, `from`/`to`
  (inclusive bounds on `localDate` — the honest "what did I ride in July" axis), `q` (substring
  on name or `sportProfileName`, so "MTB" finds unnamed rides). Summaries only, never streams.
- `src/app/api/rides/[id]/route.ts` — `GET` detail (`?streams=1` to include the stream arrays);
  `PATCH` (name/note only, `.strict()`); `DELETE` (soft; `?hard=true` requires `JMW_API_KEY` and
  also deletes the Blob).
- `src/app/api/rides/[id]/reprocess/route.ts` — `POST` (normal JMW tokens; **not** publisher).
- `src/app/api/rides/weekly/route.ts` — `GET` the weekly rollup (`weeks`, `sport` params).

`get`-after-write, soft-delete default, PATCH-as-modify-verb: all kernel-standard.

---

## Zod schemas (single source of truth)

Two families — ingestion (validates what the decoder produced) and the human-layer write:

```ts
// ---- Ingestion: the normalized decode output. Internal contract; extra decoded keys land
// ---- in rawSession, not here.
export const fitRideSchema = z.object({
  fileHash: z.string().length(64),
  sport: z.string().min(1),
  subSport: z.string().nullable(),
  sportProfileName: z.string().nullable(),
  startedAt: z.coerce.date(),
  localDate: z.iso.date(),
  elapsedSeconds: z.number().nonnegative(),
  movingSeconds: z.number().nonnegative(),
  distanceMeters: z.number().nonnegative().nullable(),
  totalAscentMeters: z.number().nullable(),
  totalDescentMeters: z.number().nullable(),
  avgPowerWatts: z.number().nullable(),
  maxPowerWatts: z.number().nullable(),
  normalizedPowerWatts: z.number().nullable(),
  avgHeartRate: z.number().int().nullable(),
  maxHeartRate: z.number().int().nullable(),
  avgCadence: z.number().nullable(),
  maxCadence: z.number().nullable(),
  avgSpeedMps: z.number().nullable(),
  maxSpeedMps: z.number().nullable(),
  calories: z.number().int().nullable(),
  avgTemperatureC: z.number().nullable(),
  timeInHrZone: z.record(z.string(), z.unknown()).nullable(),
  deviceManufacturer: z.string().nullable(),
  deviceProduct: z.string().nullable(),
  deviceSerial: z.string().nullable(),
  rawSession: z.record(z.string(), z.unknown()).nullable(),
  stream: z.object({
    resolutionSeconds: z.number().int().positive(),
    data: z.record(z.string(), z.array(z.number().nullable())),
  }),
});

// ---- Human layer: the ONLY surface write. Nullable = clearable. .strict() keeps the
// ---- facts immutable — { avgPowerWatts: 250 } is a 400, not a correction.
export const ridePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).nullable(),
    note: z.string().trim().max(4000).nullable(),
  })
  .partial()
  .strict();
```

There is deliberately **no `rideCreateSchema`** — rides are never authored, only ingested.
View schemas (`rideViewSchema`, `rideDetailViewSchema`, weekly stats) follow the one-view-schema-
per-read-surface parity rule, with a derived `localDate` and `deduped` only on upload responses.

---

## Repo surface (`src/lib/rides/repo.ts`)

The only place the two tables are touched; reads exclude soft-deleted.

- `findExisting(fileHash, startedAt, deviceSerial)` → the dedupe check (both keys).
- `createRideFromFit(parsed, blobKey)` → transactional ride + stream insert.
- `reprocessRide(id, parsed)` → rewrite parsed columns + rebuild stream; never touches
  name/note/audit identity.
- `listRides({ limit, offset, sport?, from?, to?, q? })` → summaries + count.
- `getRide(id, { includeStream })`.
- `weeklyStats({ weeks, sport })` → the rollup.
- `patchRide(id, patch)` → name/note only (schema already guarantees it).
- `softDeleteRide(id)` / `hardDeleteRide(id)` — hard also removes the Blob object (route-gated
  to `JMW_API_KEY`).

Support files: `src/lib/rides/fit.ts` (decode + normalize + downsample — pure, unit-testable
against a fixture FIT file), `src/lib/rides/ingest.ts` (the shared pipeline), `types.ts`.

---

## Mock data shape (for the design tool)

The first item is the **real first-ingest ride** (decoded 2026-07-29), not an invention —
design against it:

```jsonc
{
  "items": [
    {
      "id": "…",
      "name": null,                        // ← renders as "MTB — Jul 28" (sportProfileName)
      "sport": "cycling", "subSport": "mountain", "sportProfileName": "MTB",
      "startedAt": "2026-07-29T00:46:39Z", "localDate": "2026-07-28",
      "elapsedSeconds": 2621.5, "movingSeconds": 2621.5,
      "distanceMeters": 6053.1, "totalAscentMeters": 88, "totalDescentMeters": 90,
      "avgPowerWatts": null, "maxPowerWatts": null, "normalizedPowerWatts": null,  // ← watch, no meter
      "avgHeartRate": 138, "maxHeartRate": 177,
      "avgSpeedMps": 2.309, "maxSpeedMps": 8.118, "calories": 616,
      "avgCadence": null, "avgTemperatureC": null,
      "note": null,
      "deviceProduct": "instinct3Amoled50mm", "deviceManufacturer": "garmin"
    },
    {
      "id": "…",
      "name": "Big climb loop",            // ← named via the human layer
      "sport": "cycling", "subSport": "road", "sportProfileName": "Road",
      "startedAt": "2026-07-26T13:04:11Z", "localDate": "2026-07-26",
      "elapsedSeconds": 11342, "movingSeconds": 10561,
      "distanceMeters": 64820, "totalAscentMeters": 811,
      "avgPowerWatts": 187, "maxPowerWatts": 642, "normalizedPowerWatts": 203,
      "avgHeartRate": 142, "maxHeartRate": 174,
      "avgSpeedMps": 6.14, "calories": 1804,
      "note": "First time up the back side. Legs OK, ran out of water."
    },
    {
      "id": "…",
      "name": null,
      "sport": "cycling", "subSport": "indoor_cycling", "sportProfileName": "Indoor",
      "startedAt": "2026-07-24T22:10:00Z", "localDate": "2026-07-24",
      "movingSeconds": 3600, "distanceMeters": null,  // ← trainer: no GPS, no map section
      "avgPowerWatts": 205, "avgHeartRate": 149, "calories": 730
    }
  ],
  "limit": 20, "offset": 0, "count": 3
}
```

Dark-mode-first, numbers in `--font-mono` tabular. SI stored; the UI displays imperial
(mi / mph / ft) — a display conversion, never a stored one. The log is calm: no scores, no
badges, no streaks.

---

## Build checklist (definition of done)

Per `CONVENTIONS §8` + the runbook (the last three are the never-auto-generated ones):

- [ ] `src/lib/rides/` — `schema.ts`, `fit.ts`, `ingest.ts`, `repo.ts`, `types.ts`
- [ ] `ride` + `ride_stream` in `src/lib/db/schema.ts` + migration
- [ ] `@garmin/fitsdk` + `@vercel/blob` deps; `JMW_PUBLISHER_TOKEN` + Blob token env wired
      (local + Vercel)
- [ ] Kernel auth helper learns the scoped `publisher` token kind (upload route only)
- [ ] API routes: `upload`, list, `[id]` (GET/PATCH/DELETE), `[id]/reprocess`, `weekly`
- [ ] Activity capture per the standing convention (`withActivity` / `logAction`) if the
      activity-feed module has landed by then; otherwise noted, not silently skipped
- [ ] UI under `src/app/(app)/rides/` + `src/components/rides/` (log + upload + detail with
      charts + Leaflet map); nav chip + landing card flip
- [ ] `fit.ts` unit tests against the fixture FIT file (the 2026-07-28 MTB ride,
      `23770495354_ACTIVITY.fit`) — **Curtis decides whether the fixture is committed to the
      repo or stays local-only** (it contains a real GPS track). If local-only, the test skips
      gracefully when the file is absent.
- [ ] Verify against real FIT files: this MTB ride end-to-end (upload → dedupe re-upload →
      reprocess → soft-delete), plus a trainer ride (no GPS) and a non-cycling activity when
      available
- [ ] **OpenAPI:** register in `scripts/build-openapi.ts` → `npm run openapi:build` →
      `openapi/rides.json` exists
- [ ] **Docs:** README module list, `docs/ARCHITECTURE.md` live-modules table, `docs/BACKLOG.md`
- [ ] `manage-rides` skill (list / get / weekly / update) + zip built; re-upload noted to Curtis

## Open / deferred (for the backlog)

- **The v2 daemon** — lives outside this repo entirely; its whole contract with this codebase is
  `POST /api/rides/upload` + `JMW_PUBLISHER_TOKEN`. Nothing else to build here for it.
- **Laps / structured-workout view** — `lapMesgs` are in the Blob; a `ride_lap` projection is a
  reprocess away if interval work ever wants to be queryable.
- **Power curve** (best 1/5/20-min) — derivable from streams (or Blob, full-fidelity) later;
  explicitly not a v1 feature and never a fitness *score*.
- **Multi-session (multisport) files** — rejected loudly in v1; support when one exists.
- **Map thumbnails on log cards** — small static polylines; nice, deferred.
- **Blob orphan sweep** — a crashed ingest can strand a blob; harmless, sweep tool if it ever
  accumulates.
- **Reprocess-all** — v1 reprocess is per-ride; a sweep endpoint/script when a parser upgrade
  wants to touch everything.
- **Temperature/other channels in streams** — session avg is stored; per-sample temperature
  (and anything else in `recordMesgs`) can join `data` via reprocess.
- **Per-lap HR zones** — only the session-level `timeInHrZone` is kept; the per-lap variant
  stays in the Blob with the rest of the lap data.
- **Cross-module tie-ins** (a ride suggesting a macros `training` day-kind) — deliberately
  agent-side judgment across skills, not platform automation.
