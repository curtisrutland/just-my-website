# Lifting module — data model & spec

The fourth module, and the **first ingestion module**. The three before it (macros, weight,
shopping) are *authored* — the data originates from Curtis or Claude typing it. This one is
different: the workout facts originate in **Hevy**, arrive over a webhook + API pull, and are
effectively read-only once ingested. What this module *owns and writes* is a thin **annotation
layer** on top of those facts.

Same platform kernel as the other three (two surfaces / one data, two-token auth, error envelope,
pagination, soft-delete, numbers-not-strings). Lives in `src/lib/lifting/`, its own tables, its own
API under `/api/lifting/`, its own UI under `src/app/(app)/lifting/`.

**Core principle (the signature):** *the numbers are Hevy's; the meaning is ours.* Hevy is already
the best set logger there is — this module does not try to beat it. It's a **training journal /
interpretation layer** over an external log. The thing you come here for is the *annotated session* —
how it felt (`session_notes`), what the read is on where the block is going (`interpretation`,
written by Claude) — with Hevy's hard numbers as supporting evidence. The signature moment in the UI
is the **juxtaposition of the cold set table against the warm interpretation** on one screen. That
framing is also the anti-scope: it keeps this from bloating into a bad Hevy clone.

---

## How this module departs from the kernel (read this first)

Two conventions bend here. Both are deliberate and documented; neither is a hole.

1. **Data isn't authored — it's ingested, and Hevy is the system of record for the facts.** The
   pulled sets/reps/weights are immutable ingested records. There is **no create-a-session-by-hand**
   write path on either surface. The only writes Curtis or Claude make are to the **annotation
   layer**, which lives in its own table and is never touched by a re-pull.

2. **A third inbound surface — the Hevy webhook — that carries a dedicated secret, not a JMW token.**
   The kernel says *"`/api` is token-only, always; no anonymous reads, no session-cookie path."* Hevy
   can't carry `JMW_API_KEY` — but it *does* send a configurable **`Authorization` header verbatim**
   (its webhook config has an "authorization header" field). So we register
   `Authorization: Bearer <HEVY_WEBHOOK_TOKEN>` with Hevy, and the route checks the inbound
   `Authorization` header equals it. The deviation is therefore **small and precise**: same header
   shape as the kernel, but this one route accepts a **dedicated webhook secret** instead of a JMW
   token. A dedicated secret (not the reused `JMW_AGENT_TOKEN`) is deliberate — **least privilege**:
   if Hevy's stored config leaked, the secret can do nothing but trigger a pull. The route is
   **write-only and never serves a read**, so "no anonymous reads" is fully preserved; only "every
   `/api` write carries a JMW token" is relaxed, for exactly one route, for exactly one caller.
   Everything it writes still flows through `schema.parse → repo`. See **Ingestion** below.

---

## Hevy integration (the external dependency)

Grounding facts about the Hevy public API that shape the design (Hevy **PRO** account required):

