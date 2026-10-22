# justmy.website — platform conventions

The shared kernel. Every module conforms to this. It is deliberately small: auth,
error envelope, pagination, write-path discipline, and the nutrition numeric contract.
Everything else is per-module.

Derived from justmy.recipes, with intentional deviations marked **[DIFFERS FROM RECIPES]**.

---

## 1. Two surfaces, one data

| | Reads | Writes |
|---|---|---|
| **Web UI** (`/`, Clerk-gated) | server component → `repo` (direct DB) | server action → `schema.parse` → `repo` |
| **Token API** (`/api/**`) | route → `repo` | route → `schema.parse` → `repo` |
| **iOS app** (`ios/`) | token API `GET` | token API `POST`/`PATCH`/soft-`DELETE` |
| **Kitchen panel** (`/panel`, `/api/panel/**`) | route → module `repo` reads | check-off → `shopping` `repo` |

The iOS app is a client of the token API, not a fourth path to the data: its writes are API
writes, so they get the same `schema.parse` → `repo`. It renders what the API returns. Domain
logic it would need lives in `src/lib/{module}` and is exposed by the API, never reimplemented
in Swift (`docs/ios-app.md` §2, §7).

- The **repo layer** (`src/lib/{module}/repo.ts`) is the only place Drizzle tables are
  touched. Both read surfaces call it. This is the "same data" guarantee.
- The **schema layer** (`src/lib/{module}/schema.ts`) is the only validator. Both write
  surfaces call it. This is the "same rules" guarantee.
- The surfaces are thin shells. If they stay thin, they cannot drift.
- Surfaces are not modules. A surface may read and write any module, through that module's own
  `schema` and `repo`; how modules relate to *each other* is §9.
- **[DIFFERS FROM RECIPES]** Recipes' web UI is public and renders anonymously. Ours is
  private: the UI is Clerk-gated and there is no anonymous render path.

## 2. Auth

Two bearer tokens, checked at the `/api` boundary. **[DIFFERS FROM RECIPES]** There is no
anonymous/optional-auth mode — every API route requires a valid token.

- `JMW_API_KEY` — full access, including hard DELETE.
- `JMW_AGENT_TOKEN` — Claude's write token. Accepted for GET/POST/PATCH and soft-delete.
  **Structurally rejected for hard DELETE** (returns 401), enforced in the auth layer,
  not by caller good behavior.

Security schemes (OpenAPI):
- `bearerAuth` — either token. Used for reads and non-destructive writes.
- `primaryKey` — `JMW_API_KEY` only. Required for hard DELETE.

Scoped device tokens (documented kernel departures — never in `identify()`, so they can never
pass `bearerAuth`/`primaryKey`; each is accepted only by its named routes, and widening a list
needs a model-doc entry and a test):
- `JMW_PUBLISHER_TOKEN` — the Garmin daemon; push-only: `POST /api/rides/upload`,
  `POST /api/vitals` (`docs/rides-model.md` §2, `docs/vitals-model.md`).
- `JMW_DISPLAY_TOKEN` — the ESP32 round display; read-only: `GET /api/macros/days/{date}`
  (`docs/macro-model.md` § "Kernel departure").

DB-backed device tokens (`device_tokens`: hashed, scoped, individually revocable, minted on
`/settings/devices` or by `npm run panel:token`):
- The kitchen panel and the recipes sender: `/api/panel/**` only, which also accepts a Clerk
  session (`docs/panel-contract.md` §3).
- The iOS app: module routes, via `requireScope(request, "{module}:read|write")`, on exactly the
  allowlist in `docs/ios-app.md` §3.4 (v1) and §6.1 (phase 2). Never in `identify()`, so a
  device token never passes `bearerAuth`/`primaryKey`. Hard DELETE (`?hard=true`) stays on
  `requirePrimary`, so a device token can only soft-delete. OpenAPI marks these operations
  with the `deviceToken` scheme.

The web UI authenticates via Clerk session and never presents a bearer token; it does not
call `/api`. Clerk gates `/` entirely. The iOS app never talks to Clerk; its only credential is
its device token.

## 3. Error envelope

Identical to recipes. Every error response is:

```json
{ "error": { "code": "...", "message": "...", "details": { } } }
```

Code vocabulary:
- `validation_error` — 400. Document failed schema validation. `details` maps
  field-path → messages.
- `invalid_json` — 400. Request body was not parseable JSON.
- `unauthorized` — 401. Missing/invalid token, or agent token attempting a primary-only op.
- `not_found` — 404.

## 4. Pagination

List endpoints return:

```json
{ "items": [ ], "limit": 50, "offset": 0, "count": 0 }
```

