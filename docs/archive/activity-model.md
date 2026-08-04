# Activity module — data model & spec (SCOPING DRAFT)

> Status: **scoping**, pre-code. This is the agreed shape; it precedes implementation and may
> shift as we build. Everything below is decided unless marked *open*.
>
> _Revised after the shopping module shipped: shopping is now live and **uninstrumented** (so it's a
> retrofit, not a build-with), its web surface is a **full editor**, and `docs/MODULE-RUNBOOK.md`
> already exists — the sections below reflect that._

The first **horizontal** feature. Every module so far is a vertical — it owns data a user or
Claude enters, and both surfaces write to it. Activity is different: it holds no data anyone
enters, it **observes the other modules**. It is a record of *what was done*, to which module,
by whom.

Because it's cross-cutting, it can't be a standard module and it isn't pure kernel. Its shape is
a **hybrid**:

- **A kernel capture capability** — cross-cutting, owned by no module (like `auth`). It records
  every mutation as it happens.
- **A thin read module** (`src/lib/activity/`) — a normal module on the *read* side (types, repo,
  a list endpoint, a feed UI, a generated OpenAPI fragment), but with **no write surface**. Its
  writes come from the infrastructure, never from a user or from Claude.

**Core principle (matches the platform ethos):** the app is already honest about *estimation*
(macros) and *daily noise* (weight). Activity is honest about *itself* — a transparent, tamper-evident
record of every change to Curtis's data. Two integrity properties fall out of the design and are
non-negotiable:

- **Append-only.** An activity row is an immutable historical fact — stronger even than
  `macro_entry`. No PATCH, no soft-delete, no `updatedAt`, no `deletedAt`.
- **Claude cannot write its own audit trail.** There is no `manage-activity` skill and **no
  token-API write path at all** — `activity` exposes read-only `GET` only. The agent token can
  never create, edit, or remove an activity row. The record of what Claude did is not something
  Claude can touch.

---

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Grain** | Domain activity feed | Human-readable events ("logged *chicken thigh*, estimated"), not raw `POST /… → 201`. Matches the audit-trail ethos. |
| **Actor scope** | All writers, attributed | Capture every mutation from **both** surfaces and record the actor (`agent` / `primary` / `web`). The feed can filter to "just Claude"; the record is complete. |
| **What's recorded** | Mutations only | `POST` / `PATCH` / `DELETE` (create / update / upsert / soft- & hard-delete). Reads (`GET`) are not logged — they're noise in an activity feed. |
| **Capture point** | Both entry points | `withActivity` wrapper on API routes + a `logAction()` helper on the (few) web server actions. Not the repo layer — see below. |

### Why both entry points, not the repo layer

The repo is the one choke point both surfaces share, so repo-layer capture would cover everything
*by construction*. We deliberately chose **not** to, because it would force an `actor` argument
through every mutation signature (or an ambient AsyncLocalStorage context) — machinery and
implicit magic that cuts against the codebase's thin-shell, explicit-layer taste.

The asymmetry makes entry-point capture clean instead:

- **API side** — the *entire* token API is Claude. A single `withActivity` wrapper composed into
  each route (alongside `requireBearer`) covers **all** of Claude's actions automatically and
  completely.
- **Web side** — the web write surface **varies by module**: Option-A modules (macros, weight) write
  little (corrections + soft-deletes; creation is the skill path), while **shopping is a full web
  editor** — it *creates*, checks off, edits, and deletes from the UI. Either way each mutating
  server action calls an explicit `logAction()` helper after its `repo` write, with the actor
  (`web`) known right there. A full-editor module just has more call-sites than an Option-A one; the
  pattern is identical. (So the asymmetry that keeps this clean isn't "web is tiny" — it's *one
  wrapper* on the all-Claude API vs. a *per-action helper* on the web, whatever the web's size.)

The tradeoff we accept: entry-point capture is opt-in, so a *new* write path could forget it. It
is mitigated exactly the way the platform already mitigates "remember to call `requireBearer`" —
by making it a **documented convention** every module conforms to (see *Scope of work*).

---

## Capture mechanism

**`withActivity(handler)` — API routes.** A higher-order wrapper composed around a route's write
handler. After the wrapped handler returns successfully, it records one activity row from:

- **actor** — the token kind from the auth result (`agent` or `primary`).
- **request context** — method, path, status.
- **snapshot** — the response body. Because of the platform's `get`-after-`create` contract,
  **every write already returns the full persisted resource**, so the wrapper snapshots it into
  `jsonb` with zero per-route description code. (For a delete, the snapshot is a minimal descriptor:
  the id and what was removed.)
- **taxonomy** — the *snapshot* is free, but `module` and `entityType` **can't** be inferred from
  the HTTP method, so each route declares them when composing the wrapper (a one-line addition
  alongside `requireBearer`). `action` is derived: `POST`→`create` or `upsert` (201 vs 200, per §7),
  `PATCH`→`update`, and `DELETE`→`soft_delete` or `hard_delete` (from the `?hard=` param / token
  kind — both arrive as `DELETE`).

**`logAction(...)` — web server actions.** A small kernel helper the (few) mutating server actions
call after a successful `repo` write, passing `actor: 'web'`, the module/entity/action, and the
returned resource. No HTTP context (method/path/status are null for web-sourced rows).

**Both** feed a single internal `recordActivity()` in the activity repo — the only writer of
`activity_log`.

**Best-effort, never load-bearing.** Capture must never break the real action. `recordActivity`
is wrapped so a logging failure is swallowed (and surfaced to ops logging), and it runs **after**
the underlying mutation has committed. A failure to record must not fail the write it describes.

---

## Table: `activity_log`

Append-only. Note the deviation from the standard audit columns: **there is no `updatedAt` and no
`deletedAt`** — an activity row is never modified or soft-deleted.

- `id` (uuid) — primary key.
- `occurredAt` (timestamptz, default now) — the **instant** of the event. This is an event, not a
  calendar day, so it's a real timestamp (unlike the modules' calendar `date` columns).
