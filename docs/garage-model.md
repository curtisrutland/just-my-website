# Garage module — data model & spec

> **Status: DRAFT v1 for approval** (rescoped with Curtis 2026-11-16, from the 2026-09-30 draft).
> No code until this is approved.

The bike garage: the bikes Curtis owns, and which bike each ride was on. v1 is deliberately small (bikes, profile rules, ride tags), built so the September draft's maintenance tracker (parts, service intervals, hours) can be added later without reshaping it. See [Roadmap](#roadmap--after-v1).

Same platform kernel as every module (two surfaces / one data, two-token auth, error envelope, pagination, soft-delete, PATCH-default). Lives in `src/lib/garage/`, with its own tables, its own API under `/api/garage/`, and its own UI under `src/app/(app)/garage/`.

**The one honest idea: every ride on the right bike, and you can see why.** A tag always says how it was made: by a profile rule ("GRAVEL"), by Curtis, or by the backfill with its reason ("named in the ride", "before the Roscoe arrived"). A ride that matches no rule stays **untagged** and is listed for Curtis. It is never guessed.

**Kind: logging module** (`CONVENTIONS §9`). The garage owns its facts: which bikes exist, which profile means which bike, which bike a ride was on. A tag *copies in* the ride's facts it needs (date, profile, moving time, distance) at write time. Garage server code never reads the rides tables, and the rides module never learns about bikes. Deleting the garage leaves rides untouched (§9's garage test).

---

## The bikes (initial load)

| Nickname | Year | Make | Model | Profiles (rules) |
|---|---|---|---|---|
| Neuron 6 | 2026 | Canyon | Neuron 6 | — |
| Roscoe 8 | 2026 | Trek | Roscoe 8 | — |
| Model C | 2026 | Sunday | Model C | `BMX` |
| Checkpoint ALR4 | 2026 | Trek | Checkpoint ALR4 | `GRAVEL`, `Bike` |

The nicknames are the model names for now; Curtis can rename them.