- `count` = total matching the filters, ignoring limit/offset ("N of count").
- `limit` default 50, min 1, max 100. `offset` default 0, min 0.
- **[DIFFERS FROM RECIPES]** Recipes names the array `recipes`; the kernel standardizes on
  `items` so pagination handling is module-agnostic. Modules may add a typed alias in their
  own OpenAPI if desired, but the canonical key is `items`.

## 5. Write-path discipline

- **PATCH is the default modify verb.** Partial update; only supplied fields change.
  **[DIFFERS FROM RECIPES]** Recipes uses full-replace PUT because a recipe is a wholesale
  document. Entry-style data (a food-log entry, a shopping-list item) is append-heavy and
  correction-light, so PATCH is correct and PUT-replace is not offered unless a module is
  genuinely document-shaped.
- **Soft-delete is the default removal.** A `deletedAt` timestamp (nullable) marks removed
  rows; reads exclude them by default. Hard DELETE physically removes and requires
  `JMW_API_KEY`. The agent token can soft-delete but never hard-delete.
- **[DIFFERS FROM RECIPES]** No `visibility: public|draft` field. Nothing is public, so
  there is nothing to toggle. Data is either present (`deletedAt` null) or soft-deleted.

## 6. Nutrition numeric contract

Shared with justmy.recipes so a logged food can resolve macros from a recipe someday.

- Mass macros (protein, fat, carbs, fiber, sugar, saturated fat, sodium): **grams**, as
  **numbers**. Energy: **kcal**, as a **number**.
- Field names match schema.org NutritionInformation exactly: `calories`,
  `proteinContent`, `fatContent`, `carbohydrateContent`, `fiberContent`, `sugarContent`,
  `sodiumContent`, `saturatedFatContent`.
- Unit-strings ("22 g") are rejected on write. Units are a *display* concern, added by the
  UI, never stored.

## 7. `get`-after-`create` contract

Preserved from recipes practice: a first-class **create** returns `201` with a `Location`
header and the full created resource body. Idempotent **upsert** endpoints — where re-sending
replaces rather than duplicates (weight `POST /entries`, one weigh-in per day) — return `200`
+ `Location` instead, since the call is a set/replace, not a fresh creation. Either way the create/upsert returns the **persisted resource** in the body,
so a read-back is unnecessary for confirmation yet always consistent if performed. The kernel
does not enforce the status code in code; each route picks `created()` (201) or `ok()` (200)
to match its semantics.

## 8. Module anatomy

```
src/lib/{module}/
  schema.ts     # Zod + normalization — single source of truth
  repo.ts       # Drizzle queries — only place tables are touched
  types.ts      # domain + response-contract types (shared by repo AND UI)
src/components/{module}/**  # module-specific UI components
src/app/api/{module}/**     # token API routes (thin)
src/app/(app)/{module}/**   # Clerk-gated UI pages (thin)
openapi/{module}.json       # generated OpenAPI fragment (build artifact, from schema.ts)
```

Tables live in `src/lib/db/schema.ts`, namespaced by module (e.g. `macroFood`,
`macroEntry`, `macroTargetProfile`, `weightEntry`).