- `actor` (text, required) — `agent` | `primary` | `web`. Who did it. `agent` is Claude; **both
  `primary` (Curtis's API key) and `web` (Curtis's session) are Curtis** — distinguished by surface,
  which is what the feed's "just Claude" filter (`actor = agent`) keys on.
- `module` (text, required) — `macros` | `weight` | `shopping` | … The module whose data changed.
- `entityType` (text, required) — e.g. `entry`, `food`, `day_tag`, `target_profile`,
  `weight_entry`. The kind of thing that changed.
- `entityId` (text, nullable) — the affected row's id, when it has one. Nullable because some
  actions are keyed by date rather than uuid (e.g. a macro day-tag). **Stored as a plain value,
  no foreign key** — the log must survive a hard-deleted entity and never cascade. It is a record
  of what happened, decoupled from whether the thing still exists.
- `action` (text, required) — `create` | `update` | `upsert` | `soft_delete` | `hard_delete`.
- `method` (text, nullable) — HTTP verb, for API-sourced rows only (`POST`/`PATCH`/`DELETE`).
- `path` (text, nullable) — request path, API-sourced only.
- `status` (integer, nullable) — response status, API-sourced only.
- `snapshot` (jsonb, nullable) — the persisted resource returned by the write (the
  `get`-after-`create` body), or a minimal descriptor for deletes. The source of the feed's
  human-readable detail.

Indexes:
- `occurredAt` (desc) — the feed's primary ordering.
- `(module, entityType, entityId)` — "the history of *this* thing".
- `actor` — filtering the feed (e.g. "just Claude").

The **human summary is derived, not stored** — the UI composes "logged *chicken thigh* (estimated)"
from `module` + `entityType` + `action` + `snapshot`, keeping with the platform's "derive, don't
store" habit. (*Open:* if per-module rendering gets fiddly, revisit storing a short `summary`
string at capture time.)

---

## Surfaces

- **Web UI** (Clerk-gated): a **read-only activity feed** under `src/app/(app)/activity/`. Reverse
  chronological, actor badges (Claude / you), module + action, human summary from the snapshot,
  relative time. Filters by module and by actor. Nav gains an `activity` entry.
- **Token API** (`/api/activity`): **read-only**. `GET /api/activity` (paginated list, standard
  `{ items, limit, offset, count }` envelope, filters: `module`, `actor`, `entityId`). **No
  `POST` / `PATCH` / `DELETE` — ever.** Same two-token auth for reads; both tokens may read.
- **Skill:** **none.** By design — Claude reads and writes the *modules*, never the log about them.

---

## Scope of work — definition of done

This feature is not "add an activity module." It is **"make the platform self-recording,"** and it
is not done until tracking is universal and the conventions say so. Any implementation must:

1. **Instrument every existing module — no exceptions.** Every mutating path in **macros** and
   **weight** (all `POST`/`PATCH`/`DELETE` API routes *and* every mutating web server action) must
   record activity. A module is not "covered" until both its surfaces are wired.