`Bike` (the Instinct's generic cycling profile) is a Checkpoint rule because the data says so: every `Bike` ride whose bike is known is the Checkpoint, and the rest are all road pace (9.2–14.5 mph). Curtis rides the mountain bikes and the BMX on pavement only between trails. The Neuron and the Roscoe get profiles when Curtis sets up per-bike profiles on his devices. Until then, `MTB` and `MOUNTAIN` rides are tagged by hand.

Known dates: the Neuron was first. The Checkpoint was in use by 2026-08-09. The Roscoe was delivered 2026-10-01. The Model C was bought 2026-11-07.

---

## Anti-scope for v1 (each is on the roadmap, not rejected)

- No parts, installs, service intervals, services, or the "what's due" status view.
- No estimated (pre-tracking) hours. v1's hours are tracked rides only.
- The `manage-garage` skill is small: mileage per bike (all time or a window, always with the untagged rides beside it), tagging rides on Curtis's word, untagged rides, bikes and their profiles. The backfill is a one-time script.
- No iOS surface (no `garage:*` device scopes yet).
- No money, suspension setup, Garmin Connect Gear, or notifications (anti-scope from the September draft, unchanged).

---

## Units

Stored SI, like rides: **seconds** and **meters**, as numbers. Hours and miles are display concerns.

---

## Tables

The usual columns on every table: `id` (uuid), `createdAt`, `updatedAt`, nullable `deletedAt` (soft-delete; reads exclude deleted rows). Table names are namespaced `garage_*`.

### `garage_bike`

- `name` (text, required): the nickname. Unique among live bikes, case-insensitive.
- `brand`, `model` (text, required), `modelYear` (integer, required). The UI's "make" is `brand`.
- `note` (text, nullable).
- `retiredOn` (date, nullable): sold or gone. A retired bike keeps its rides, loses its profile rules, and is offered for no new tags.

### `garage_profile`: the auto-tag rules

- `profile` (text, required): a watch or bike-computer activity profile, matched against a ride's `sportProfileName` **case-insensitively and verbatim** (`BMX`, `GRAVEL`).
- `bikeId` (uuid → bike, required).
- **A profile names at most one bike:** partial-unique on `lower(profile)` among live rows. **A bike may claim several profiles**, because Curtis's devices name the same kind of ride differently (`MOUNTAIN` on the Edge MTB, `MTB` on the Instinct 3). This replaces the September draft's single `activityProfile` column.

### `garage_ride`: the ride tags

One row per tagged ride.

- `activityId` (uuid, required): the ride's id in the rides module. Opaque, with no foreign key, since the row lives in another module. **Partial-unique among live rows:** a ride is on at most one bike.
- `bikeId` (uuid → bike, required).
- `assignedBy` (text, required): `rule` | `manual` | `backfill`.
- `reason` (text, nullable): for `rule`, the matched profile (`GRAVEL`). For `backfill`, why (`named in the ride`, `before the Roscoe arrived`). Null for `manual`.
- **Copied facts** (snapshotted at write time, `§9`): `localDate` (date), `startedAt` (timestamptz), `sportProfileName` (text, nullable), `movingSeconds` (real, ≥ 0), `distanceMeters` (real, nullable, ≥ 0).

**Precedence: a person beats a rule.** `manual` and `backfill` tags are never changed by rules. A `rule` tag is re-pointed when its profile moves to another bike, and untagged when the rule is removed. Moving a ride to another bike by hand turns it into a `manual` tag.

The copied moving time is what later service-hour tracking adds up, so v1's tags are the first half of the roadmap's hours ledger, not a dead end.

---

## Derived: computed in `repo`, never stored

Per bike, from its live tags: **ride count, total moving time, total distance, last ridden** (the latest `localDate`). These are the garage's own numbers from its own copied facts, so they make no live query to rides.

---

## Auto-tagging: how rides get tagged without the garage reading rides

The garage can't read rides itself, so whoever holds the ride hands it over. One garage call applies the rules: **`POST /api/garage/rides/attribute`**, with a batch of `{activityId, localDate, startedAt, sportProfileName, movingSeconds, distanceMeters}`. For each ride:

- **Already tagged `manual` or `backfill`:** left alone.
- **Profile matches a rule:** creates the `rule` tag, or re-points an existing `rule` tag. It's idempotent: re-sending the same ride is a no-op.
- **No match:** reported back as untagged and not stored.

It returns `{tagged, unchanged, unmatched}` so the caller can say what happened.

Three callers. Each is a surface or client reading rides and writing garage through garage's own API, which `§9` allows:

1. **The Garmin daemon** (`daemon/garmin_daemon.py`), right after each successful ride upload. The publisher token's allowlist gains this one route, with a model-doc entry and a test (`CONVENTIONS §2`). A failed attribute call is logged and the upload stands.
2. **The web ride upload** server action, after the rides write succeeds.
3. **"Apply rules to untagged rides"** on `/garage`. The page reads the ride list (rides repo) and its tags (garage repo), and sends the untagged ones through `attribute`. This catches anything the first two missed, and it's how a new profile rule reaches older rides.

---

## Surfaces

### Web UI (Clerk-gated: repo reads in server components, writes via server actions)

- **`/garage`:**
  - Bikes as cards: nickname, "2026 Canyon Neuron 6", profiles, rides, hours, miles, last ridden. Retired bikes are folded away.
  - Add and edit a bike, including its profiles. Retire a bike.
  - **Untagged rides:** each untagged cycling ride, newest first, with an inline bike picker, plus the "Apply rules" button above. This is where Curtis works through the backfill list.
- **Rides pages (reading garage as a surface):**
  - On the ride page, a bike line ("Checkpoint ALR4 · rule: GRAVEL") with a picker to set or change it, or "Untagged" with a picker.
  - In the ride list, the bike's nickname in each row.
- The nav gains **Garage**.

### Token API (`/api/garage/**`)

- `bikes/route.ts`: `GET` (list, with derived totals; `?includeRetired`; `?from=&to=` totals only the rides in that window of local dates), `POST`.
- `bikes/[id]/route.ts`: `GET` (the same `from`/`to` window), `PATCH` (including `profiles: string[]`, which replaces the set), `DELETE` (soft; hard requires `JMW_API_KEY`).
- `rides/route.ts`: `GET` (`?bikeId`, `?activityId`, `?from`, `?to`, paginated), `POST` (a manual tag with copied facts). A ride that's already tagged to the same bike gets `200`; to another bike, `409` naming it, because moving a ride is a `PATCH`.
- `rides/[id]/route.ts`: `PATCH` (`bikeId`, which makes it `manual`), `DELETE` (soft: untag).
- `rides/attribute/route.ts`: `POST`, the rule application above. Accepted by the full and agent tokens, plus the publisher token on this route only.

Every write on both surfaces goes `schema.parse() → repo`, as always. OpenAPI comes from Zod and gets registered in `scripts/build-openapi.ts` and the docs (see the module runbook).

---

## Initial load: `scripts/garage-backfill.ts` (one-time)

1. Creates the four bikes and three profile rules (`BMX` → Model C; `GRAVEL` and `Bike` → Checkpoint ALR4).
2. Proposes a tag for each existing cycling ride, in this order:
   1. **Profile rule** → a `rule` tag.
   2. **The ride's name or note names exactly one bike** → `backfill`, "named in the ride". The aliases: checkpoint, gravelking (the Checkpoint's tires) or cyclovia → Checkpoint; neuron or canyon → Neuron; roscoe → Roscoe; model c or sunday → Model C.
   3. **Before 2026-10-01 with no bike named** → Neuron 6, `backfill`, "before the Roscoe arrived".
   4. **Everything else goes on Curtis's list:**
      - two or more bikes named;
      - a bike named before it existed (the Roscoe before 10/1);
      - an `MTB`, `MOUNTAIN` or `Bike` ride after 10/1 with no bike named.
