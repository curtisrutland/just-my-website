<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all
differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/`
before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# justmy.website — agent rules

Private personal-data platform. One human user (Curtis), one machine user (Claude).
Everything is private behind auth; there are no public reads.

## Non-negotiable conventions (see `docs/CONVENTIONS.md` for the full spec)

- **Two surfaces, one data.** The token API (`/api/**`) is the *machine* interface only.
  The web UI (`/`) is Clerk-gated and reads/writes the database directly through the
  repo layer via server components and server actions. The UI never calls the API.
- **Surfaces differ on READ, never on WRITE.** Every write — from either surface —
  passes through the same `schema.parse()` then the same `repo` function. No write path
  skips validation.
- **API is token-only, always.** No anonymous reads, no session-cookie path on any
  `/api` route. If a request has no valid bearer token, it is rejected.
- **Two tokens.** `JMW_API_KEY` (full access) and `JMW_AGENT_TOKEN` (Claude's token —
  structurally rejected for hard DELETE). Take data down via soft-delete, not DELETE.
- **PATCH is the default modify verb.** Full-replace PUT is only for wholesale-document
  modules (there are none yet). Entry-style modules use POST/PATCH/soft-DELETE.
- **Nutrition numbers, not strings.** Mass macros in grams, energy in kcal, always
  numbers. Field names match schema.org NutritionInformation (`proteinContent`,
  `carbohydrateContent`, `fatContent`, `calories`, …) so data is shared with justmy.recipes.
- **OpenAPI per module is generated from Zod, not hand-written.** `schema.ts` is the
  single source of truth; the spec and any client are downstream of it.

## Module anatomy

Every module lives in `src/lib/{module}/` and owns:
- `schema.ts` — Zod schema + normalization. Single source of truth.
- `repo.ts` — Drizzle queries. The only place tables are touched.
- its own tables in `src/lib/db/schema.ts`
- its API routes under `src/app/api/{module}/`
- its UI under `src/app/(app)/{module}/`
- its generated OpenAPI fragment

Modules are self-contained. The shared kernel is small on purpose: auth, the error
envelope, pagination shape, the app-shell chrome (`src/components/shell/`), the pure date
utility (`src/lib/date.ts`), and these conventions. Nothing else is "platform." The layering
rule is one-directional: UI imports from `lib`, never the reverse — so a module's domain types
live in `src/lib/{module}/types.ts`, not in its components.
