# Design brief → Claude Design: Shopping list (justmy.website)

A **third module** for justmy.website. **Reuse the existing design system you already built** for
this project — the exact same tokens (`--color-*`, `--font-*`, `--radius`, `--band`), the dark-mode-
first look, the mono/tabular numbers, and the `AppShell` chrome (210px nav rail + terminal header).
This module adds a `shopping` nav entry (flip it from `SOON`/disabled to **LIVE**) and one new page.
Don't invent a new aesthetic; extend the one that's there. Produce a **visual + structural
reference** (single-file artifact is fine), rendered against the mock data below. Full binding spec
is `docs/shopping-model.md` — it wins on any conflict.

## The one idea that must come through visually
This is a **working utility, not a dashboard.** Unlike macros (honest-about-fuzziness hero) and
weight (trend-over-noise hero), shopping has **no data-viz hero and no derived intelligence** — it's
a single flat list with **one grouping level (category → item)**, tuned for two actions done well:
**adding** and **checking off**. The signature is a *calm, dense, scannable grouped list* and a
*satisfying check-off*. Spend your boldness on the **checkbox interaction and the grouping rhythm**,
not on a chart. Restraint is the aesthetic.

## The signature surface: `ShoppingList` (spend your care here, not boldness)
The active list, **grouped by category**. There is no hero card — the list *is* the page.
- **Category subheadings** — quiet, mono, uppercase-ish (like the `DAY ROLLUP` / column-header
  treatment): `--font-mono` ~10px, letter-spacing ~0.14em, `--color-text-muted`. Categories sorted
  **case-insensitively alphabetical**; items alphabetical within a group. A hairline
  (`--color-border`) under each heading.
- **Item rows** — the **checkbox is the primary mark** (left), then the item **text**
  (`--font-body`, `--color-text`), which carries its own quantity detail ("2 dozen eggs" — there is
  **no separate quantity column/number**). On hover/focus, reveal inline **edit** (`⌄`/pencil-free,
  use a mono glyph) and **delete** affordances at the right, same quiet treatment as the macro
  `EntryRow` caret. Rows are dense — this is a scan-and-tick surface, not a spacious card.
- **The checkbox** — unchecked: a `--color-border` square (`--radius`), hover raises to
  `--color-accent` hairline. Checked: `--color-accent` fill + a check glyph. This is the one place
  the accent earns emphasis; the check should feel *decisive and satisfying*.
- **Empty state** — a friendly mono line ("`nothing on the list`"), not a blank panel.

## Supporting components (quieter — reuse existing patterns)
- **`AddItemRow`** — an always-available inline composer (this module's web IS a full editor, unlike
  macros): a **category** field (free text; may suggest existing categories) + the **item text**
  field (`--font-mono` input with an accent caret, like the macro add-entry prompt) + add. Prompt
  glyph `add ›` in `--color-accent`. Keep it a single quiet row, not a modal.
- **`RecentlyBought`** — a `<details>`-style section at the **bottom, collapsed by default**. Summary
  line in muted mono (e.g. "`recently bought · 6`"). Expanded: rows of items bought within the last
  **7 days**, newest first, text **muted + struck-through**, each with an **un-check** control that
  pulls it back into the active list (the durable undo). Items older than 7 days are simply absent.

Page layout, top to bottom: `AddItemRow` → `ShoppingList` (grouped) → `RecentlyBought` (collapsed).

## Interactions & behavior
- **Check off** → optimistic; the row may **linger a few seconds in place with an inline "undo"**
  before it slides down into the collapsed `RecentlyBought` section. (Optional polish — the collapsed
  section already provides recovery; fine to ship the plain version first.)
- **Un-check** (from `RecentlyBought`) → restores the item to its category in the active list.
- **Edit** → inline category/text correction (revealed affordance), not a modal.
- **Delete** → soft-delete ("added by mistake"); distinct from checking off. Quiet, no confirm-modal.
- **Theme toggle / terminal header / nav rail** — all inherited from `AppShell`, unchanged. Header
  route reads `~/shopping`.

## Color / tone
Overwhelmingly **neutral** — `--color-text`, `--color-text-muted`, `--color-border`. The **only**
saturated accent is the **checkbox** (`--color-accent`) and the `add ›` prompt. No success/warning/
over colors here — nothing is on-/off-target; this is a list, not a score. `--font-mono` tabular for
any counts (the `RecentlyBought` tally). Dark-mode-first; light derived.

## Mock data (render against this)
Two sections: an active list grouped by category, and a recently-bought tail. Shape:

```jsonc
{
  "active": [
    { "category": "Frozen", "items": [
      { "text": "2 bags peas" }, { "text": "family pack chicken thighs" } ] },
    { "category": "Produce", "items": [
      { "text": "2 dozen eggs" }, { "text": "a big thing of spinach" }, { "text": "bananas" } ] }
  ],
  "recentlyBought": [                 // status=bought, checkedAt within 7 days, newest first
    { "text": "oat milk", "category": "Dairy",  "checkedAt": "2026-07-05T14:02:00Z" },
    { "text": "coffee",   "category": "Pantry", "checkedAt": "2026-07-04T09:20:00Z" }
  ]
}
```

Categories sorted case-insensitively alphabetical; items alphabetical within a group. Bought text
muted/struck. Keep the whole thing calm and dense.

## Out of scope
No quantity fields/steppers, no per-item prices, no spend/trend anything, no store-aisle ordering
(alphabetical only), no arbitrary nesting or sub-lists (one category level, period), no pantry/
inventory. No new tokens or fonts. Just the shopping page + its `shopping` nav entry, in the
established look.
</content>
