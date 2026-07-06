# Shopping module — data model & spec

The third module. Same platform kernel as macros/weight (two surfaces / one data, two-token auth,
error envelope, pagination, soft-delete). Lives in `src/lib/shopping/`, its own table, its own API
under `/api/shopping/`, its own UI under `src/app/(app)/shopping/`.

**Core principle:** a shopping list is a *working* surface, not a historical record. Unlike macros
(an immutable log) or weight (a trend over noise), this module has almost no derived intelligence —
it deliberately does **not** normalize items, track quantities as data, or record spend/trends. It's
a single flat list with one grouping level, tuned for two actions done well: **adding** and
**checking off**.

**Two levels only — category → item — with no way to nest.** The table has no parent-pointer, so
nesting is impossible by construction, not by convention. `category` is a **freeform string on the
item**, not its own entity; grouping happens at read time. That is the whole point of "don't
normalize": no join, no second table, no migration risk, and a typo just makes a new (empty-ish)
group you can fix by editing the item.

**Write path differs from the other modules.** Macros is Claude-adds / web-corrects; weight is
both. Shopping is **web-primary, full editor**: adding, checking off, editing, and deleting are all
first-class web-UI actions (you edit this on your phone, in the store). Claude *also* manages the
list via the API/skill ("add taco-night ingredients"). Both surfaces write through the same
`schema.parse → repo` path. The module pattern explicitly allows per-module interactivity levels, so
this departure is intentional and consistent with the platform.

---

## Table: `shopping_item`

Conventions as every table: `id` (uuid), `createdAt`, `updatedAt`, nullable `deletedAt`
(soft-delete; reads exclude deleted).

- `category` (text, required) — a **freeform string** ("Produce", "Frozen"). Grouped and sorted
  **case-insensitively alphabetical** at read time. Not an entity, not enumerated, no fixed
  store-aisle order (alphabetical for now — order is a possible later refinement, noted below).
- `text` (text, required) — the freeform item line, **carrying its own quantity detail**
  ("2 dozen eggs", "a big thing of spinach"). There is deliberately **no quantity column**.
- `status` (text, required, default `'needed'`) — `'needed'` | `'bought'`. Stored as text; the two
  allowed values are enforced by the Zod schema (the sole validator), matching the macro module's
  `source`/`confidence`/`kind` pattern.
- `checkedAt` (timestamptz, nullable) — set to `now()` when the item is checked off
  (`needed → bought`), cleared to `null` when un-checked. Drives the "recently bought" window.

**No uniqueness constraint — on purpose.** Unlike `weight_entry` (one live weigh-in per day),
shopping items are *not* identities: "milk" can legitimately appear twice, and we don't dedupe or
normalize. So there is no unique index. This is the schema-level expression of "don't normalize
items."

### Indexes (matched to the two read shapes)

Two partial indexes, one per section of the view — each covers exactly one query and nothing else:

- `shopping_item_active_idx` — partial on `(category, text)`
  `WHERE deleted_at IS NULL AND status = 'needed'`. Serves the active-list read (grouped by
  category, ordered within group) directly from the index.
- `shopping_item_bought_idx` — partial on `(checked_at)`
  `WHERE deleted_at IS NULL AND status = 'bought'`. Serves the recently-bought read
  (`checked_at >= cutoff ORDER BY checked_at DESC`).

> Honest note: for one user the table is tens of rows — these indexes are about *encoding the access
> pattern correctly*, not chasing performance. They match the two reads the repo actually issues, and
> the partial predicates keep each index scoped to the section it serves.

---

## The view — two sections, filter-only history

