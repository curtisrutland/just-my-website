# Vitals module — data model & spec

The sixth module, and the first whose facts arrive from a machine **outside** the platform: a daemon
on Curtis's Upboard polls Garmin Connect's unofficial API and pushes one row per day. Same platform
kernel as the rest (two surfaces / one data, error envelope, pagination, soft-delete, numeric
contract). Lives in `src/lib/vitals/`, its own table, its own API under `/api/vitals/`, its own UI
under `src/app/(app)/vitals/`.

**Status: SPEC — not yet approved, no code written.** Per `docs/MODULE-RUNBOOK.md`, nothing gets
built until Curtis approves this doc.

---

## Core principle: **measurements, not verdicts**

Every other module is honest about a specific kind of fuzziness — macros about *estimation*, weight
about *daily noise*, rides about *what the device computed vs. what it measured*. This one is honest
about the difference between **a number the watch measured** and **a number the watch decided**.

Garmin will happily hand us both, and the decided ones are worse than useless. Verified against
Curtis's real account on 2026-08-25:

| Garmin gives us | Value returned | Why it is not in this module |
|---|---|---|
| VO2max (`mostRecentVO2Max`) | `generic: null, cycling: null` | Never populates — it needs running or road cycling; Curtis rides MTB |
| `get_max_metrics` | `[]` | Same |
| Cycling FTP | 352 W | No power meter exists on the bike |
| Lactate threshold power | **565 W**, `sport: "RUNNING"`, `origin: "weight"` | Contradicts the 352 W above, and is openly derived from body weight |
| Race predictions | 5K 33:01, marathon 7:13 | Extrapolated for a person who does not run |
| Fitness age | 41.9 (chronological 41) | A composite of the above |
| Training readiness | `score: 25`, `FOCUS_ON_SLEEP_QUALITY` | A composite of composites |
| Body Battery | charged 71 / drained 78 | A model over Garmin's stress model |
| Stress (level + durations) | avg 27, max 98 | Garmin's HRV-derived 0–100 model. The *durations* are seductive because they look measured; they are time spent inside model-defined bands |

**Two mutually contradictory FTP numbers, one of them computed from his body weight, is the whole
argument.** This is the same line `docs/ARCHITECTURE.md` already draws for rides ("No fitness scores,
ever") — this module inherits it rather than inventing it.

**The UI has no hero.** No gauge, no ring, no headline score. A dated table of measurements with
sparklines for trend. The restraint *is* the signature: a hero number would imply exactly the daily
verdict the module refuses to make.

### The one kept exception, and why it's consistent

**Sleep stages** (deep / light / REM / awake) are a *classification* over movement + heart rate, not
a direct measurement — so they need the same explicit call-out that the rides module gives its HR-zone
histogram. They are kept because they are self-describing (four durations that sum to the night, in
seconds, no scale and no grade), and because the stage split is the substance of what sleep tracking
*is*. What gets dropped is Garmin's grading of them: `sleepScores` (`overall`, `restlessness`,
`remPercentage`) and `avgSleepStress` are verdicts and are not stored.

**Intensity minutes** are kept on the same reasoning as the rides HR-zone histogram: they are minutes
counted inside configured heart-rate zone boundaries — a measurement plus a published boundary, not a
score.

---

## Anti-scope — what this module deliberately does NOT model

- **No scores of any kind** (the table above). Not stored, not proxied, not "kept in raw for later."
  They *are* retained inside `rawPayload` because that is a verbatim capture, but nothing reads them.
- **No body weight.** `get_weigh_ins` returns data, but `weight` already owns that series and it is
  manually entered. Two writers to one series is how silent conflicts happen. Vitals never writes weight.
- **No intraday series.** Garmin exposes them (96 step buckets/day, SpO2 and respiration arrays); the
  value here is the trend *across* days, not the wiggle *within* one. `rawPayload` keeps the arrays,
  so this is reversible without re-polling.
- **No human write path.** You cannot hand-enter your HRV. See "Surfaces".
- **No cross-module math.** Vitals never joins to macros or rides server-side (`CONVENTIONS §9`).
  `manage-health` assembles; it does not invent.

