# Shopping module — design handoff (distilled)

Actionable distillation of the Claude Design prototype `Shopping List.dc.html` (DesignSync project
`338fd708-c1b2-4c01-816a-217eea9bae8f`). The `.dc.html` is a `<x-dc>` prototype, not production code;
this is the buildable reference. `docs/shopping-model.md` remains the binding spec and wins on any
conflict (notably the **status/`deletedAt` mapping** below). Re-fetch the prototype via DesignSync
`get_file` if you need exact markup/geometry beyond what's captured here.

**Reuses the established design system** — same tokens, `AppShell` chrome, mono/tabular numbers,
dark-first. No new tokens or fonts. Glyphs are Unicode (`✓ ▸ ▾ › /`), no assets.

---

## Layout

- `AppShell` frame unchanged: 210px nav rail + main column + sticky terminal header. The `shopping`
  nav item is the **active** one (raised surface, `inset 2px 0 0 --color-accent`, `▸` glyph,
  `LIVE` badge in accent).
- Content column: `max-width: 760px`, padding `24px 28px 60px`.
- Terminal header path: `curtis@justmy` (success) · `~/shopping` (muted) · `$` (accent) + blinking
  caret. **Right side (the header readout):** `ON THE LIST` (mono 10px, letter-spacing 0.1em, muted)
  + `activeCount` (mono 13px, 600, **accent**, tabular-nums). This balances the shared header height
  against macros/weight.
- Responsive: the existing `@media(max-width:768px)` rail→topbar reflow applies unchanged.

## Animations (keyframes — preserve these; they're the character)

| Name | Spec | Used by |
|---|---|---|
| `blink` | `0%,49%{opacity:1} 50%,100%{opacity:0}`, `1.1s step-end infinite` | header caret, empty-state caret |
| `checkpop` | `0%{scale .4;opacity 0} 60%{scale 1.18} 100%{scale 1;opacity 1}`, `.2s ease-out` | the `✓` glyph when a box is checked |
| `drain` | `from{scaleX(1)} to{scaleX(0)}`, `transform-origin:left`, `{lingerSeconds}s linear forwards` | the grace-timer progress bar |

---

## Components

### `AddItemRow`
Bordered row (`--color-surface`, `--radius`, padding `12px 14px`, `flex-wrap:wrap`):
- `add ›` — mono 14px, `--color-accent`, `flex:none`.
- **category** input — width 130px, transparent bg, no border, mono 12px, `--color-text-muted`,
  `caret-color:--color-accent`, `list="catlist"` (see suggestions).
- `/` separator — `--color-border`, mono 13px.
- **item text** input — `flex:1` (min-width 130px), transparent, mono 13px, `--color-text`,
  placeholder `"a big thing of spinach…"`.
- **add** button — mono 11px 600; when the text field is non-empty it fills `--color-accent`
  (text `--color-bg`); empty it's a muted outline. `Enter` in either field adds.
- Helper line beneath — mono 10.5px muted: *"One category level, alphabetical. No aisles, no
  steppers — the quantity lives in the words."*

**Category suggestions:** a `<datalist id="catlist">` populated from the distinct existing categories
(non-deleted), sorted case-insensitively. Both the add and edit category inputs reference it.

### `ShoppingList`
- **Empty state** (`activeCount === 0`): centered mono 12.5px muted `nothing on the list` + a blinking
  accent caret. Not a blank panel.
- **Category subheading:** mono 10px, letter-spacing 0.14em, `text-transform:uppercase`, muted,
  padding `0 4px 7px`, `border-bottom:1px solid --color-border`, `margin:22px 0 0`.
