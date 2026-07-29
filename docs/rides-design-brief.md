# Design brief → Claude Design: Rides (justmy.website)

A **fifth module** for justmy.website. **Reuse the existing design system you already built** for
this project — the exact same tokens (`--color-*`, `--font-*`, `--radius`, `--band`), the dark-mode-
first look, the mono/tabular numbers, and the `AppShell` chrome (210px nav rail + terminal header).
This module adds a `rides` nav entry (add it as a **LIVE** link) and two screens: the **ride log**
(with the upload affordance) and a **ride detail**. Don't invent a new aesthetic; extend the one
that's there.

Produce a **visual + structural reference** (single-file artifact is fine), rendered against the
**real data** below. The full binding spec is `docs/rides-model.md` — it wins on any conflict. The
backend is not yet built; the JSON below is shaped to the approved contract and its numbers are
**decoded from the real FIT file** that will be the first ride ever ingested. This is not a sketch.

---

## STOP — what the real data actually looks like (design for this, not for a Strava screenshot)

The first activity is a **44-minute evening MTB ride recorded on a watch** (Instinct 3), not a
head-unit century with a power meter. Rendering against it surfaces the truths:

1. **No power. No cadence. No temperature.** This ride — and every ride until a meter exists — has
   HR, GPS, speed, altitude, calories, and nothing else. **Null-heavy is the default state, not an
   edge case.** A stat band or chart area designed power-first would open half-empty on day one.
   Sections for absent channels **disappear entirely** — no dimmed placeholders, no `—` grid cells
   for sensors Curtis doesn't own.
2. **Display units are imperial, always** (the device itself is set to statute): distance in
   **miles, one decimal** (`6053.13 m → 3.8 mi`); ascent/descent in **whole feet** (`88 m →
   289 ft`); speed in **mph, one decimal** (`2.309 m/s → 5.2 mph`); temperature °F if it ever
   appears. HR whole bpm, calories whole kcal, durations `h:mm:ss`/`mm:ss`. Storage is SI —
   conversion is display-side, exactly like lifting's whole-lb rule. No metric toggle in v1.
3. **The date is `localDate`, never the timestamp's UTC date.** The first ride started
   **7:46 PM Jul 28 local**, which is **12:46 AM Jul 29 UTC** — the naive render is wrong on file
   one. Show `localDate` (+ local start time) everywhere.
4. **Unnamed rides are the norm** (naming is optional, after the fact). The fallback title is
   **`sportProfileName` + date** — this ride renders as **"MTB — Jul 28"**, which reads like a
   person's log, not `cycling · 2026-07-29T00:46:39Z`.
5. **Elapsed ≈ moving on real rides** (2621.5 s both, here). Lead with **moving time**; show
   elapsed only when it meaningfully differs (paused rides).
6. **HR zones are a histogram, not a score.** `timeInHrZone` gives seconds per zone **plus the
   bpm boundaries it was computed with** (`[90, 107, 125, 143, 161, 179]`, max 179). Render a
   single horizontal **zone bar** (segments proportional to time, labeled by **bpm range**, muted
   palette, no red-alarm gradient) on the detail. It describes where the ride happened — this one
   is honest effort: 13:30 in 143–161 and 7:35 in 161–179. **No "training effect", no load
   gauges, no fitness commentary** — those numbers exist in Garmin's file and this module
   deliberately refuses them.