---

## Table: `vitals_day`

Conventions as every table: `id` (uuid), `createdAt`, `updatedAt`, nullable `deletedAt` (soft-delete;
reads exclude deleted). Calendar dates are `date` in string mode (no timezone math).

- `measuredOn` (date, required) — the local calendar date. **One row per day:** partial-unique index
  on `measuredOn WHERE deleted_at IS NULL`, **upsert semantics**, same as `weight_entry`. This is
  load-bearing: Garmin *revises* a day after the fact (sleep is finalized in the morning, resting HR
  updates late), so the daemon re-polls a trailing window and the newest poll wins.

**Every measurement column is nullable.** A day with no watch worn, a night with no sleep recorded, a
device that didn't sync — all normal. Null means "not measured", and the UI says so rather than
showing a zero.

| Column | Type | Source field | Notes |
|---|---|---|---|
| `sleepTotalSeconds` | int | `dailySleepDTO.sleepTimeSeconds` | 22,560 on the verified day |
| `sleepDeepSeconds` | int | `deepSleepSeconds` | classification — see exception above |
| `sleepLightSeconds` | int | `lightSleepSeconds` | |
| `sleepRemSeconds` | int | `remSleepSeconds` | |
| `sleepAwakeSeconds` | int | `awakeSleepSeconds` | |
| `napSeconds` | int | `napTimeSeconds` | |
| `sleepStartAt` / `sleepEndAt` | timestamptz | `sleepStart/EndTimestampLocal` | epoch ms → instant |
| `sleepSpo2Avg` / `sleepSpo2Low` | real / int | `averageSpO2Value` / `lowestSpO2Value` | overnight pulse-ox |
| `sleepRespirationAvg` | real | `averageRespirationValue` | breaths/min |
| `hrvLastNightMs` | int | `hrvSummary.lastNightAvg` | **milliseconds, measured** (60) |
| `hrvLastNight5MinHighMs` | int | `hrvSummary.lastNight5MinHigh` | (111) |
| `restingHeartRate` | int | `restingHeartRate` | (45) |
| `minHeartRate` / `maxHeartRate` | int | `minHeartRate` / `maxHeartRate` | (44 / 119) |
| `spo2Avg` / `spo2Low` | real / int | `averageSpo2` / `lowestSpo2` | all-day |
| `respirationWakingAvg` | real | `avgWakingRespirationValue` | |
| `respirationLow` / `respirationHigh` | real | `lowest/highestRespirationValue` | |
| `steps` | int | `totalSteps` | |
| `floorsAscended` | real | `floorsAscended` | barometric |
| `intensityMinutesModerate` | int | `moderateIntensityMinutes` | zone-counted — see exception |
| `intensityMinutesVigorous` | int | `vigorousIntensityMinutes` | |
| `rawPayload` | jsonb | — | the verbatim Garmin responses for the day |

Index on `measuredOn`.

**`rawPayload` is the lossless source**, exactly as the FIT file is for rides and `rawPayload` is for
lifting. It holds the merged raw responses (`get_user_summary`, `get_sleep_data`, `get_hrv_data`) so
that a field we chose not to surface today can be back-filled across all history later **without
re-polling Garmin** — which matters more here than anywhere else, because Garmin rate-limits hard and
this history is not re-derivable from anything we own. A day is a few KB; this belongs in Postgres,
not Blob.

### Judgment calls made while drafting (flagged for approval, not silently decided)

- **Calories are excluded.** `totalKilocalories` / `activeKilocalories` / `bmrKilocalories` were in
  the "measured" column when we first triaged, and that was wrong: BMR is computed from height/weight/
  age, and active calories are modeled from heart rate. Under this module's own principle they are
  verdicts. They stay in `rawPayload`. **Curtis: overrule this if you want burn figures.**
- **`totalDistanceMeters` is excluded** — it is steps × an estimated stride length, not a measurement.
  Steps are kept.