**Module kinds.** A module is a **logging** module (owns facts) or an **interpretive** module
(owns reads about other modules' facts). The kind decides what it may depend on — §9.

**Shared (cross-module), owned by no single module:** app-shell chrome lives in
`src/components/shell/` (`AppShell` = nav rail + terminal header + content slot; `ThemeToggle`);
pure utilities live in `src/lib/` (e.g. `date.ts`). The dependency rule is one-directional —
**UI may import from `lib`, never the reverse** — so anything `lib` needs (domain types, date
math) belongs in `lib`, not `components`.

### New-module definition of done

> The full workflow for adding a module — including the scoping **interview** Claude runs with
> Curtis before any code — is `docs/MODULE-RUNBOOK.md`. This section is just its final gate.

A module is not "done" when its code compiles — it's done when it's **wired into everything a
module is supposed to touch.** The last two items below are the ones nothing auto-generates, so
they get silently skipped (the weight OpenAPI fragment was missed exactly this way). Every new
module plan MUST include them:

- [ ] `schema.ts`, `repo.ts`, `types.ts`, tables in `src/lib/db/schema.ts` (+ migration)
- [ ] API routes under `src/app/api/{module}/` and UI under `src/app/(app)/{module}/`
- [ ] Nav entry (`AppShell.tsx`) + landing card (`Landing.tsx`) flipped to LIVE
- [ ] **OpenAPI: register in `scripts/build-openapi.ts`.** Owning a `schema.ts` does NOT
      auto-emit a fragment. You must (1) import the module's Zod schemas, (2) build a
      `{module}Spec` object, and (3) add `["{module}", {module}Spec]` to the `fragments`
      array. Then `npm run openapi:build` emits `openapi/{module}.json` (it also runs as
      `prebuild` on every `npm run build`). Verify the file appears.
- [ ] **Docs: add `docs/{module}-model.md`, update the README module list and the live-modules
      table in `docs/ARCHITECTURE.md`; close the module's GitHub Issue(s) and file new issues
      for anything deferred.** If there's a design handoff, add `docs/{module}-design-brief.md`
      too (archive it to `docs/archive/` once shipped).
- [ ] **Skill wiring: register the skill in `scripts/build-skills.mjs`.** If the module is
      **health-related** (see §9), also add its numbers to `manage-health`'s daily/weekly views
      and add the sibling cross-reference section to the other health skills' `SKILL.md`s.

## 9. Module dependencies — logging modules stand alone, interpretive modules read them

A module is one of two kinds:

- **Logging modules** own facts. Each records something (what was eaten, a weigh-in, a ride
  file, a night's sleep, a shopping line) and answers reads about it. Today: macros, weight,
  shopping, lifting, rides, vitals (and garage, when it lands).
- **Interpretive modules** own reads *about* other modules' facts: a ride interpreted with the
  night's sleep and the training goal in view, a daily health summary. They have no facts of their
  own. None exists server-side yet; `manage-health` is the skill-layer one (below).

Surfaces (web UI, token API, iOS app, kitchen panel — §1) are neither. A surface reads and writes
any module, always through that module's own `schema` and `repo`.

**The rule: a logging module never relies on another module to do its job. An interpretive module
may read across logging modules — that is what it is for.** Under five limits:

1. **One direction.** Interpretive → logging; never logging → interpretive, never logging →
   logging. Every logging module keeps working with every interpretive module deleted. An
   interpretive module doesn't read another interpretive module either: the graph stays two
   layers deep until a real need says otherwise.
2. **Read through the contract.** An interpretive module reads a logging module only through that
   module's repo **read** functions, receiving its response views — the Zod views in
   `src/lib/{module}/schema.ts` that the OpenAPI spec and the response contract test
   (`src/lib/http/contract.test.ts`) are built from. From the skill layer, the same reads come over
   the token API. Never another module's tables, Drizzle schema, or private helpers.
3. **Own the output; no cross-module writes.** An interpretive module writes only its own tables,
   keyed to its subject (e.g. `{ module: "rides", id }`). It never writes into a logging module —
   not through that module's repo, not through its API. A logging module's own annotations
   (lifting's `interpretation`, a ride's `note`) stay that module's fields, written through its
   own path.
4. **Degrade, don't fail.** A missing input (no vitals row for the night, a module with no data
   yet, a module that errors) narrows an interpretation; it never fails it. The output says what
   it didn't have.
5. **Interpret, never score.** Prose reads are the point. New cross-module *numbers* are not: no
   derived cross-module metrics, no readiness or load scores, no renamed fields. Any number an
   interpretation quotes is a module's own, under its own name. The only additive structured
   layer is factual absence (`gaps`), stated as observation, never judgment.

**What "rely on" means — the garage test.** A logging module may *copy facts in* from another
module through its own write path, attributed and snapshotted at write time: garage copying a
ride's moving time into its usage ledger is fine. It may not *query another module live* to answer
its own reads: garage computing hours by reading rides at request time is not. Copied-in facts
leave it self-sufficient; a live query makes it dependent.

**Notifications aren't dependencies.** A logging module may fire a change signal that never
affects its own result. The macros, weight and shopping repos call the panel's fire-and-forget
`bump()` after writes (`src/lib/panel/version.ts`); a failed bump is a no-op and the write
stands. That is the only allowed logging → consumer call, and it stays fire-and-forget.

### The skill layer

Each module's skill (`skills/manage-{module}/`) is a standalone Python-stdlib client over the
token API — the agent's surface for that module. Skills follow the module boundary: one module,
one skill, the module's own field names verbatim (no aliases, no per-skill renaming). A module's
own skill may read a sibling module's API to inform writes **to its own module** (garage reading
rides to attribute hours) — limit 3 still holds: it writes only its own module.

**`manage-health` is the skill-layer interpretive module.** It composes the logging modules'
token-API **read** endpoints into a unified daily/weekly view, under the limits above: read-only
(writes stay in the per-module skills, which own the write prose — confidence, normalization,
correction semantics), assemble-never-invent (every number is a module's own number under its own
field name), and `gaps` as the only additive layer (nothing logged, nothing pending-interpreted).

**Health-related** means it describes Curtis's body, training, or intake — today: macros,
weight, lifting, rides, vitals. Convenience modules (shopping) are out. A new health module joins
`manage-health`'s daily/weekly views, and every health skill's `SKILL.md` carries a short
"other health skills" section nudging toward its siblings — the skills are separate tools, but
they should know they're a set.