- **Item row:** flex, gap 12px, padding `9px 4px`, `border-bottom:1px solid --color-border`. Wrapper
  is `position:relative; overflow:hidden` (to clip the drain bar).
  - **Checkbox** (button, 20×20, `--radius`): unchecked = `--color-surface` bg + `--color-border`;
    hover (unchecked) = `--color-accent` border + `--band` bg; checked = `--color-accent` bg +
    border. `transition: border-color .12s, background .12s`. The `✓` glyph is `color:transparent`
    unchecked, `--color-bg` + `checkpop` when checked (mono 13px 600).
  - **Item text:** `--font-body` 14px, single-line ellipsis; `--color-text` normally,
    `--color-text-muted` while lingering.
  - **Hover affordances** (`edit` / `delete`): mono 10.5px, letter-spacing 0.04em, muted;
    `opacity:0 → 1` on row hover, `transition:opacity .12s`. `edit` hovers to `--color-accent`,
    `delete` hovers to `--color-text`.
- **Edit mode** (inline, replaces the row): a dashed 20×20 placeholder + a category input (140px,
  bordered, `list="catlist"`) + a text input (flex, bordered) + **save** (accent fill) / **cancel**
  (muted outline). `Enter` saves, `Esc` cancels. Empty text on save = cancel.

### Grace-timer linger (the checked-off transient state)
When a box is checked and `lingerUndo` is on (`lingerSeconds > 0`), the row **stays in place** for
`lingerSeconds` showing, in place of the affordances:
- `checked off` — mono 10px muted — and an **`undo`** button (mono 11px accent).
- a **drain bar**: `position:absolute; left:0; bottom:0; height:2px; width:100%; background:
  --color-accent; transform-origin:left`, animated by `drain` over `lingerSeconds`.
After the timer, the row leaves the active list and appears in Recently Bought. **The DB write is
immediate on check** — the linger is purely visual (see the model doc). `undo` (during linger) and
`uncheck` (from Recently Bought) both restore the item to `needed`.

### `RecentlyBought`
- **Toggle** (full-width button): caret `▸`/`▾` (mono 10px) + `recently bought · {count}`
  (mono 11px, letter-spacing 0.06em, muted) + a hairline rule filling the remaining width.
  **Collapsed by default** (`recentOpen` default false).
- **Row:** an **un-check** button (20×20, bordered, hover → accent border, muted `✓`, title
  "put back on the list") + text (`--font-body` 13.5px, muted, `line-through` with
  `text-decoration-color:--color-border`, ellipsis) + category (mono 9px, 0.1em, uppercase, muted
  opacity .7) + **when** (mono 10.5px muted, width 84px, right-aligned, tabular).
- **when** = relative label from `checkedAt`: `today` / `yesterday` / `N days ago`. Window is the
  last **7 days**, newest first; older are filtered out.
- Footer note — mono 10px muted opacity .7: *"Kept 7 days · un-check to pull an item back onto the
  list."*

---

## Derived-view logic (mirror this in `repo.getList` + the client component)
- **Active list** = items `status==='needed'` **OR still lingering** (a just-checked row stays
  visible through its linger). Group by category; sort groups and items within a group
  **case-insensitively alphabetical** (`localeCompare`).
- **Recently bought** = `status==='bought'`, not lingering, `checkedAt` within 0–7 days, sorted
  newest-checked first.
- **`activeCount`** = number of active items (feeds the header readout).
- **Category suggestions** = distinct non-deleted categories, sorted case-insensitively.

## Design-tool props → not schema
Prototype knobs, for reference: `lingerUndo` (bool, default true), `lingerSeconds` (0–10, default 4),
`recentOpen` (bool, default false). In production these are component defaults, not stored data.

## Status mapping (binding — from `shopping-model.md`)
The prototype's `status: 'active' | 'bought' | 'deleted'` maps to the production 2-value status +
`deletedAt`: **`active → needed`**, `bought → bought` (+ `checkedAt`), **`remove()` →
`deletedAt = now()`** (soft-delete, not a status value). Visuals unchanged; only the column the
delete writes to differs. See the model doc's "Design → schema mapping".
</content>