- **Garmin's own rolling averages are not stored.** `lastSevenDaysAvgRestingHeartRate` (48) and
  `hrvSummary.weeklyAvg` (51) are dropped in favour of deriving both in the repo, per the "default to
  deriving anything reproducible so it can't drift" rule.
- **Adaptive goals are excluded.** `dailyStepGoal` (4,290) moves daily by Garmin's own algorithm —
  a verdict wearing a target's clothing. `intensityMinutesGoal` (150) is a static WHO guideline and is
  a display constant if we ever want it, not a stored per-day fact.

---

## Derived — computed in `repo`, never stored

- **7-day trailing resting HR average** — mean over the trailing 7 calendar days, gap-tolerant.
- **7-day trailing HRV average** — same, over `hrvLastNightMs`. Replaces Garmin's `weeklyAvg`.
- **7-day trailing sleep average** — mean `sleepTotalSeconds`.
- **Deltas** — current 7-day average minus the 7-day average from 7 days ago, for RHR / HRV / sleep.
  A day-over-day delta is noise; the weight module's lesson applies unchanged.
- **Series** for the sparklines — per-day raw points + the rolling line over a window (default 30
  days, selectable; the account only has history from 2026-07-28).
- **Gaps** — dates in the window with no row, or a row whose key fields are null. Stated as a factual
  absence, never as a judgment (`CONVENTIONS §9`).

---

## Surfaces — the first module with no human write path

- **Daemon (machine)** — `POST /api/vitals`, one JSON body per day, upsert on `measuredOn`. The only
  thing that creates or updates a vitals row. See `docs/garmin-daemon.md`.
- **Web UI** (Clerk-gated) — **read-only.** A dated measurement table with sparklines, plus a gap
  indicator. No entry form, no inline edit: these numbers come off a wrist, and a typed-in HRV would
  be a fiction. The only write the web offers is soft-delete of a junk day.
- **Token API** (`/api/vitals/**`) — reads for the skill; the one write route for the daemon.
- **Skill** (`manage-vitals`) — read-focused, Python-stdlib over the token API, token injected at
  build. It has no create/update methods, because there is no such thing as Claude logging a vital.

**The write rule survives intact.** The daemon's POST goes through the same
`vitalsDaySchema.parse() → repo` path as any other write. The input arriving from a foreign API
changes nothing about validation — same as rides, where the input is a binary file.

### Correction lever

There is no PATCH. A wrong number is not hand-corrected; it is **reprocessed** from `rawPayload`
(`POST /api/vitals/{date}/reprocess`), exactly as a ride is reprocessed from its stored FIT file. If
the raw itself is wrong, soft-delete the day and let the daemon re-poll it.

---

## API routes

| Route | Auth | Notes |
|---|---|---|
| `GET /api/vitals` | standard bearer | paginated list, `from`/`to` date range |
| `GET /api/vitals/summary` | standard bearer | derived rollup + series + gaps |
| `GET /api/vitals/{date}` | standard bearer | one day, `rawPayload` excluded by default |
| `POST /api/vitals` | **publisher token** (+ standard) | upsert one day. `201` on create, `200` on update |
| `POST /api/vitals/{date}/reprocess` | standard bearer | re-parse the stored raw, rewrite fact columns |
| `DELETE /api/vitals/{date}` | soft by default; hard requires `JMW_API_KEY` | agent token structurally barred from hard delete |

> **Note on `GET` list vs detail:** issue #40 (list endpoints silently omit fields that exist on
> detail objects) applies here from day one — the list and detail shapes share one view schema.

### Kernel departure: the publisher token gains a second route

`JMW_PUBLISHER_TOKEN` today is accepted by exactly one route (`POST /api/rides/upload`) via
`requireUploadToken` in `src/lib/auth/tokens.ts`, and is deliberately absent from `identify()` so it
can never read, patch, or delete anything anywhere. That property is preserved; only the route list
grows:

- Rename `requireUploadToken` → `requirePublisherToken` (it is no longer upload-specific).
- Accepted by **exactly two** routes: `POST /api/rides/upload`, `POST /api/vitals`.
- Still not in `identify()`. Still no reads, no DELETE, no other module.