- **Auth:** an `api-key` request header. Our key lives in `HEVY_API_KEY` (env).
- **Read endpoints:** `GET /v1/workouts` (paginated by **`page` / `page_size`**; the response
  envelope is `{ page, page_count, workouts: [] }` — Hevy's own scheme, which the `hevy.ts` client
  adapts to our kernel's limit/offset), and `GET /v1/workouts/{id}` for one full workout.
- **Webhook (confirmed from Hevy's config screen):** a *subscription* — we register a **URL** + an
  **authorization header string** once. On workout completion (Hevy's wording: "when you save a new
  workout") Hevy POSTs the flat body **`{ "workoutId": "<uuid>" }`** — the id only, no workout data —
  and **sends our configured string verbatim as the `Authorization` header**. It expects a **200
  within 5 seconds**. Our handler verifies the header, then treats `workoutId` as a trigger and pulls
  the full workout itself.
- **Verified workout shape** (confirmed against a real `GET /v1/workouts` response with Curtis's key):
  workout → `id, title, routine_id, description, start_time, end_time, updated_at, created_at`; each
  exercise → `index, title, notes, exercise_template_id, superset_id`; each set →
  `index, type, weight_kg, reps, distance_meters, duration_seconds, rpe, custom_metric`. **Any of
  `weight_kg` / `reps` / `rpe` / `distance_meters` / `duration_seconds` can be `null`** (e.g. a timed
  cardio set has only `duration_seconds`). Timestamps come in mixed formats (`+00:00` offset and `Z`
  with millis) — `z.coerce.date()` absorbs both.
- **Units:** the API returns weights in **kg** (`weight_kg` per set). We store canonical kg; "lb" is a
  display concern (numeric contract, CONVENTIONS §6).

**Env vars this module adds:**
- `HEVY_API_KEY` — Curtis's Hevy PRO API key (used to pull workouts).
- `HEVY_WEBHOOK_TOKEN` — the `authToken` we register with Hevy; the webhook route rejects any POST
  whose token doesn't match.

---

## Tables

Audit columns on every table as usual: `id` (uuid), `createdAt`, `updatedAt`, nullable `deletedAt`
(soft-delete; reads exclude deleted). Instants are `timestamptz`.

> **Facts vs. annotations — the ownership split is expressed in the schema.** `lifting_session` +
> `lifting_exercise` + `lifting_set` are the **ingested facts** (Hevy owns them; a re-pull may
> rebuild the exercise/set children wholesale). `lifting_session_note` is the **only table this
> module writes to from a surface** — it is keyed to the session and a re-pull never touches it.

### `lifting_session` — one row per Hevy workout

- `hevyId` (text, **required**) — the Hevy workout id and **the natural key**. Unique among live rows
  (partial-unique on `hevy_id WHERE deleted_at IS NULL`) — upsert semantics, so a re-pull of the same
  workout replaces the facts, never duplicates. Every session originates from the Hevy API (webhook or
  backfill pull), so this is always present.
- `title` (text, nullable) — Hevy workout title ("Session B - Injury Adjusted").
- `startedAt` (timestamptz, **required**) — session start. The sort key for the journal.
- `endedAt` (timestamptz, nullable) — session end (duration is derived, not stored).
- `description` (text, nullable) — Hevy's own workout-level note. **Distinct from our
  `session_notes`** — this is whatever Curtis typed *inside Hevy*; our annotation notes are separate.
- `hevyUpdatedAt` (timestamptz, nullable) — Hevy's `updated_at` for the workout. Lets a re-pull detect
  a Hevy-side edit and refresh the facts (skip the rebuild when it hasn't advanced).
- `rawPayload` (jsonb, required) — the **verbatim Hevy workout JSON**, stored losslessly so we can
  re-derive normalized rows if we later model a field we skipped today.

Indexes: partial-unique on `hevyId` (above); `index` on `startedAt` (the journal read, newest first).

### `lifting_exercise` — one row per exercise instance within a session

These (and `lifting_set`) are a **normalized projection of `rawPayload`, rebuilt on re-pull** — so
they carry no soft-delete of their own; the repo deletes-and-reinserts a session's children inside
the upsert transaction. `id` + `createdAt` only (no `updatedAt`/`deletedAt`).

- `sessionId` (uuid, required, FK → `lifting_session.id`, cascade delete).
- `index` (integer, required) — order within the session.
- `exerciseTemplateId` (text, nullable) — Hevy's **stable** exercise id. **This is what threads a
  lift across sessions** ("Bench Press" in one session ties to "Bench Press" in the next → progression
  & PRs). The API supplies it on every exercise; nullable only defensively.
- `title` (text, required) — exercise name as Hevy renders it ("Bench Press (Barbell)").
- `notes` (text, nullable) — Hevy per-exercise note.
- `supersetGroup` (integer, nullable) — Hevy's superset grouping id (co-performed exercises).

Indexes: `index` on `(sessionId, index)`; `index` on `exerciseTemplateId` (cross-session progression).

### `lifting_set` — one row per set

- `exerciseId` (uuid, required, FK → `lifting_exercise.id`, cascade delete).
- `sessionId` (uuid, required, FK → `lifting_session.id`) — denormalized so per-session volume is a
  single-table scan.
- `index` (integer, required) — order within the exercise.
- `setType` (text, required) — `'normal'` | `'warmup'` | `'failure'` | `'dropset'` (Hevy `type`).
  **Only `'normal'` counts as a working set** for volume/e1RM/PRs (warmups excluded).
- `weightKg` (real, nullable) — canonical kg, number only.
- `reps` (integer, nullable).
- `rpe` (real, nullable).
- `distanceMeters` (real, nullable) — for cardio / loaded carries.
- `durationSeconds` (integer, nullable) — for timed sets.

Index: `index` on `exerciseId`.

### `lifting_session_note` — the annotation layer (the only surface-writable table)

Full audit columns (this is *our* data — it gets `updatedAt` and soft-delete). **1:1 with a session.**

- `sessionId` (uuid, required, FK → `lifting_session.id`, **unique**) — the 1:1 link. The session row
  is stable across re-pulls (upserted, never deleted), so a plain FK is safe.
- `sessionNotes` (text, nullable) — **Curtis-owned** (web). How it felt / context ("slept badly",
  "deload week").
- `interpretation` (text, nullable) — **Claude-owned** (skill / token API). The read on the session.
  **Latest-wins** — Claude overwrites on re-analysis.
- `interpretedAt` (timestamptz, nullable) — set whenever `interpretation` is written. **Drives the
  `interpreted:false` queue** — the list of sessions Claude hasn't read yet.
- `focus` (text, nullable) — **Claude-owned** tag from a small set:
  `'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'full' | 'accessory' | 'other'`. Makes sessions
  filterable. (Enforced by Zod, not a DB enum.)
- `quality` (integer, nullable) — **Curtis-owned**, `1..5`. A *subjective* score Curtis sets (unlike
  Hevy's objective numbers) — chartable across a block.

> Ownership is a **convention, not a DB constraint.** Per the kernel, either surface may write any
> field through `schema.parse → repo`; the UI and skill simply respect the split by default (the web
> renders `interpretation` read-only; the skill is the one that writes it).

---

## Derived — computed in `repo`, never stored

Everything reproducible is derived, so it can't drift (same discipline as weight's rolling average).
All computations consider **working sets only** (`setType = 'normal'`).

- **Session tonnage** = Σ `weightKg × reps` over working sets **that have both** (null weight or reps
  — e.g. timed/cardio sets — are skipped, never treated as zero). Plus total working sets, total reps,
  and exercise count. **Duration** = `endedAt − startedAt`.
- **Estimated 1RM (e1RM) — Epley:** `weightKg × (1 + reps/30)`, taken as the **max over an exercise's
  working sets**. **Flagged `unreliable: true` when the best set's `reps > 12`** (Epley degrades at
  high reps) — the UI shows it muted / parenthesized rather than trusting it. Formula is derived and
  swappable (Brzycki noted as an alternative in Open/deferred).
- **PRs (two kinds, per lift identity = `exerciseTemplateId`):** walking all sessions in `startedAt`
  order, maintain a running **max working-set weight** and a running **best e1RM** for each lift. A
  session **flags a PR** when it beats either running max. The session detail and journal card surface
  which lifts PR'd and which kind.
- **Lift progression series** (for a lift-detail view) = best e1RM (and top-set weight) per session
  over time for one `exerciseTemplateId`.

> **Real-data sanity check** (Curtis's current history): sets carry `weight_kg`, `reps`, and
> `duration_seconds`; `rpe` is unused (all null) and there are timed/cardio sets (e.g. Elliptical,
> Warm Up) with only `duration_seconds` — so the null-guards above are exercised in practice, and RPE
> must never be assumed present.

---

## Ingestion — the write path for facts

There is **one source (the Hevy API) and one normalizer + upsert**, so nothing can drift. The webhook
and the backfill/catch-up pull are just two triggers into the same path:

```
Hevy workout JSON ──▶ hevyWorkoutSchema.parse ──▶ normalize ──▶ repo.upsertSessionFromHevy
```

> **Why no CSV importer.** The Hevy API returns Curtis's *complete* history (verified: all sessions
> back to his first, richer than the export — `exercise_template_id`, full-precision kg, second-level
> UTC timestamps, raw payload). A one-time API pull is therefore a strictly better backfill than the
> imperial, template-id-less CSV, and reuses this exact path with zero special-casing. A file importer
> (with lbs→kg / miles→m conversion + timezone dedup) is deliberately **not** built — see
> Open/deferred for when it might return.

### 1. Webhook (real-time) — `POST /api/lifting/webhook`

1. Verify the inbound **`Authorization` header** equals `Bearer <HEVY_WEBHOOK_TOKEN>` (constant-time
   compare; reject → 401, `unauthorized`). **This is the documented carve-out**: dedicated-secret
   auth, no JMW token, write-only.
2. Read `workoutId` from the flat body `{ "workoutId": "<uuid>" }`. **The body is a trigger, never
   trusted as data.**
3. `GET /v1/workouts/{workoutId}` with `HEVY_API_KEY` → full workout.
4. `hevyWorkoutSchema.parse` → normalize → `repo.upsertSessionFromHevy` (upsert by `hevyId`; rebuild
   children; annotation untouched).
5. Return `200` fast (Hevy's timeout is **5 s** — if a pull is ever slow, ack first and pull async;
   for one workout the inline pull is well within budget).

### 2. Backfill + catch-up pull — `POST /api/lifting/pull`

JMW-token authenticated (normal `/api` auth). Pages `GET /v1/workouts` and ingests any `hevyId` we
don't already have (and refreshes any whose `hevyUpdatedAt` advanced) — same normalizer, same upsert,
idempotent. **This one endpoint serves two jobs:**

- **Initial backfill (one-time):** run it once over *all* pages to load the full history. This
  replaces what would have been a CSV import.
- **Catch-up (ongoing):** the recovery lever for a **missed webhook** (a deploy window, an outage) —
  no background cron, just a one-call "catch me up," `?pages=N` to bound the sweep (default: recent
  pages; the initial backfill passes enough pages to reach the start).

> **Known gap (accepted for v1):** with webhook-only ingestion and no reconciliation cron, a workout
> **deleted inside Hevy** won't propagate — we keep the last-pulled copy. Curtis can soft-delete it by
> hand. Documented, not solved in v1.

---

## Surfaces

- **Web UI** (`/(app)/lifting`, Clerk-gated): the **journal**. A list of session cards (newest first)
  and a **session detail** that puts the Hevy set table beside the annotation panel. Curtis's writes:
  `session_notes` (editor) and `quality` (1–5 selector). `interpretation` and `focus` render
  read-only here (Claude's territory). Server components read via `repo`; server actions write the
  annotation via `schema.parse → repo`. **No session-authoring UI** — sessions only come from Hevy.
  The UI **never calls the API.**
- **Token API** (`/api/lifting/**`): ingestion (`webhook`, `pull`), reads (list sessions with
  `interpreted`/`focus` filters; get one full session; lift progression), the annotation `PATCH`, and
  session soft-delete (agent-barred from hard, per kernel). Same envelope / pagination / auth as the
  other modules — **except** the webhook route's carve-out.
- **Skill** (`manage-lifting`, after web + API land): the interpretation loop. Marquee actions —
  **list un-interpreted sessions** (`interpreted:false`), **read one session in full** (sets
  included), **write `interpretation` + `focus`**, and **trigger a pull** (catch-up). The
  interpretation write is the whole point of the module.

### API routes

- `src/app/api/lifting/webhook/route.ts` — `POST` (Hevy `authToken` carve-out; pull + upsert).
- `src/app/api/lifting/pull/route.ts` — `POST` (JMW token; catch-up backfill from `/v1/workouts`).
- `src/app/api/lifting/sessions/route.ts` — `GET` paginated list (filters: `interpreted`, `focus`,
  date range). Returns session summaries (derived tonnage / top e1RM / PR flags + annotation).
- `src/app/api/lifting/sessions/[id]/route.ts` — `GET` full session (exercises + sets + derived +
  annotation), `PATCH` (**annotation only**), `DELETE` (soft; hard requires `JMW_API_KEY`).
- `src/app/api/lifting/lifts/[templateId]/route.ts` — `GET` progression series for one lift.

### `get`-after-write, soft-delete, PATCH-default

Kernel-standard. The annotation `PATCH` returns the updated annotation + session; upserts return the
persisted session. Soft-delete is the default removal; agent token barred from hard DELETE.

---

## Zod schemas (single source of truth)

Two families: the **ingestion** schema (parse the Hevy payload into the normalized shape) and the
**annotation** schema (the only surface write).

```ts
// ---- Ingestion: the Hevy workout payload (subset we model; extra keys ignored, raw kept) ----
export const hevySetSchema = z.object({
  type: z.enum(["normal", "warmup", "failure", "dropset"]).catch("normal"),
  weight_kg: z.number().nonnegative().nullable(),
  reps: z.number().int().nonnegative().nullable(),
  rpe: z.number().nullable(),
  distance_meters: z.number().nullable(),
  duration_seconds: z.number().int().nullable(),
});

export const hevyExerciseSchema = z.object({
  index: z.number().int(),
  title: z.string().min(1),
  notes: z.string().nullable().optional(),
  exercise_template_id: z.string().nullable().optional(),
  superset_id: z.number().int().nullable().optional(),
  sets: z.array(hevySetSchema),
});

export const hevyWorkoutSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  start_time: z.coerce.date(),
  end_time: z.coerce.date().nullable().optional(),
  updated_at: z.coerce.date().nullable().optional(),
  exercises: z.array(hevyExerciseSchema),
}); // → normalize() maps snake_case → our camelCase rows; rawPayload = the input verbatim

// ---- Annotation: the ONLY surface write. Every field optional (PATCH), .strict() ----
export const liftingFocus = z.enum([
  "push", "pull", "legs", "upper", "lower", "full", "accessory", "other",
]);

export const liftingAnnotationPatchSchema = z
  .object({
    sessionNotes: z.string().trim().max(4000).nullable(),
    interpretation: z.string().trim().max(8000).nullable(),
    focus: liftingFocus.nullable(),
    quality: z.number().int().min(1).max(5).nullable(),
  })
  .partial()
  .strict(); // repo sets interpretedAt = now() whenever `interpretation` is present
```

There is deliberately **no `liftingSessionCreateSchema`** — sessions are never authored, only ingested.

---

## Repo surface (`src/lib/lifting/repo.ts`)

The only place the four tables are touched; reads exclude soft-deleted.

**Ingestion (transactional — upsert session, rebuild children, never touch the note):**
- `upsertSessionFromHevy(normalized)` → upsert by `hevyId`; delete+reinsert exercises/sets; store
  `rawPayload`; skip the child rebuild when `hevyUpdatedAt` hasn't advanced; returns the session.
- `catchUp({ pages })` → page `GET /v1/workouts`, ingest the missing/updated ones (wraps the Hevy
  client + `upsertSessionFromHevy`). Serves both the **one-time initial backfill** (all pages) and the
  **catch-up recovery lever** (recent pages).

**Reads (derive tonnage / e1RM / PRs on the way out):**
- `listSessions({ limit, offset, interpreted?, focus?, from?, to? })` →
  `{ items: SessionSummary[], count }` — summaries with derived headline stats + annotation +
  PR flags + `interpreted` boolean.
- `getSession(id)` → full session: exercises → sets, derived stats, PR flags, annotation.
- `getLiftProgression(templateId)` → per-session e1RM / top-set series for one lift.

**Annotation + lifecycle:**
- `patchAnnotation(sessionId, patch)` → upserts the `lifting_session_note` row; sets
  `interpretedAt = now()` iff `interpretation` was supplied. Returns annotation + session.
- `softDeleteSession(id)` / `hardDeleteSession(id)` — hard gated to `JMW_API_KEY` at the route layer.

A thin `src/lib/lifting/hevy.ts` client wraps the two Hevy endpoints (`api-key` header) so the repo /
routes never hand-roll fetches. Pure helpers (Epley e1RM, tonnage, PR walk) live in
`src/lib/lifting/derive.ts` — shared by repo and reused by tests.

---

## UI contract — component inventory (for the design tool)

Reuses `AppShell`, all tokens, mono/tabular numbers. Nav flips the `lifting` chip from `SOON` to
**LIVE** (`AppShell.tsx`); landing row (`Landing.tsx`) to a live link. **The hero is not a chart** —
it's the **session detail**, where the set table and the interpretation sit side by side.

### `LiftingJournal` — the list surface
Session cards, newest first. Each card: date + title, a compact stat line (tonnage, top e1RM,
duration), the **`focus` tag**, the **`quality`** pips, a one-line **interpretation snippet**, **PR
badges** if any, and a quiet **"needs read"** marker when `interpreted:false`. Filter chips for
`focus` and an un-interpreted toggle.

### `SessionDetail` — the signature surface (spend the care here)
Two columns that *are* the "numbers vs. meaning" idea:
- **The facts (left):** the exercise → set table, mono/tabular, kg (display can offer lb). Working
  sets vs. warmups distinguished; PR sets marked; per-exercise e1RM (muted when `unreliable`). This
  is cold, precise, Hevy's truth.
- **The meaning (right):** `session_notes` (Curtis's editable textarea), the **`quality`** selector
  (1–5), the **`focus`** tag, and **Claude's `interpretation`** rendered as prose (read-only in the
  web — Claude writes it via the skill). Warm, editorial.
The juxtaposition is the whole point — let the layout make you feel it.

### `LiftProgression` — supporting, not hero
A small e1RM-over-time line for a selected lift (opened from a set row). Muted; evidence, not
spectacle. Can land after the journal + detail.

---

## Mock data shape (for the design tool to render against)

```jsonc
{
  "sessions": [
    {
      "id": "…",
      "startedAt": "2026-07-15T17:02:00Z",
      "endedAt": "2026-07-15T18:10:00Z",
      "title": "Push Day A",
      "derived": {
        "tonnageKg": 8420,
        "durationMin": 68,
        "workingSets": 18,
        "prs": [{ "lift": "Bench Press (Barbell)", "kind": "e1rm", "value": 112.5 }]
      },
      "annotation": {
        "sessionNotes": "Slept ~5h, felt flat early, warmed up into it.",
        "quality": 3,
        "focus": "push",
        "interpretation": "A grind session — the flat opening tracks the short sleep, but the top bench single still edged a PR, so drive is intact. Hold volume; don't add load next push until sleep normalizes.",
        "interpreted": true
      },
      "exercises": [
        {
          "index": 0,
          "title": "Bench Press (Barbell)",
          "exerciseTemplateId": "abc123",
          "e1rmKg": 112.5,
          "e1rmUnreliable": false,
          "sets": [
            { "index": 0, "setType": "warmup", "weightKg": 60, "reps": 8 },
            { "index": 1, "setType": "normal", "weightKg": 100, "reps": 5, "rpe": 8, "pr": false },
            { "index": 2, "setType": "normal", "weightKg": 102.5, "reps": 3, "rpe": 9, "pr": true }
          ]
        }
      ]
    },
    {
      "id": "…",
      "startedAt": "2026-07-13T16:40:00Z",
      "title": "Pull Day A",
      "derived": { "tonnageKg": 9110, "durationMin": 62, "workingSets": 20, "prs": [] },
      "annotation": { "sessionNotes": null, "quality": null, "focus": null,
                      "interpretation": null, "interpreted": false }   // ← "needs read"
    }
  ]
}
```

Dark-mode-first. Numbers in `--font-mono` tabular. PR marks use `--color-accent`; the "needs read"
marker is muted (information, not alarm). Weights shown kg with an optional lb toggle — never a
unit-string in the data.

---

## Build checklist (definition of done)

Per `CONVENTIONS §8` — the last two are the ones nothing auto-generates, so they must be in the plan:

- [ ] `src/lib/lifting/` — `schema.ts`, `repo.ts`, `types.ts`, `hevy.ts` (API client), `derive.ts`
      (e1RM / tonnage / PR helpers)
- [ ] `lifting_session`, `lifting_exercise`, `lifting_set`, `lifting_session_note` tables in
      `src/lib/db/schema.ts` + migration
- [ ] `HEVY_API_KEY` + `HEVY_WEBHOOK_TOKEN` env wired (local `.env` + Vercel); register the webhook
      subscription with Hevy (URL + `Authorization: Bearer <HEVY_WEBHOOK_TOKEN>`)
- [ ] API routes under `src/app/api/lifting/` (webhook, pull, sessions, sessions/[id], lifts/[id])
- [ ] Run the one-time backfill: `POST /api/lifting/pull` over all pages (no CSV importer)
- [ ] UI under `src/app/(app)/lifting/` + `src/components/lifting/`
- [ ] Flip the `lifting` nav chip (`AppShell.tsx`) + landing card (`Landing.tsx`) to LIVE
- [ ] **OpenAPI:** register in `scripts/build-openapi.ts` (import schemas → build `liftingSpec` → add
      `["lifting", liftingSpec]` to `fragments`), run `npm run openapi:build`, confirm
      `openapi/lifting.json` appears
- [ ] **Docs:** this file is the model; on ship update the README module list, the live-modules table
      in `docs/ARCHITECTURE.md` (add a `lifting` row; bump the count), and `docs/BACKLOG.md`
- [ ] `manage-lifting` skill (after web + API) — list un-interpreted / read / interpret / pull

## Open / deferred (for the backlog)

- **Reconciliation cron.** Explicitly declined for v1 (webhook + manual `pull`). If missed webhooks or
  Hevy-side deletes become annoying, a nightly `GET /v1/workouts` reconcile (catch missed + edited +
  deleted) is the natural add — the `catchUp` repo function already exists for it.
- **File/CSV importer.** Not built — the API returns full history, so the backfill is an API pull. It
  would only be worth building if Curtis ever needs to import workouts that predate his Hevy account
  (from another app's export); that path needs `weight_lbs→kg` / `distance_miles→m` conversion and a
  timezone-aware dedup (the export's `start_time` is local, minute-precision, no tz).
- **Hevy-side deletions.** Not propagated in v1 (see Known gap). A reconcile cron would close this.
- **Brzycki e1RM (or per-rep-range 1RM tables).** Epley chosen for v1; the formula is isolated in
  `derive.ts` so swapping/adding is a one-function change.
- **Weight-at-reps PRs** ("5RM PR"). v1 tracks max-weight + best-e1RM per lift only; richer per-rep
  PRs are a later refinement.
- **Structured interpretation history.** `interpretation` is latest-wins in v1; an append-only log of
  dated reads (to watch the read evolve across a block) was considered and deferred.
- **Bodyweight / cardio nuance.** `distanceMeters` / `durationSeconds` are stored but volume/e1RM
  assume loaded barbell-style sets. Cardio-aware derived stats are out of scope for v1.
- **Cross-module tie-in.** Lifting + weight + macros could someday share a "training day" view; not
  now.
