# justmy.website

A private, single-user personal-data platform. Two users, ever: **Curtis** (human) and
**Claude** (machine, via a Python skill over a token API). Everything sits behind auth —
there are no public pages and no anonymous reads.

Five modules are live: a **macro / food-intake tracker**, a **daily weight tracker**, a
**shopping list**, a **lifting journal**, and a **ride log**. In the macro tracker, Curtis tells Claude what he ate in
vague terms ("a couple handfuls of almonds, a big chicken thigh") and Claude logs it — the whole
design is built around one principle: **be honest about fuzziness.** An estimate is never presented
with the authority of a measured fact. The weight tracker applies the same honesty from the other
side: a 7-day rolling average leads and any single morning's number stays subordinate — the trend is
the truth, not the noise. The shopping list is the plain-utility counterpoint: one grouping level
(category → item), no quantities or normalization, tuned for adding and checking off — and unlike
the others its web UI is a full editor, not just a review surface. The lifting journal is the first
**ingestion** module: workouts flow in from **Hevy** (read-only facts), and the module owns a thin
annotation layer on top — the signature is *the numbers are Hevy's; the meaning is ours*, so it reads
and interprets training rather than logging it. The ride log ingests **Garmin FIT files** (the
second ingestion module, and the first with a binary input): the signature is *the log is the
value* — the meter's numbers, honestly kept, with no fitness scores, no streaks, and exactly two
human-writable fields (a ride's name and note).

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions) on **Vercel**
- **Neon** serverless Postgres via **Drizzle ORM** (serverless HTTP driver)
- **Clerk** for the web UI's auth gate
- **Zod 4** for validation (single source of truth per module)
- **Tailwind 4** (CSS-first `@theme`), dark-mode-first

## Architecture

Two surfaces, one data. See [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for the binding spec.

| Surface | Reads | Writes |
|---|---|---|
| **Web UI** (`/`, Clerk-gated) | server component → `repo` (direct DB) | server action → `schema.parse` → `repo` |
| **Token API** (`/api/**`, machine-only) | route → `repo` | route → `schema.parse` → `repo` |

- **Surfaces differ on READ, never on WRITE.** Every write from either surface passes the
  same `schema.parse()` then the same `repo` function. No write path skips validation.
- **The API is token-only, always** — no anonymous reads, no session-cookie path. Two
  bearer tokens: `JMW_API_KEY` (full access) and `JMW_AGENT_TOKEN` (Claude's — structurally
  barred from hard `DELETE` in the auth layer). Removal is soft-delete by default.
- **The web UI never calls the API.** It reads and writes the database directly through the
  repo layer.

### Module anatomy

Each module is self-contained under `src/lib/{module}/`:

```
src/lib/{module}/
  schema.ts     # Zod + normalization — single source of truth
  repo.ts       # Drizzle queries — the only place tables are touched
src/app/api/{module}/**    # token API routes (thin)
src/app/(app)/{module}/**  # Clerk-gated UI (thin)
```

Tables live in `src/lib/db/schema.ts`, namespaced by module (`macro_food`, `macro_entry`,
`macro_day_tag` (retired — history only), `macro_target_profile`, `weight_entry`, `shopping_item`, `lifting_session`,
`lifting_exercise`, `lifting_set`, `lifting_session_note`, `lifting_goal`, `ride`, `ride_stream`).
Each module's OpenAPI fragment is **generated** from its Zod schemas (`openapi/macros.json`,
`openapi/weight.json`, `openapi/lifting.json`, `openapi/rides.json`), never hand-written.

## Getting started

Requires Node 20+ and the [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`).

```bash
npm install
vercel link                     # link to the Vercel project
vercel env pull .env.local      # pull DATABASE_URL, Clerk keys, JMW_* tokens, USDA key
npm run db:push                 # sync the Drizzle schema to Neon
npm run dev                     # http://localhost:3000
```

### Environment

`.env.local` is git-ignored and populated by `vercel env pull`. The managed values
(`DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) are injected by
the Neon and Clerk Marketplace integrations. The rest:

| Variable | Purpose |
|---|---|
| `JMW_API_KEY` | Full-access API token (incl. hard delete) |
| `JMW_AGENT_TOKEN` | Claude's token — barred from hard delete |
| `USDA_FDC_API_KEY` | FoodData Central lookups (foods cache into `macro_food` on first resolve) |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (regenerates the OpenAPI fragments first) |
| `npm run test` | Vitest |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema straight to the database (dev) |
| `npm run db:seed` | Seed dev/sample data |
| `npm run db:studio` | Drizzle Studio |
| `npm run openapi:build` | Generate the per-module OpenAPI fragments from the Zod schemas |
| `npm run skills:build` | Build the Claude skill(s) with the agent token injected |

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Project overview for developers new to the stack — the stack, the module/API/skill pattern and its justification, and the overall picture |
| [`AGENTS.md`](AGENTS.md) | Rules for agents working in this repo |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | The platform kernel — auth, error envelope, pagination, write-path discipline, nutrition numeric contract |
| [`docs/macro-model.md`](docs/macro-model.md) | The macro module's data model (closed spec) |
| [`docs/weight-model.md`](docs/weight-model.md) | The weight module's data model + trend/rollup math |
| [`docs/lifting-model.md`](docs/lifting-model.md) | The lifting module's data model — Hevy ingestion + the annotation layer, derived e1RM/tonnage/PRs |
| [`docs/rides-model.md`](docs/rides-model.md) | The rides module's data model — FIT ingestion, the raw-file Blob store, streams, the publisher token |
| [`docs/UI-CONTRACT.md`](docs/UI-CONTRACT.md) | Design tokens, component inventory, layout slots |
| [`docs/archive/`](docs/archive/) | Historical briefs, handoffs, and the pre-issues backlog (see its README) |
| [GitHub Issues](https://github.com/curtisrutland/just-my-website/issues) | Outstanding work + deferred decisions (the tracker) |

## Status

Live in production at [justmy.website](https://justmy.website). All five modules — **macros**,
**weight**, **shopping**, **lifting**, and **rides** — are deployed, each with its schema, repo,
token API routes, Clerk-gated UI, generated OpenAPI fragment, and a Python skill
(`manage-macros`, `manage-weight`, `manage-shopping`, `manage-lifting`, `manage-rides`). A sixth
skill, **`manage-health`**, is the one sanctioned cross-cut (`docs/CONVENTIONS.md` §9): a
read-only unified daily/weekly view over the four health modules, assembled at the skill layer
from their existing read endpoints — no server-side aggregation.
Auth currently runs on the Clerk **dev** instance (the production-instance switch is an open issue).
Outstanding work and deferred decisions are tracked as
[GitHub Issues](https://github.com/curtisrutland/just-my-website/issues); the pre-issues
tracker is archived at [`docs/archive/BACKLOG.md`](docs/archive/BACKLOG.md).

## Related

Sibling project **justmy.recipes** — this platform's conventions and nutrition numeric
contract are derived from it, so a logged food can someday resolve macros from a recipe.