2. **Retrofit the now-live `shopping` module.** Shopping has since shipped to production
   *uninstrumented* (it landed before this work), so it's a retrofit like macros and weight, not a
   ship-with: `withActivity` on its mutating API routes (`items` POST, `items/[id]` PATCH/DELETE;
   `list` is read-only) and `logAction()` in its server actions (`addItemAction` creates,
   `patchItemAction` updates/checks, `deleteItemAction` soft-deletes). Note shopping's web is a
   **full editor**, so it has real create/update/delete web paths to cover — not just corrections.
   The goal shifts from "no module *reaches* production uninstrumented" to "no module *stays*
   uninstrumented."
3. **Make tracking a standing convention for all future modules.** New modules must inherit this
   by default, the same way they inherit auth and pagination. That means updating:
   - **`docs/CONVENTIONS.md`** — the module-anatomy / kernel section gains activity capture as a
     required part of every write path (both surfaces), alongside `schema.parse` and `repo`.
   - **`AGENTS.md`** — add a non-negotiable: *every write, from either surface, records activity;
     no mutating path ships without it.*
   - **`README.md`** and **`docs/ARCHITECTURE.md`** — document the activity module and the
     capture pattern in the stack/architecture overview.
4. **Fold capture into the existing runbook + definition of done.** `docs/MODULE-RUNBOOK.md` already
   exists (the scoping interview → build order → definition of done), and `CONVENTIONS §8` already
   carries a "new-module definition of done" checklist. Add the capture steps to both — don't create
   a new doc — so a module author (human or agent) wires it every time:
   - wrap each mutating API route with `withActivity`;
   - call `logAction()` in each mutating web server action;
   - choose the correct `module` / `entityType` / `action` values;
   - confirm reads are **not** logged and the log has **no** write path.
   It must live as a followable step in the runbook / DoD, not tribal knowledge.
5. **Backfill nothing, silently drop nothing.** Activity begins at instrumentation; there is no
   retroactive history, and that's fine — but if any mutating path is intentionally left
   uninstrumented, it must be called out explicitly, not omitted quietly.

**Acceptance:** perform one mutation of each kind through **each** surface of **every** module and
confirm a correct, attributed `activity_log` row appears (and that reads produce none). The docs +
runbook updates land in the **same** change as the code.

---

## UI contract — component sketch (for the design tool)

Reuses `AppShell`, tokens, mono/tabular numbers. Nav gains an `activity` entry. New pieces:

### `ActivityFeed` — the surface
A reverse-chronological list of events. Each `ActivityRow`:
- an **actor badge** — Claude vs. you (`agent`/`primary` vs `web`), visually distinct;
- the **module** + **action** (e.g. `macros · logged`, `weight · corrected`, `macros · removed`);
- a **human summary** derived from the snapshot ("*chicken thigh* — 298 kcal, estimated");
- **relative time** ("2h ago"), exact timestamp on hover, in mono.

### Filters
By **module** (all / macros / weight / shopping / …) and by **actor** (all / Claude / you). Default:
all, newest first. The feed is calm and factual — a ledger, not a notification stream.

```jsonc
// GET /api/activity — one page
{
  "items": [
    {
      "id": "…",
      "occurredAt": "2026-07-06T13:22:04Z",
      "actor": "agent",
      "module": "macros",
      "entityType": "entry",
      "entityId": "…",
      "action": "create",
      "method": "POST", "path": "/api/macros/entries", "status": 201,
      "snapshot": { "name": "chicken thigh", "confidence": "estimated", "calories": 298, "…": "…" }
    },
    {
      "id": "…",
      "occurredAt": "2026-07-06T13:25:11Z",
      "actor": "web",
      "module": "weight",
      "entityType": "weight_entry",
      "entityId": "…",
      "action": "update",
      "method": null, "path": null, "status": null,
      "snapshot": { "measuredOn": "2026-07-06", "weight": 178.0 }
    }
  ],
  "limit": 50, "offset": 0, "count": 2
}
```

Dark-mode-first. Actor badge uses accent for Claude, a neutral tone for you. Summaries render from
the snapshot; timestamps in `--font-mono`.

---

## Open questions / deferred

- **Stored vs. derived summary.** Start derived (UI composes it). Store a `summary` string only if
  per-module rendering proves fiddly.
- **Retention / pruning.** Append-only means the table only grows. Volume is tiny (one user), so no
  pruning in v1. If ever needed, pruning is a maintenance op via the primary key / direct DB —
  never an app write path.
- **Capture completeness net.** Entry-point capture is opt-in; the convention + runbook are the
  guardrail. If drift ever bites, the fallback is repo-layer capture with an ambient actor context
  — noted, not v1.
- **Ops observability vs. this.** This is the *product* activity feed (durable, in-DB, in the UI).
  The separate backlog item "API observability — no per-request logging" is the *ops* concern
  (Vercel logs, debugging, includes reads). Related, not the same; this doc does not close that one.