The read model (`getList`, rollup-style — mirrors weight's `getRollup`) returns two sections:

1. **Active** — live rows where `status = 'needed'`, **grouped by `category`**
   (case-insensitive alphabetical), items within a group alphabetical by `text`. This is the list.
2. **Recently bought** — live rows where `status = 'bought'` **and** `checkedAt` is within the last
   **7 days**, newest-checked first. Rendered in a **pre-collapsed** section at the bottom so an
   accidental check-off is recoverable (un-check pulls it back into Active).

Bought items older than 7 days simply **fall out of the view** — a pure read-time filter on
`checkedAt`. They stay in the DB (a single user will never notice the volume); **no purge, no
cron**. If the table ever bloats, a purge can be added later without touching the model.

### Two distinct "undo" mechanisms

These were described together but are separate, and separating them keeps each simple:

1. **Persistent recent-bought section** *(data-model feature)* — the collapsed 7-day section above.
   The durable safety net: un-check any recent item to restore it.
2. **Few-second grace timer** *(client-side; v1 — designed-in)* — on check-off, the item lingers
   in place with an inline "undo" affordance and a draining progress bar for a few seconds before it
   animates down into the collapsed section. The DB write is **immediate** (check writes
   `status=bought, checkedAt=now` right away); the linger is purely visual, so there is no
   pending/unsaved state — a refresh mid-linger just shows the item already in Recently Bought.
   Zero data-model implication (optimistic local state + a timer). The design builds this as a
   first-class feature (`lingerSeconds` default 4s, `lingerUndo` toggle), so it's in v1 — this is
   the module's one piece of client-side state; everything else is server-component + server-action.

---

## Toggle & delete semantics

- **Check off:** `status: 'needed' → 'bought'`, `checkedAt = now()`.
- **Un-check (undo):** `status: 'bought' → 'needed'`, `checkedAt = null`.
- **Soft-delete** (`deletedAt`) is the *separate* "I added this by mistake / it's not relevant
  anymore" path — distinct from checking off. Gone from all reads; agent token may soft-delete,
  never hard-delete (per conventions).

Checking off is expressed as a `PATCH {status}` (see API), so no bespoke toggle endpoint is needed;
the repo sets/clears `checkedAt` from the status transition.

### Design → schema mapping

The Claude Design prototype (`Shopping List.dc.html`) uses a single 3-value `status`
(`active` / `bought` / `deleted`) because a UI prototype just needs *some* way to make a row vanish.
The production schema keeps only a 2-value `status` and models removal with the platform's standard
`deletedAt` column. `status` answers *"where does this sit on the list?"*; `deletedAt` answers
*"does this record exist?"* — orthogonal concerns. When building the UI, map the prototype's
vocabulary onto the real fields (the visuals are unchanged — only which column "delete" writes to):

| Prototype value / action | Production write |
|---|---|
| `status: 'active'` | `status: 'needed'` |
| `status: 'bought'` (+ `checkedAt`) | *identical* |
| `remove()` → `status: 'deleted'` | `deletedAt = now()` (soft-delete; row drops from all reads) |

Keeping deletion in `deletedAt` (not a status value) is what lets the repo's shared
`WHERE deleted_at IS NULL` filter, the agent-barred-from-hard-delete rule, and the clean two-value
status toggle all work the same way they do in the macro and weight modules.

---

## Surfaces

- **Web UI** (Clerk-gated): the **full editor** — add item (category + text), check/un-check, edit
  (category or text inline), soft-delete. Grouped active list + collapsed recently-bought. All via
  server actions on the same `schema.parse → repo` path.
- **Token API** (`/api/shopping/**`): CRUD on items (POST/PATCH/soft-DELETE) + a `list` endpoint
  returning the two-section view. Same envelope/pagination/auth as macros & weight.
- **Skill** (`manage-shopping`, or a shared client method): "add taco-night stuff to my list" →
  batch adds; "what's still on the list?" → reads the active view; "check off the milk" → PATCH.
  Returns the created/affected items.

### `get`-after-create, soft-delete, PATCH-default

Same as the other modules: create → `201` + `Location` + body; soft-delete default (agent barred
from hard); PATCH is the modify verb (also carries the check/un-check status transition).

### API routes (mirrors weight's layout)

- `src/app/api/shopping/items/route.ts` — `GET` (paginated list), `POST` (create).
- `src/app/api/shopping/items/[id]/route.ts` — `GET`, `PATCH` (edit + check/un-check), `DELETE`
  (soft; hard requires `JMW_API_KEY`).
- `src/app/api/shopping/list/route.ts` — `GET` the two-section view (active grouped + recently
  bought). Analogous to `/api/weight/rollup`.

---

## Zod schema (single source of truth)

```ts
export const shoppingCreateSchema = z
  .object({
    category: z.string().trim().min(1),
    text: z.string().trim().min(1),
  })
  .strict();

// PATCH: any create field, plus the check/un-check status transition.
export const shoppingPatchSchema = shoppingCreateSchema
  .partial()
  .extend({ status: z.enum(["needed", "bought"]).optional() })
  .strict();
```

`status` starts `'needed'` server-side on create (not a create input). The repo derives `checkedAt`
from a `status` change in PATCH — the API/skill never set `checkedAt` directly.

---

## Repo surface (`src/lib/shopping/repo.ts`)

The only place `shopping_item` is touched; reads exclude soft-deleted.

- `getList(opts?: { boughtWithinDays?: number })` →
  `{ active: CategoryGroup[]; recentlyBought: Item[]; activeCount: number }` — the two-section view;
  `boughtWithinDays` defaults to 7. `activeCount` (total `needed` items) feeds the header's
  `ON THE LIST` readout; it's just the summed group sizes, no extra query.
- `listItems({ limit, offset })` → `{ items, count }` — flat paginated list (API completeness).
- `getItemById(id)`
- `addItem(input: ShoppingCreate)` → inserts a `needed` item.
- `patchItem(id, patch: ShoppingPatch)` → edits `category`/`text`, and on a `status` change sets
  `checkedAt = now()` (→bought) or `null` (→needed).
- `softDeleteItem(id)` / `hardDeleteItem(id)` — hard gated to `JMW_API_KEY` at the route layer.

---

## UI contract — component inventory (for the design tool)

Reuses `AppShell`, all tokens, mono/tabular where numeric. Nav flips the `shopping` chip from
`SOON`/disabled to **LIVE** (`AppShell.tsx`), and the landing row (`Landing.tsx`) from
`active:false` to a live module link. **No hero chart** — shopping's signature is a *calm, dense,
scannable grouped list* and a *satisfying check-off*, not a data-viz hero. Spend the boldness on the
check interaction and the grouping rhythm, not a chart.

### `ShoppingList` — the primary surface
The active list, grouped by category. Each category is a quiet subheading; under it, item rows:
a **checkbox** (the primary action), the **text** line, and inline **edit** / **delete** affordances
(revealed on hover/focus, like `EntryRow`). Empty state: a friendly "nothing on the list" line.

### `AddItemRow` — inline add (web write path)
An always-available inline composer: a category field (free text, perhaps suggesting existing
categories) + the item text + add. This is the web being a *full editor*, unlike macros.

### `RecentlyBought` — pre-collapsed history
A `<details>`-style section, **collapsed by default**, listing items bought within 7 days
(newest first). Each row shows the text struck-through/muted with an **un-check** control (the
durable undo). Older bought items are absent (filtered).

### Check-off interaction *(v1 — client component)*
Optimistic toggle; the checked item lingers a few seconds in place with an inline "undo" and a
draining progress bar, then slides into the collapsed section. The write is immediate; the linger is
visual only. See the design handoff for the exact animation/timing specs.

---

## Mock data shape (for the design tool to render against)

```jsonc
{
  "active": [
    {
      "category": "Frozen",
      "items": [
        { "id": "…", "text": "2 bags peas", "status": "needed" },
        { "id": "…", "text": "family pack chicken thighs", "status": "needed" }
      ]
    },
    {
      "category": "Produce",
      "items": [
        { "id": "…", "text": "2 dozen eggs", "status": "needed" },
        { "id": "…", "text": "a big thing of spinach", "status": "needed" },
        { "id": "…", "text": "bananas", "status": "needed" }
      ]
    }
  ],
  "recentlyBought": [                 // status=bought, checkedAt within 7 days, newest first
    { "id": "…", "text": "oat milk", "category": "Dairy",  "checkedAt": "2026-07-05T14:02:00Z" },
    { "id": "…", "text": "coffee",   "category": "Pantry", "checkedAt": "2026-07-04T09:20:00Z" }
  ]
}
```

Dark-mode-first. Categories sorted case-insensitively alphabetical; items alphabetical within a
group. The checkbox uses `--color-accent`; bought text is muted/struck. Keep it calm — this is a
utility surface, not a dashboard.

---

## Build checklist (definition of done)

Per `CONVENTIONS §8` — the last two are the ones nothing auto-generates, so they must be in the plan:

- [ ] `src/lib/shopping/` — `schema.ts`, `repo.ts`, `types.ts`
- [ ] `shopping_item` table in `src/lib/db/schema.ts` + migration
- [ ] API routes under `src/app/api/shopping/` (items, items/[id], list)
- [ ] UI under `src/app/(app)/shopping/` + `src/components/shopping/`
- [ ] Flip the `shopping` nav chip (`AppShell.tsx`) + landing card (`Landing.tsx`) to LIVE
- [ ] **OpenAPI:** register in `scripts/build-openapi.ts` (import schemas → build `shoppingSpec` →
      add `["shopping", shoppingSpec]` to `fragments`), then `npm run openapi:build` and confirm
      `openapi/shopping.json` appears.
- [ ] **Docs:** this file is the model; update the README module list + `docs/BACKLOG.md` on ship.

## Open / deferred (for the backlog)

- **Store-aisle category order.** Alphabetical for v1. A fixed display order (produce→frozen matching
  a store walk) is genuinely useful but pushes `category` past a bare string; revisit only if
  alphabetical annoys. A small hardcoded order list in code (no table) would be the way.
- **Old-bought purge.** Filter-only for now; add a purge/cron if the table ever bloats.
- **`manage-shopping` skill.** Build after the web + API land (like `manage-macros`), or fold into a
  shared client. Batch-add is the marquee use ("add the ingredients for X").
</content>
</invoke>