7. **Streams are irregular** (Garmin smart recording, 1–12 s gaps, downsampled to 10 s buckets).
   Chart channels that exist: **elevation** (this file spans only 603–691 ft — a modest profile;
   don't let axis scaling turn a hill into an alp, label the axis honestly), **HR**, **speed**.
   `null` bucket = a visible gap, never interpolated smoothness. A power chart appears **only**
   when the channel exists.
8. **The map is real and v1** (Leaflet + OSM tiles over the stream's lat/lon polyline). Indoor
   rides have no GPS → **no map section at all** (see rule 1). Tiles must sit comfortably in the
   dark theme (muted/dark tile styling or a CSS filter — your call; no new tokens).
9. **Upload lives on the log** and this era is the *manual* era: **multi-file** drag-drop +
   picker, each file resolving to one of three honest results — **ingested** (new ride card),
   **deduped** (calm, points at the existing ride — the daemon will re-send files forever, this
   is normal, not an error), **failed** (the loud one — undecodable/multisport, show the reason).
   Progress per file; no modal wizard.

---

## The one idea that must come through visually

**The log is the value.** A calm, chronological record of what was actually ridden — the meter's
numbers, honestly presented, nothing scoring him. Unlike weight (trend hero) or lifting
(juxtaposition hero), rides has **no hero panel at all**: the restraint *is* the signature.
No fitness score, no freshness model, no streaks, no weekly goal rings, no "you're trending up!".
Where Strava gamifies, this module simply remembers. Spend your care on making the **ride cards
scannable** and the **detail page quietly complete** — stat band, zone bar, charts, map, each
section earning its place only when its data exists.

## Screen 1 — `RideLog` (the daily surface)

- **A quiet weekly strip** atop the list (not a hero): this week's **rides · miles · feet climbed
  · moving time**, mono, one line, muted labels. Previous weeks collapse into the list flow or a
  tiny sparkline-free table — no charts here. (Data: the `weekly` rollup, cycling by default.)
- **Ride cards, newest first**, grouped or dated by `localDate`. Each card scannable in one pass:
  - Title: **`name`**, else **"`sportProfileName` — Mon DD"** ("MTB — Jul 28").
  - Mono stat line: **distance mi · moving time · ascent ft · avg HR** — and **avg power (W)
    only when present**. Absent stats vanish; the line re-flows (a watch ride shows 4 stats, not
    4 stats + 2 blanks).
  - A quiet `sport`/`subSport` tag ("MTB", "road", "indoor"). A `note` snippet when present,
    truncated, muted.
- **Sport filter chips**: **`rides` (default) · all** (+ other sports appear as chips only once
  they exist in the data). Rides-first is the point; a hike is findable, not featured.
- **The upload affordance** (see STOP #9): a compact drop zone / button in the log header —
  present but understated; this is a log, not an uploader. Per-file result list appears inline
  and dismisses.
- Empty state (no rides yet): friendly mono line — "`no rides yet — drop a .fit file`".

## Screen 2 — `RideDetail` (quietly complete)

Top to bottom, each section rendering **only if its data exists**:

- **Header**: title (name or fallback), `localDate` + local start time, sport tag, device
  (muted, small: "instinct3Amoled50mm"). Inline **name edit** (click-to-edit, optimistic save).
- **Stat band**: mono/tabular pairs — moving time, distance, ascent/descent, avg/max HR, avg/max
  speed, calories; avg/max/NP power **only when present**. This is the instrument panel; keep it
  dense and calm.
- **HR zone bar** (STOP #6): one horizontal segmented bar + per-segment time on hover/beneath,
  labeled by bpm ranges. Muted spectrum; no alarm colors.
- **Charts**: elevation profile, HR over time, speed over time — stacked small-multiples sharing
  an x-axis (time from start), `--color-accent` used sparingly (one line per chart, muted axes,
  mono labels). Gaps stay gaps. Power joins the stack only when recorded.
- **Map**: the GPS polyline on muted tiles, `--color-accent` for the track. Start/end markers
  subtle. Absent for indoor rides — the page simply doesn't have it.
- **Note**: Curtis's `note` as an editable textarea (placeholder "`add a note`"), inline
  optimistic save — the same warm-panel treatment as lifting's session notes, but this is the
  only editorial element on the page; everything else is the meter's truth.

## Interactions & behavior

- **Editable: `name` and `note`. Nothing else.** Every measured number is read-only forever
  (corrections happen by reprocessing the file, not in the UI).
- **No add-a-ride affordance anywhere** — rides arrive as files (upload) and, later, from a
  daemon. There is no manual entry and there never will be.
- Upload results (ingested / deduped / failed) per STOP #9; deduped is calm, failed is loud.
- Soft-delete a ride (bad upload) via a quiet overflow action with confirm; no bulk delete.
- **Theme toggle / terminal header / nav rail** — inherited from `AppShell`, unchanged. Header
  route reads `~/rides`.

## Color / tone

Mostly **neutral** — `--color-text`, `--color-text-muted`, `--color-border`. The accent is
reserved for: the chart line, the map track, and the active filter chip. The zone bar uses a
muted single-hue ramp (not green-to-red). All numbers `--font-mono` tabular. Dark-mode-first;
light derived. Emotional register: a well-kept paper logbook — precise, unhurried, nothing
selling you anything.

---

## The response contract (what your components receive)

Bind to these exact field names (from `src/lib/rides/types.ts` once built; instants are ISO
strings, dates are `YYYY-MM-DD`). **All stored values are SI** — convert per STOP #2.

```
RideView = {
  id, name: string|null, note: string|null,
  sport: string, subSport: string|null, sportProfileName: string|null,
  startedAt: ISO, localDate: "YYYY-MM-DD",
  elapsedSeconds: number, movingSeconds: number,
  distanceMeters: number|null, totalAscentMeters: number|null, totalDescentMeters: number|null,
  avgPowerWatts: number|null, maxPowerWatts: number|null, normalizedPowerWatts: number|null,
  avgHeartRate: number|null, maxHeartRate: number|null,
  avgCadence: number|null, maxCadence: number|null,
  avgSpeedMps: number|null, maxSpeedMps: number|null,
  calories: number|null, avgTemperatureC: number|null,
  timeInHrZone: { timeInHrZone: number[], hrZoneHighBoundary: number[], maxHeartRate: number }|null,
  deviceManufacturer: string|null, deviceProduct: string|null,
  createdAt: ISO, updatedAt: ISO
}

RideDetail = RideView & {
  stream: {
    resolutionSeconds: number,
    data: {                       // aligned arrays; absent key = channel never recorded
      t: number[],                // seconds from start
      lat?: (number|null)[], lon?: (number|null)[],
      altitude?: (number|null)[], speed?: (number|null)[], distance?: (number|null)[],
      heartRate?: (number|null)[], power?: (number|null)[], cadence?: (number|null)[],
      grit?: (number|null)[], flow?: (number|null)[]   // stored; NOT charted in v1
    }
  } | null
}

WeeklyStats = { weeks: [{ weekStart: "YYYY-MM-DD", rides: number, distanceMeters: number,
                          movingSeconds: number, totalAscentMeters: number,
                          avgPowerWatts: number|null }] }
```

---

## Real data to render against (decoded from the actual first FIT file)

**The first ride** — render this exact card and detail:

```jsonc
{
  "id": "…",
  "name": null,                          // ← card title: "MTB — Jul 28"
  "note": null,
  "sport": "cycling", "subSport": "mountain", "sportProfileName": "MTB",
  "startedAt": "2026-07-29T00:46:39Z",   // ← 7:46 PM Jul 28 local — show the local side
  "localDate": "2026-07-28",
  "elapsedSeconds": 2621.5, "movingSeconds": 2621.5,   // → "43:41"
  "distanceMeters": 6053.1,              // → "3.8 mi"
  "totalAscentMeters": 88,               // → "289 ft"
  "totalDescentMeters": 90,              // → "295 ft"
  "avgPowerWatts": null, "maxPowerWatts": null, "normalizedPowerWatts": null,  // no sections
  "avgHeartRate": 138, "maxHeartRate": 177,
  "avgCadence": null, "maxCadence": null,
  "avgSpeedMps": 2.309,                  // → "5.2 mph"
  "maxSpeedMps": 8.118,                  // → "18.2 mph"
  "calories": 616, "avgTemperatureC": null,
  "timeInHrZone": {
    "timeInHrZone": [3.0, 436.2, 362.0, 555.0, 810.3, 455.0, 0],
    //  bar: <90 (0:03, invisible-thin) · 90–107 (7:16) · 107–125 (6:02) · 125–143 (9:15)
    //       · 143–161 (13:30, widest) · 161–179 (7:35) · >179 (0:00, omit)
    "hrZoneHighBoundary": [90, 107, 125, 143, 161, 179],
    "maxHeartRate": 179
  },
  "deviceManufacturer": "garmin", "deviceProduct": "instinct3Amoled50mm"
}
```

**Its stream** (shape only — ~260 points at 10 s; elevation spans 603–691 ft): channels present
are `t, lat, lon, altitude, speed, distance, heartRate, grit, flow`. **No `power`, no
`cadence`** — the chart stack is elevation / HR / speed, and the map draws from `lat`/`lon`.

**A named road ride and an indoor ride** (for the card variety + the no-map/no-GPS state):

```jsonc
{ "name": "Big climb loop", "sport": "cycling", "subSport": "road", "sportProfileName": "Road",
  "localDate": "2026-07-26", "movingSeconds": 10561, "distanceMeters": 64820,
  "totalAscentMeters": 811, "avgPowerWatts": 187, "normalizedPowerWatts": 203,
  "avgHeartRate": 142, "avgSpeedMps": 6.14, "calories": 1804,
  "note": "First time up the back side. Legs OK, ran out of water." }
  // → "40.3 mi · 2:56:01 · 2,661 ft · 187 W · 142 bpm" — the with-power card

{ "name": null, "sport": "cycling", "subSport": "indoor_cycling", "sportProfileName": "Indoor",
  "localDate": "2026-07-24", "movingSeconds": 3600, "distanceMeters": null,
  "avgPowerWatts": 205, "avgHeartRate": 149, "calories": 730 }
  // → "Indoor — Jul 24 · 1:00:00 · 205 W · 149 bpm" — no distance, no map, no elevation chart
```

**Weekly strip** (this week, from the rollup): `1 ride · 3.8 mi · 289 ft · 43:41`.

---

## Out of scope

No manual ride entry, ever. No editing of measured data. No fitness/freshness/training-load
anything (Garmin's `totalTrainingEffect` etc. exist in the raw data and are deliberately never
rendered). No grit/flow UI in v1 (stored, un-charted). No power charts/stats when the channel is
absent. No streaks, badges, goals, or weekly targets. No calendar heatmap, no segments, no
leaderboards, no social/comparison anything. No lap/interval UI. No metric-units toggle. No new
tokens or fonts. Just the two `rides` screens + the `rides` nav entry, in the established look.
