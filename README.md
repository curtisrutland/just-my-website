# justmy.website

A private, single-user personal-data platform. Two users, ever: **Curtis** (human) and
**Claude** (machine, via a Python skill over a token API). Everything sits behind auth —
there are no public pages and no anonymous reads.

Four modules are live: a **macro / food-intake tracker**, a **daily weight tracker**, a
**shopping list**, and a **lifting journal**. In the macro tracker, Curtis tells Claude what he ate in
vague terms ("a couple handfuls of almonds, a big chicken thigh") and Claude logs it — the whole
design is built around one principle: **be honest about fuzziness.** An estimate is never presented
with the authority of a measured fact. The weight tracker applies the same honesty from the other
side: a 7-day rolling average leads and any single morning's number stays subordinate — the trend is
the truth, not the noise. The shopping list is the plain-utility counterpoint: one grouping level
(category → item), no quantities or normalization, tuned for adding and checking off — and unlike
the others its web UI is a full editor, not just a review surface. The lifting journal is the first
**ingestion** module: workouts flow in from **Hevy** (read-only facts), and the module owns a thin
annotation layer on top — the signature is *the numbers are Hevy's; the meaning is ours*, so it reads
and interprets training rather than logging it.

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
`macro_day_tag`, `macro_target_profile`, `weight_entry`, `shopping_item`, `lifting_session`,
`lifting_exercise`, `lifting_set`, `lifting_session_note`). Each module's OpenAPI fragment is
**generated** from its Zod schemas (`openapi/macros.json`, `openapi/weight.json`, `openapi/lifting.json`), never
hand-written.

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
| [`docs/UI-CONTRACT.md`](docs/UI-CONTRACT.md) | Design tokens, component inventory, layout slots |
| [`docs/HANDOFF-CODE.md`](docs/HANDOFF-CODE.md) | Build brief for the macro module and skill |
| [`docs/HANDOFF-DESIGN.md`](docs/HANDOFF-DESIGN.md) | Brief for the visual/structural design reference |
| [`docs/weight-design-brief.md`](docs/weight-design-brief.md) | Brief that fed the weight module's visual design |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Running tracker of outstanding work + deferred decisions |

## Status

Live in production at [justmy.website](https://justmy.website). **macros**, **weight**, and
**shopping** are deployed — each with its schema, repo, token API routes, Clerk-gated UI,
generated OpenAPI fragment, and a Python skill (`manage-macros`, `manage-weight`,
`manage-shopping`). **lifting** — the fourth module and first Hevy-ingestion module — is fully
built (schema, repo, token API, UI, OpenAPI fragment, `manage-lifting` skill) and pending its
first deploy; its Hevy webhook needs `HEVY_WEBHOOK_TOKEN` set on Vercel + registered with Hevy.
Auth currently runs on the Clerk **dev** instance (the production-instance switch is backlogged).
Outstanding work and deferred decisions are tracked in [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Related

Sibling project **justmy.recipes** — this platform's conventions and nutrition numeric
contract are derived from it, so a logged food can someday resolve macros from a recipe.
