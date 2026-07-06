# Mobile / responsive spec (Phase 4)

The design tool delivered the mobile treatment inside **`Weight Tracker.dc.html`** (in the design
project `claude.ai/design/p/338fd708-c1b2-4c01-816a-217eea9bae8f`) as a single
`@media (max-width: 768px)` block. This doc captures it so the insight survives compaction.

## ⚠️ The key implementation gotcha (read first)

Our components are built with **inline React `style={{…}}` objects** (chosen for pixel fidelity).
**Inline styles cannot be targeted by `@media` queries.** So Phase 4 is not "add a media query" — it
requires moving the responsive-critical elements to **CSS classes** (in `globals.css` or CSS modules)
or **Tailwind responsive utilities**, then applying the breakpoint rules.

Plan of attack:
- Give the shell/layout elements stable class names (the design already names them: `.shell`, `.rail`,
  `.rail-head`, `.rail-foot`, `.rail-mods`, `.rail-label`, `.topbar`, `.content`, `.stat-grid`,
  `.weigh-grid`, `.col-note`). Add those classes to `AppShell` + the weight/macro components alongside
  (or instead of) the inline styles for the properties that change at the breakpoint.
- Put the `@media (max-width: 768px)` rules in `globals.css`.
- Keep the desktop inline styles for everything that doesn't reflow.

## Breakpoint: `max-width: 768px`

### Shell + nav rail (AppShell — applies to every module)
- `.shell` → `flex-direction: column` (rail moves to the **top**, not the left).
- `.rail` → `width: 100%`, `height: auto`, `position: static`, `flex-direction: row`, `flex-wrap: wrap`,
  `align-items: center`, `border-right: none`, `border-bottom: 1px solid var(--color-border)`.
- `.rail-head` (brand block) → `flex: 1`, no bottom border, `padding: 12px 16px`.
- `.rail-foot` (user + theme toggle) → no top border, `padding: 12px 16px`, `width: auto`.
- `.rail-mods` (the module list) → `order: 3`, `flex: 0 0 100%`, full width, `display: flex`,
  `gap: 8px`, `overflow-x: auto`, `padding: 0 12px 12px` — i.e. the modules become a **horizontal
  scroll row of chips** below the brand/user bar.
- `.rail-label` ("MODULES") → `display: none`.
- `.rail-mods > a, .rail-mods > div:not(.rail-label)` → `flex: 0 0 auto`, `margin-top: 0`,
  `white-space: nowrap` (each module becomes an inline chip, not a stacked row).

So on mobile the nav rail collapses into a top bar: brand on the left, user/theme on the right, and a
horizontally-scrollable strip of module chips beneath.

### Terminal header
- `.topbar` → `padding: 12px 16px`, `flex-wrap: wrap`, `gap: 12px`.

### Content
- `.content` → `padding: 16px 16px 48px` (tighter).

### Weight module specifics
- `.stat-grid` (the 4 stat tiles) → `grid-template-columns: 1fr 1fr` (**2-up** instead of 4).
- `.weigh-grid` (the weigh-in table rows + header) → `grid-template-columns: 1fr 76px 56px 44px`
  and `.col-note { display: none }` — i.e. **drop the NOTE column** (date, weight, Δ, actions remain).

### Macro module (analogues — design didn't spell these out; apply the same approach)
The macro page needs the same treatment; mirror the weight rules:
- DayRollup macro grid (`repeat(3,1fr)`) → 1-col (or keep 3 if it fits; test).
- EntryList grid → drop/again-narrow columns on small screens (the entry `KCAL | P | F | C` may need
  the food name to wrap; keep the confidence tag + name + kcal, tighten P/F/C).
- Day-navigation row (big date + week-strip of 7 chips) → let the week strip scroll or wrap; keep the
  prev/next + today.
- The `WeightTrend` / DayRollup hero SVG already scales (`width: 100%`), so charts are fine.

## Process
Same as the other UI phases: implement in code, review live via the `/preview/*` routes at a mobile
viewport (e.g. Chrome `--window-size=390,844`), iterate, then deploy. Reviewed live like Phases 1–3.