3. A dry run by default prints every proposed tag with its reason, plus the list. `--apply` writes them through the garage repo.

Preview against today's data (63 cycling rides):

| Bike | Tags | How |
|---|---|---|
| Neuron 6 | 24 | before the Roscoe arrived |
| Checkpoint ALR4 | 22 | 5 by the `GRAVEL` rule, 7 by the `Bike` rule, 10 named in the ride (including the three Cyclovia rides and the GravelKing tire ride) |
| Roscoe 8 | 2 | named in the ride (10/11, 10/13) |
| Model C | 2 | 1 by the `BMX` rule, 1 named in the ride (11/7) |
| **Curtis's list** | **13** | all Neuron-or-Roscoe trail rides, see below |

The list:
- **The Roscoe named before its 10/1 delivery** (9/24 "On the new Roscoe", 9/26, 9/30). The delivery date and the notes disagree, so these aren't guessed.
- **10/20, which names both the Neuron and the Roscoe.**
- **9 `MTB` or `MOUNTAIN` rides after 10/1 with no bike named.**

A speed rule was considered and left out. No ride on an MTB profile averages road pace (every known mountain-bike or BMX ride is 8.4 mph or less), so once `Bike` is a rule, "9.5 mph or more → Checkpoint" tags nothing extra, and it would put a guess into live auto-tagging.

Curtis tags the list on `/garage`. The two elliptical sessions aren't cycling and aren't considered.

---

## Build checklist (definition of done)

- [ ] Tables and a migration; `schema.ts` (bike, profile and tag schemas plus response views); `repo.ts` with derived totals and the attribute logic. Repo tests, including precedence (manual beats rule, re-pointing, untagging on rule removal) and the profile-uniqueness constraint.
- [ ] Token API routes with OpenAPI registration and docs; the publisher allowlist entry plus its test; the response contract test.
- [ ] Web: `/garage`, the rides-page bike line and list column, the nav item.
- [ ] Attribute callers: the daemon (after upload), the web upload action, the `/garage` sweep.
- [ ] `scripts/garage-backfill.ts`, a dry run reviewed with Curtis, then `--apply`.
- [ ] Curtis pokes at it locally before merge.

---

## Roadmap — after v1

From the September draft, still the intended direction. Each step adds tables; none reshapes v1's.

1. **Parts and installs:** `garage_component` (a fixed kind list plus `other`, only `kind` required, `source` of `spec_sheet` / `verified` / `assumed`) and `garage_install` (install windows, so a fork keeps its hours across bikes).
2. **Hours:** a part's hours are derived from the `garage_ride` rows of the bike it was installed on during its install window, plus `garage_estimate` rows for pre-tracking history (bike- or component-level, always shown split: "62 h (48 tracked + ~14 est.)").
3. **Intervals and services:** hours, distance or months, whichever comes first. Services reset specific intervals. This leads to the **"what needs attention before your next ride" status view**.
4. **`manage-garage`, grown with parts:** Claude builds a bike's parts from its spec sheet and logs services. Garage creates take client-supplied ids, so the skill can retry every write (#57's reference implementation). (v1's skill already covers mileage and tagging.)
5. **iOS:** the bike on the ride detail (`garage:read`), then tagging from the phone (`garage:write`).

### Open / deferred

- **Ride reprocessed or deleted:** copied facts can drift and tags can orphan. The `/garage` sweep can flag tags whose ride no longer appears in the rides list; a resync is a roadmap skill action.
- **Bulk tagging** (select a week or month on the rides list, choose a bike). Not needed if the backfill list stays around 19.
