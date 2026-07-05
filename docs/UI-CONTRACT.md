# justmy.website — UI contract

The binding document between Claude Design (produces the visual/structural reference)
and Claude Code (builds the production Next.js components). **Both conform to this.**
Design has aesthetic latitude; it does NOT have latitude on token names, component
names, or props — those are Code's interface and are fixed here.

Dark-mode-first is non-negotiable (Curtis's standing preference). The light theme, if
any, is derived from the dark one, not the reverse.

---

## 1. Design tokens (CSS custom properties)

Tailwind 4 is CSS-first (`@theme`), so tokens are CSS variables, not a JS config.
Design chooses the actual values; these are the *names* Code will reference and Design
must populate. Do not rename them.

```
--color-bg            /* app background (darkest) */
--color-surface       /* card/panel background */
--color-surface-raised/* elevated card (day rollup, modals) */
--color-border        /* hairline dividers */
--color-text          /* primary text */
--color-text-muted    /* secondary/caption */
--color-accent        /* the ONE signature accent — used with restraint */
--color-success       /* on-target / within-band */
--color-warning       /* approaching/over a target */
--color-over          /* clearly over target */

--font-display        /* characterful, used sparingly */
--font-body           /* readable body */
--font-mono           /* numbers: macro values, calories — tabular */

--radius              /* base corner radius */
--space-unit          /* base spacing rhythm */
```

Numbers (macro values, calorie counts) render in `--font-mono` with tabular figures —
a food tracker is a numbers instrument and the digits must align in columns.

## 2. Layout-slot contract

The shell provides a frame; each module mounts a page into it. The frame owns:

- **`AppShell`** — the outer frame. Clerk-gated; nothing renders unauthenticated.
  Provides the nav rail/header listing modules, the theme, and a single content slot.
- **Content slot** — a module page renders here. The shell knows nothing about a
  module's internals; it only renders `children`.
- **Module nav** — the shell lists modules (Macros first; Shopping later). Adding a
  module = adding a nav entry + a route under `src/app/(app)/{module}/`.

A module page is responsible for its own content only. It never redraws the chrome.

## 3. Component inventory — MACRO MODULE

Each component: its role, the data it renders, and its props. Design renders these
against the mock rollup shape in §4 so the states are visible. Code implements them as
server/client components as appropriate, pulling real data via `repo.ts`.

### `DayRollup`
The centerpiece. Renders one day's totals against target(s).
- **Props:** `rollup: DayRollup` (shape in §4).
- **Critical dual-target state:** when `rollup.day.kind === "unspecified"`, it renders
  BOTH targets — "on target if training, N over if rest" — NOT a single defaulted
  target. This is the honesty-about-fuzziness principle made visual. When kind is
  known, it renders the single applicable target.
- Shows per-macro progress (calories, protein, fat, carbs) toward target, using
  `--color-success/warning/over` bands.
- Surfaces the **estimation state**: what fraction of the day's total came from
  `estimated` entries, so the number's precision is legible ("2,240 kcal · 40% est.").

### `EntryRow`
One logged food.
- **Props:** `entry: Entry`.
- Shows food name, quantity, the macro contribution, and a **confidence marker**
  (`measured` / `estimated` / `logged_serving`) — a small, non-alarming indicator, not
  a warning. Estimated rows expose the `note` (what Curtis said) on demand.

### `EntryList`
The day's entries.
- **Props:** `entries: Entry[]`.
- Groups nothing (no meal slots). Chronological or insertion order. Empty state is an
  invitation to log, not a blank panel (per frontend-design copy guidance).

### `TargetProfileBadge`
Small display of which target profile is in effect and its kind.
- **Props:** `kind`, `target: MacroSet | null`.

### `MacroBar` / `MacroValue`
Primitive: a single macro's value and its bar toward a target. Composed by `DayRollup`.
- **Props:** `label`, `value: number`, `target: number | null`, `unit: "g" | "kcal"`.
- Units are DISPLAY-only (added here); stored data is unitless numbers.

## 4. Mock data shape (for Design to render against)

This is the `DayRollup` response shape from the API's day-rollup endpoint. Design
renders every component against this so the dual-target and estimation states are real.

```jsonc
{
  "day": {
    "date": "2026-07-05",
    "kind": "unspecified"          // "training" | "rest" | "unspecified"
  },
  "totals": {                       // absolute sums of the day's entries
    "calories": 2240,
    "proteinContent": 163,
    "fatContent": 78,
    "carbohydrateContent": 205
  },
  "estimation": {
    "estimatedFraction": 0.40,      // 0..1 — share of calories from estimated entries
    "entryCount": 9,
    "estimatedCount": 4
  },
  "targets": {                      // when kind known: one key. when unspecified: BOTH.
    "training": { "calories": 2800, "proteinContent": 160, "fatContent": 90, "carbohydrateContent": 300 },
    "rest":     { "calories": 2200, "proteinContent": 160, "fatContent": 70, "carbohydrateContent": 200 }
  },
  "entries": [
    {
      "id": "…",
      "consumedOn": "2026-07-05",
      "foodName": "Chicken thigh, boneless skinless, cooked",
      "quantityGrams": 200,
      "confidence": "estimated",
      "note": "one big thigh, eyeballed",
      "calories": 380, "proteinContent": 52, "fatContent": 18, "carbohydrateContent": 0
    }
  ]
}
```

When `day.kind` is `"training"` or `"rest"`, `targets` contains only that one key and
`DayRollup` shows a single target. When `"unspecified"`, both keys are present and
`DayRollup` shows the dual state. Design must render both cases.

## 5. What Design delivers vs. what Code delivers

- **Design:** the shell/chrome (`AppShell`, nav, theme, token values) and a visual +
  structural reference for the §3 components, dark-mode-first, one signature element,
  rendered against §4 mock data. Reference quality — NOT production Next.js. Single-file
  artifact is fine.
- **Code:** production Next.js 16 implementations of all of the above, wired to real
  data through `repo.ts`, mounted in the real Clerk-gated shell, conforming to these
  token names and component APIs.

Where Design and Code disagree, **this document wins.**
