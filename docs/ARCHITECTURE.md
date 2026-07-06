# justmy.website — architecture & project overview

A tour of what this repo is, the stack it runs on, and the one structural idea it keeps
repeating: the **module / API / skill** pattern. Written for a developer who has *not*
worked with this particular set of tools before — every unfamiliar piece is introduced
before it is relied on.

If you want the binding rules rather than the narrative, read
[`CONVENTIONS.md`](CONVENTIONS.md) (the platform kernel) and [`AGENTS.md`](../AGENTS.md)
(the non-negotiables). This document is the *why* and the *shape*; those are the *law*.

---

## 1. What this is

**justmy.website** is a private, single-user personal-data platform. It has exactly two
users, forever:

- **Curtis** — the human. He reads and corrects data through a web UI.
- **Claude** — the machine. It *writes* most of the data, over an HTTP API, driven by a
  natural-language conversation ("I had a couple handfuls of almonds and a big chicken
  thigh").

Everything sits behind authentication. There are **no public pages and no anonymous
reads** — this is not a product with a signup funnel, it is one person's data with a
second, machine-shaped door into it.

Two feature modules are live today:

| Module | What it stores | The honesty principle it encodes |
|---|---|---|
| **macros** | Food-intake log + calorie/macro targets | An estimate is never dressed up as a measured fact. Every entry carries a `confidence` and (for estimates) a `note` explaining the guess. |
| **weight** | One body-weight measurement per day | A single day's number is noise; the **7-day rolling average is the truth.** The trend leads, the raw weigh-in is subordinate. |

Those two "honesty" principles aren't decoration — they're the reason the data model
looks the way it does (snapshotted macros, a derived-not-stored rolling average). Keep
them in mind; they explain a lot of the design.

---

## 2. The stack (for someone new to it)

Every dependency below is load-bearing. Here's what each one is and the job it does here.

### Next.js 16 — the framework (App Router)
A React framework that runs code on **both the server and the client**. This repo uses the
**App Router**, where the folder structure under `src/app/` *is* the routing table, and
where three concepts matter:

- **Server Components** — React components that run only on the server. They can talk to
  the database directly and send finished HTML to the browser. No API round-trip, no
  client-side data-fetching library. Most of the web UI is server components.
- **Server Actions** — server-side functions (marked `"use server"`) that the browser can
  call like a form handler. This is how the web UI *writes* without exposing an API to the
  client. See `src/app/(app)/weight/actions.ts` for a clean example.
- **Route Handlers** — plain HTTP endpoints (`route.ts` files under `src/app/api/`). This
  is the token API that Claude talks to.

> ⚠️ **This is not the Next.js in your training data.** Next 16 has breaking changes — for
> example, middleware is now called **`proxy`** (`src/proxy.ts`), and it runs on the
> Node.js runtime. When in doubt, read the vendored guides under
> `node_modules/next/dist/docs/` rather than trusting memory. `AGENTS.md` says this in
> bold for a reason.

### Neon + Drizzle ORM — the database layer
- **Neon** is serverless Postgres. It speaks HTTP, so it works from Vercel's serverless
  functions without a long-lived connection pool. The connection is a `DATABASE_URL`
  injected by the Neon–Vercel integration.
- **Drizzle** is a TypeScript ORM where the schema is *code* (`src/lib/db/schema.ts`), and
  the table types flow into the rest of the app via `$inferSelect` / `$inferInsert`. You
  write queries in a typed builder (`db.select().from(weightEntry).where(...)`) rather than
  raw SQL strings. `drizzle-kit` generates/applies migrations (`npm run db:generate` /
  `db:migrate`) or pushes the schema straight to the DB in dev (`db:push`).

### Clerk — auth for the *web* only
Clerk is a hosted authentication provider. It gates the entire web UI: `src/proxy.ts` wraps
the app in `clerkMiddleware` and calls `auth.protect()` on every non-public route. Crucially,
Clerk **only** guards the human surface — the token API is deliberately excluded from the
Clerk matcher and authenticates itself (more on that below).

### Zod 4 — validation and the source of truth
Zod is a schema/validation library. A Zod schema (e.g. `weightCreateSchema`) both **validates**
incoming data at runtime and **produces the TypeScript type** (`z.infer<...>`). In this repo a
module's `schema.ts` is the *single source of truth*: the DB columns, the API's OpenAPI spec, and
both write paths all trace back to it.

### Tailwind 4 — styling
Utility-first CSS. Version 4 is CSS-first (`@theme` blocks in `globals.css` rather than a JS
config). The UI is dark-mode-first with a terminal aesthetic. Design details live in
[`UI-CONTRACT.md`](UI-CONTRACT.md); you don't need them to understand the architecture.

### Vercel — hosting
Deploys the Next app and runs the API routes as serverless functions. `vercel env pull`
populates `.env.local` for local dev. Production is live at
[justmy.website](https://justmy.website).

### The Skill + a Python client — Claude's door
A **Skill** is a folder Claude loads (a `SKILL.md` instruction file plus a `client.py`) that
teaches it *how and when* to use a tool. Here, the skill wraps the token API in a tiny Python
client so Claude can log food or weight by calling `m.log_entry(...)` / `w.log_weight(...)`
instead of hand-rolling HTTP. This is covered in depth in §4.

**One-line mental model:** Next 16 on Vercel serves both a Clerk-gated **web UI** and a
token-authenticated **HTTP API**; both read and write the same Neon/Postgres database through
one Drizzle **repo** layer and one Zod **schema** layer; Claude reaches the API through a
**skill**.

---

## 3. The core idea: two surfaces, one data

Everything in this repo is organized around a single rule, and understanding it makes the rest
obvious:

> **There are two surfaces onto the data. They may differ in how they *read*. They must be
> identical in how they *write*.**

| | Reads | Writes |
|---|---|---|
| **Web UI** (`/`, Clerk-gated) | server component → `repo` (direct DB) | server action → `schema.parse()` → `repo` |
| **Token API** (`/api/**`, machine-only) | route handler → `repo` | route handler → `schema.parse()` → `repo` |

Two layers make this guarantee real, and they are the *only* two shared choke points:

- **The repo layer** (`src/lib/{module}/repo.ts`) is the **only** place Drizzle tables are
  touched. Both read surfaces go through it. That's the "same data" guarantee — there is no
  second, subtly-different query path.
- **The schema layer** (`src/lib/{module}/schema.ts`) is the **only** validator. Both write
  surfaces call `schema.parse()` before the repo. That's the "same rules" guarantee — you
  cannot write data that skipped validation, no matter which door you came through.

The surfaces themselves are **thin shells**. A route handler (`src/app/api/weight/entries/route.ts`)
is ~25 lines: check the token, parse the body, call the repo, format the response. A server
action is similarly thin. Because the shells are thin, they can't drift apart — all the real
logic lives in the two shared layers.

Why two surfaces at all? Because the two *users* are shaped differently. Curtis wants to
review and correct in a browser; a browser session (Clerk) is the natural auth for that, and
server components let the UI read the DB with zero API surface exposed to the client. Claude
wants to write from a conversation; a bearer token over HTTP is the natural interface for
that. Forcing both through one interface would compromise one of them. Splitting the
*surfaces* while sharing the *data and rules* gives each user the right ergonomics without
letting the two diverge into two codebases.

### Auth, concretely

The API is **token-only, always** (`src/lib/auth/tokens.ts`). Two bearer tokens:

- `JMW_API_KEY` — "primary": full access, including hard `DELETE`.
- `JMW_AGENT_TOKEN` — "agent": Claude's token. Good for `GET` / `POST` / `PATCH` /
  soft-delete, but **structurally rejected for hard `DELETE`** in the auth layer itself
  (returns 401) — not by asking the caller to behave. Claude can take data *down*
  (soft-delete sets a `deletedAt` timestamp; reads exclude it), but it can never physically
  destroy a row.

The web UI never presents a token; it authenticates via Clerk session and never calls
`/api`. The two auth mechanisms never cross: Clerk guards `/`, tokens guard `/api`, and
`src/proxy.ts` keeps the API out of the Clerk matcher so a session cookie can never
accidentally authorize an API call.

---

## 4. The module / API / skill pattern

This is the pattern the title promised. A **module** is a vertical, self-contained slice of
the platform. Adding a feature means adding a module, not threading changes through a dozen
shared files. Every module owns the same set of pieces:

```
src/lib/{module}/
  schema.ts     # Zod schema + normalization — the single source of truth
  repo.ts       # Drizzle queries — the ONLY place this module's tables are touched
  types.ts      # domain + response types (shared by repo AND UI)
src/lib/db/schema.ts        # the module's tables, namespaced (weight_entry, macro_food, …)
src/app/api/{module}/**     # token API route handlers (thin)
src/app/(app)/{module}/**   # Clerk-gated UI pages + server actions (thin)
src/components/{module}/**  # module-specific UI components
openapi/{module}.json       # OpenAPI fragment — GENERATED from schema.ts, never hand-written
skills/manage-{module}/     # SKILL.md + client.py — Claude's door to this module's API
```

The `weight` module is the smallest complete example; trace it end to end to see the whole
pattern:

1. **`src/lib/db/schema.ts`** declares `weight_entry` (one row per day, with the shared
   `id / createdAt / updatedAt / deletedAt` audit columns and a partial-unique index that
   enforces "one *live* weight per day").
2. **`src/lib/weight/schema.ts`** declares `weightCreateSchema` / `weightPatchSchema` in Zod.
   Weight is a positive finite number; the date is a strict `YYYY-MM-DD` calendar date. The
   patch schema is literally `createSchema.partial()` — that's how `PATCH` semantics ("only
   supplied fields change") fall out for free.
3. **`src/lib/weight/repo.ts`** is the only file that queries `weight_entry`. It also derives
   the trend (the 7-day rolling average and least-squares slope) here — the average is
   **computed on read, never stored**, because storing it would be a second source of truth
   that could drift from the raw weigh-ins.
4. **`src/app/api/weight/entries/route.ts`** is the token surface: `requireBearer` → `parseJson`
   with the Zod schema → `repo`. ~25 lines.
5. **`src/app/(app)/weight/`** is the web surface: a server component page reading through the
   repo, plus `actions.ts` server actions (Clerk-gated) that `schema.parse()` → `repo`.
6. **`openapi/weight.json`** is generated from the Zod schemas by `scripts/build-openapi.ts`.
7. **`skills/manage-weight/`** is Claude's door.

### Why generate the OpenAPI spec instead of writing it?

`scripts/build-openapi.ts` reads the Zod schemas and emits one OpenAPI fragment per module
(`z.toJSONSchema(...)`). It runs automatically before every build (`prebuild`). The rule is:
**`schema.ts` is the source of truth; the spec is downstream of it.** A hand-written spec is a
second description of the same shapes that rots the moment the schema changes. Generating it
means the documented API and the enforced API cannot disagree — the disagreement is impossible
to express. (The doc audit in `BACKLOG.md` caught exactly this: the weight module existed but
wasn't wired into the generator, so the "per-module fragment" convention was quietly untrue
until it was fixed.)

### Why a skill, and what is it?

The **skill** is what makes Claude a first-class writer instead of an afterthought. It has two
parts:

- **`SKILL.md`** — a natural-language instruction file with a structured `description` that
  tells Claude *when* to reach for the tool ("whenever Curtis says what he ate…") and *how* to
  behave (parse the food, get real numbers from USDA when possible, log with an honest
  `confidence` and a `note`). It encodes the product's *values*, not just its API. The
  macro skill's whole job is to be **honest about fuzziness**, and the SKILL.md is where that
  is taught.
- **`client.py`** — a thin Python wrapper over the token API. It is deliberately built on the
  **Python standard library only** (`urllib`, no `httpx`/`requests`) so it runs anywhere Claude
  runs with zero `pip install`. The base URL and agent token are injected at build time by
  `scripts/build-skills.mjs`, which replaces `__JMW_BASE_URL__` / `__JMW_AGENT_TOKEN__`
  placeholders and zips the result under `skills/dist/` (git-ignored, because it contains the
  secret).

So the flow for "I had a chicken thigh" is: Claude reads the conversation → the `manage-macros`
skill fires → it optionally looks the food up in USDA FoodData Central, scales the macros,
picks a `confidence`, writes a `note` → `client.py` `POST`s to `/api/macros/entries` with the
agent token → the same Zod schema and repo that the web UI would use persist the row. The
estimate lands in the exact same place, validated by the exact same rules, as anything Curtis
could enter himself.

**Why this three-part shape (API + skill + web) is the right call:** the token API is a stable,
validated, machine contract; the skill is a *replaceable, values-carrying* adapter that turns
fuzzy human language into calls against that contract; and the web UI is a review/correction
surface for the human. The skill can be rewritten, retuned, or swapped without touching the
data model, because it only ever speaks the same HTTP the web UI's rules are built on. The API
never has to know it's talking to an LLM. The database never has to know a request came from a
conversation.

---

## 5. Conventions that repeat across every module

These live in [`CONVENTIONS.md`](CONVENTIONS.md) as the enforced kernel. In brief, so you
recognize them when you see them:

- **Error envelope.** Every error is `{ "error": { "code", "message", "details" } }` with a
  small fixed vocabulary (`validation_error`, `invalid_json`, `unauthorized`, `not_found`).
- **Pagination shape.** List endpoints return `{ items, limit, offset, count }` — always
  `items`, so pagination handling is module-agnostic. `count` is the total ignoring
  limit/offset.
- **PATCH is the default modify verb; soft-delete is the default removal.** Full-replace `PUT`
  is only for genuinely document-shaped modules (there are none yet). Entry-style data is
  append-heavy and correction-light, so partial `PATCH` + a nullable `deletedAt` is the right
  model.
- **Nutrition is numbers, not strings.** Macros are grams and calories are kcal, always as
  numbers, with field names matching schema.org `NutritionInformation`
  (`proteinContent`, `carbohydrateContent`, …). This is deliberate: it lets the data interop
  with the sibling project **justmy.recipes**, so a logged food could someday resolve its
  macros from a recipe. Unit-strings like `"22 g"` are rejected on write — units are a display
  concern the UI adds, never something stored.
- **`get`-after-`create`.** A true create returns `201` + `Location` + the full created
  resource. Idempotent upserts (one weigh-in per day; a day's macro target) return `200` +
  `Location`, because re-sending replaces rather than duplicates. Either way the body is the
  persisted resource, so a read-back is never required for confirmation.
- **One-directional layering.** UI imports from `lib`; `lib` never imports from UI. Anything
  `lib` needs (domain types, date math) lives in `lib`. The shared "kernel" is intentionally
  tiny — auth, the error/pagination helpers under `src/lib/http/`, the app-shell chrome in
  `src/components/shell/`, and the pure `src/lib/date.ts`. Nothing else is "platform"; the rest
  is per-module.

A worked detail that shows the philosophy: **calendar dates are stored as Postgres `date` in
string mode**, never as timestamps. A weigh-in or a food-log entry happens on a *local day*, not
at an instant, and pulling it into JavaScript `Date` math would drag in a timezone the data
doesn't have. Storing and returning a plain `'YYYY-MM-DD'` string keeps the whole class of
timezone bugs off the table. (One such bug — "today" resolving in UTC in production — did occur
and is documented as fixed in `BACKLOG.md`; the fix computes the local date via `Intl` with
`America/Chicago`.)

---

## 6. The overall picture — what's been built

Read top-to-bottom, here is the system as it stands:

- **Infrastructure** is provisioned and live: Neon Postgres, Clerk auth, the two API tokens,
  and a USDA FoodData Central API key, all deployed to Vercel production at
  [justmy.website](https://justmy.website).
- **A small shared kernel** carries auth (`src/lib/auth/`), the HTTP helpers
  (`src/lib/http/` — error envelope, pagination, param parsing, success responses), the pure
  date utility (`src/lib/date.ts`), and the app-shell chrome (`src/components/shell/`). By
  design it stays small.
- **Two complete modules**, each a full vertical slice (schema → repo → token API → Clerk-gated
  UI → generated OpenAPI fragment → Python skill):
  - **macros** — food/macro logging with USDA lookups (foods cache into `macro_food` on first
    resolve), calorie-cycling `training`/`rest` targets that are *dated* (change the profile
    once and all days of that kind follow), a day-rollup that reports totals against target(s)
    and an honest "estimation %", and a `manage-macros` skill.
  - **weight** — one weigh-in per day, a derived 7-day rolling-average trend with a
    least-squares slope in lb/week, and a `manage-weight` skill.
- **Build tooling** that keeps the conventions true rather than aspirational:
  `scripts/build-openapi.ts` (spec generated from Zod, runs on every build) and
  `scripts/build-skills.mjs` (token-injected, zero-dependency skill bundles).
- **A test suite** (Vitest) covering the load-bearing logic: token auth, schema
  normalization, the macro day-rollup, the weight repo/rollup math, and the USDA client.

The **macro tracker** and **weight tracker** are two halves of the same idea from opposite
directions — one refuses to present an *estimate* as fact, the other refuses to present a
single day's *measurement* as a trend. That shared insistence on being honest about
uncertainty is the through-line of everything built here, and it is why the data model, not
just the UI, is shaped the way it is.

### Known status & what's next
Tracked in full in [`BACKLOG.md`](BACKLOG.md). The headline open items: auth currently runs on
the Clerk **dev** instance (the production-instance switch is configured but deferred to a real
domain activation step), and the `manage-macros` skill zip awaits a re-upload/publish step on
claude.ai. A short list of design refinements and optional tech-debt items (Vercel analytics,
per-request API logging) is deferred, not lost.

---

## 7. Where to look next

| You want… | Read |
|---|---|
| The enforced rules (auth, errors, pagination, write-path, nutrition contract) | [`CONVENTIONS.md`](CONVENTIONS.md) |
| The rules for *agents* working in this repo | [`AGENTS.md`](../AGENTS.md) |
| The macro module's closed data-model spec | [`macro-model.md`](macro-model.md) |
| The weight module's data model + trend math | [`weight-model.md`](weight-model.md) |
| Design tokens, component inventory, layout | [`UI-CONTRACT.md`](UI-CONTRACT.md) |
| Outstanding work & deferred decisions | [`BACKLOG.md`](BACKLOG.md) |
| Setup & scripts | [`../README.md`](../README.md) |
| A concrete, minimal module to trace end-to-end | `src/lib/weight/` + `src/app/api/weight/` + `src/app/(app)/weight/` |