The reasoning is unchanged from `docs/rides-model.md` §2: the box in Curtis's house should be able to
push facts and do nothing else. The alternative — putting `JMW_API_KEY` on the Upboard — hands a
full-access key with DELETE rights to a machine on a home network, which is the exact thing the
publisher token was invented to avoid. `src/lib/auth/tokens.test.ts` must gain a case asserting the
publisher token is rejected by a vitals **read**.

---

## Zod schema (`src/lib/vitals/schema.ts`) — single source of truth

One `vitalsDaySchema` for the daemon's write: `measuredOn` (ISO date), every measurement optional and
nullable, `rawPayload` passthrough. Normalization happens here, not in the daemon:

- Epoch-millisecond sleep timestamps → instants.
- Seconds stay **seconds** and milliseconds stay **milliseconds** (numbers, never strings, per the
  numeric contract) — the UI formats "6h 16m", the data does not.
- Stage seconds are **not** rebalanced to sum to `sleepTotalSeconds`. If Garmin's numbers disagree, we
  store what it said; inventing consistency is a verdict.
- A view schema shared by list and detail, so #40 cannot recur.

The OpenAPI fragment is generated from this file — it is **not** hand-written.

---

## UI contract — component inventory

- **`VitalsTable`** — the module's centre of gravity. Rows = days (newest first), columns grouped
  sleep / heart / breathing / movement. Mono numerals. Nulls render as an em-dash with a "not
  measured" title, never `0`.
- **`VitalsSparkline`** — one small trend line per metric, shared component, no axes, no score.
- **`VitalsDayDetail`** — one day expanded: the sleep stage bar (four segments, labelled as Garmin's
  classification), the night's SpO2/respiration, HRV.
- **`VitalsGaps`** — the honest absence strip: which days in the window have nothing.
- No hero component. Deliberately.

Reuse the existing design system — `AppShell` chrome, existing tokens, mono numbers. No new aesthetic.

---

## Build checklist (definition of done — `CONVENTIONS §8`)

- [ ] `src/lib/vitals/{schema,repo,types}.ts` + `vitalsDay` table in `src/lib/db/schema.ts` + migration
- [ ] `requireUploadToken` → `requirePublisherToken`, second route allowed, tests updated (incl. a
      "publisher token cannot read vitals" case)
- [ ] API routes under `src/app/api/vitals/`
- [ ] UI under `src/app/(app)/vitals/` + `src/components/vitals/` (read-only)
- [ ] Nav chip (`AppShell.tsx`) + landing card (`Landing.tsx`) flipped to LIVE
- [ ] **OpenAPI:** import schemas in `scripts/build-openapi.ts`, build `vitalsSpec`, add
      `["vitals", vitalsSpec]` to `fragments`, run `npm run openapi:build`, confirm
      `openapi/vitals.json` exists
- [ ] **Docs:** this doc committed, README module list + `docs/ARCHITECTURE.md` live-modules table updated
- [ ] **Skill:** `skills/manage-vitals/` registered in `scripts/build-skills.mjs`
- [ ] **Health cross-cut (`CONVENTIONS §9`):** vitals numbers added to `manage-health`'s daily AND
      weekly views; "other health skills" cross-reference sections updated in `manage-macros`,
      `manage-weight`, `manage-lifting`, `manage-rides` to mention vitals
- [ ] Daemon built and running on the Upboard (`docs/garmin-daemon.md`)
- [ ] Verified end-to-end against the live domain, not just typecheck

---

## Open / deferred

- **Calories** — excluded above; reversible from `rawPayload` if Curtis overrules.
- **Intraday series** — a `vitals_sample` table mirroring `ride_stream`. Retained in raw; no UI need yet.
- **Stress / Body Battery** — deliberately out. Revisit only if Garmin ever documents the model, which
  it will not.
- **Backfill depth** — the account starts **2026-07-28** (verified: every probe ≥30 days back returns
  null). Initial backfill is ~28 days, a single cheap pass. No pagination strategy needed.
- **Weight from Garmin** — permanently out of scope while `weight` is manually entered.
- **A second wearer / multi-user** — not modelled; this platform has one human.
