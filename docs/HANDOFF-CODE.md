# Handoff → Claude Code

## What this is
Build `justmy.website` — a private, single-user personal-data platform (Next.js 16 on
Vercel, Neon Postgres, Drizzle, Clerk, Zod). One human user (Curtis), one machine user
(Claude, via a Python skill over a token API). The first module is a **macro tracker**.
A scaffold already exists (this repo); your job is to complete the macro module and the
skill, following the conventions exactly.

**Repo remote:** `https://github.com/curtisrutland/just-my-website.git` — already created.
The scaffold and the `/docs` reference files are already committed; branch from them and
commit your work on top (do not re-push the scaffold as your own initial commit). Note
the repo name is `just-my-website` (matching
the `justmy.recipes`/`just-my-recipes` convention); the internal code prefix is `jmw`
(env vars `JMW_*`, tables `macro_*`) and the public/display name is `justmy.website`.

## READ FIRST, in order
1. `AGENTS.md` — including the rule that this Next.js has breaking changes vs. your
   training data; read `node_modules/next/dist/docs/` before writing Next code.
2. `docs/CONVENTIONS.md` — the platform kernel. Every rule here is binding.
3. `docs/UI-CONTRACT.md` — token names and component APIs. The UI you build conforms to
   this; Claude Design is producing a visual reference against the same contract.
4. `docs/macro-model.md` — the macro data model spec. It is CLOSED. Implement it as
   `src/lib/db/schema.ts` (Drizzle). Each decision has a reason stated in the spec. If you
   think something's wrong, flag it, don't silently change it.

## Architecture (do not deviate — see CONVENTIONS §1)
- **Two surfaces, one data.** The token API (`/api/**`) is the MACHINE interface only
  (the skill). The web UI (`/`) is Clerk-gated and reads/writes the DB directly through
  the repo layer via server components and server actions. **The UI never calls the API.**
- **Surfaces differ on READ, never on WRITE.** Every write from either surface goes
  `schema.parse()` → `repo` fn. No write path skips validation.
- **API is token-only, always.** No anonymous reads, no session path on `/api`.
- **Two tokens** (`JMW_API_KEY` full; `JMW_AGENT_TOKEN` barred from hard DELETE). Build the
  token-auth layer per CONVENTIONS §2 — the agent-token-barred-from-delete rule is enforced
  in the auth layer (a hard-DELETE route requires the primary key), not by caller behavior.

## Build order for the macro module
1. **`src/lib/macros/schema.ts`** — Zod schemas + normalization for: food, entry
   (with the `confidence` enum and load-bearing `note`), day-tag, target-profile. This
   is the single source of truth; the OpenAPI fragment is generated from it. Match the
   nutrition numeric contract (CONVENTIONS §6) — numbers, grams/kcal, schema.org names.
2. **`src/lib/macros/repo.ts`** — Drizzle queries. The ONLY place macro tables are
   touched. Must include the **day-rollup** query (see below) — the hard part.
3. **`src/app/api/macros/**`** — thin token routes: authenticate → parse → repo.
   POST/PATCH/soft-DELETE for entries, foods, day-tags, target-profiles. Hard DELETE
   requires `requirePrimary`. GET for lists (pagination shape per CONVENTIONS §4) and
   the day-rollup.
4. **`src/app/(app)/macros/**`** — Clerk-gated UI. Server components read via `repo`;
   server actions write via `schema.parse` → `repo`. Implement the UI-CONTRACT §3
   components against the Design reference once it exists; until then, build to the
   contract's mock shape.
5. **Skill + Python client** — `skills/manage-macros/` following the justmy.recipes
   pattern (SKILL.md + a thin Python client over the token API, token injected at build
   by `scripts/build-skills.mjs`). This is Claude's sole write path. The client is
   standalone Python (stdlib + httpx), executable in a sandbox from claude.ai.

## The day-rollup endpoint — the one thing the recipes template can't guide
`GET /api/macros/days/{date}` returns the shape in UI-CONTRACT §4. Logic:
- Sum the day's non-deleted entries into absolute totals.
- Compute `estimation`: fraction of calories from `confidence: "estimated"` entries.
- Resolve the day's `kind` from `macro_day_tag` (absent row → `"unspecified"`).
- Resolve target(s): find the `macro_target_profile` of the applicable kind(s) with the
  latest `effectiveFrom <= date`. **If kind is `unspecified`, return BOTH training and
  rest targets** (this drives the dual-target UI — do not collapse to one).
- Return totals, estimation, target(s), and the entries.

## USDA / food catalog (design the seam, don't over-build)
Foods resolve from USDA FoodData Central and are CACHED into `macro_food` (source
`'usda'`, `fdcId` set) so repeated logging is a local lookup, not a live API hit on the
serverless path. Custom foods (unflavored whey, specific bars) are `source: 'custom'`.
Build the cache-on-first-resolve path; a live USDA client can be a thin module the skill
or an API route calls once per new food. Do not put a live USDA call on the hot logging
path.

## Constraints
- Neon: use the serverless HTTP driver (`drizzle-orm/neon-http` + `@neondatabase/serverless`),
  never a vanilla pg Pool (serverless connection exhaustion). Read `DATABASE_URL` from env.
- Zod 4, Next 16.2.10, Drizzle 0.45, Tailwind 4 (CSS-first `@theme`). Match versions in
  `package.json`.
- Everything soft-deletes (`deletedAt`); reads exclude soft-deleted by default.
- `get`-after-`create`: creates return 201 + Location + the persisted body.

## Out of scope
Workouts (Strava/Hevy). Meal slots. Entry-level timestamps (date-keyed only). MCP server
(decided against — skill-over-token-API only). Public/sharing anything.
