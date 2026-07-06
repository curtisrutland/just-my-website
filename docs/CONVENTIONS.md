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

- The **repo layer** (`src/lib/{module}/repo.ts`) is the only place Drizzle tables are
  touched. Both read surfaces call it. This is the "same data" guarantee.
- The **schema layer** (`src/lib/{module}/schema.ts`) is the only validator. Both write
  surfaces call it. This is the "same rules" guarantee.
- The surfaces are thin shells. If they stay thin, they cannot drift.
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

The web UI authenticates via Clerk session and never presents a bearer token; it does not
call `/api`. Clerk gates `/` entirely.

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
replaces rather than duplicates (weight `POST /entries`, one weigh-in per day; macros
`POST /day-tags`) — return `200` + `Location` instead, since the call is a set/replace, not a
fresh creation. Either way the create/upsert returns the **persisted resource** in the body,
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
- [ ] **Docs: add `docs/{module}-model.md`, update the README module list, the live-modules table
      in `docs/ARCHITECTURE.md`, and `docs/BACKLOG.md`.** If there's a design handoff, add
      `docs/{module}-design-brief.md` too.
