# Handoff: Macro Tracker (justmy.website)

> Imported from the Claude Design project "Design handoff document"
> (`claude.ai/design/p/338fd708-c1b2-4c01-816a-217eea9bae8f`). This is Design's deliverable:
> the token **values**, component **visual treatments**, state **thresholds**, and **mock data**
> that `docs/UI-CONTRACT.md` left to Design. **The UI-CONTRACT remains the binding spec and wins
> on any conflict** (it fixes token *names*, component *names*, and *props*).

## Overview
The macro / food-intake tracker for `justmy.website`. This package covers the **AppShell chrome**
and a **visual + structural reference** for the macro module's components. The signature idea the
UI must embody: the tracker is **honest about fuzziness** — Claude estimates macros from Curtis's
vague descriptions, and the UI never presents an estimate as a measured fact.

The design files are **references authored in HTML** — prototypes showing intended look and
behavior, **not production code to copy**. The task is to recreate them as **Next.js 16
server/client components**, wired to the database via `repo.ts`, mounted in the Clerk-gated shell.

**Fidelity: high.** Final colors, typography, spacing, interactions. Recreate pixel-faithfully via
the Tailwind 4 `@theme` tokens. Dark-mode-first is non-negotiable; light derives from dark.

---

## Design tokens (§1) — VALUES

### Dark (canonical)
| Token | Value | Role |
|---|---|---|
| `--color-bg` | `#0a0d0f` | app background (darkest) |
| `--color-surface` | `#12171a` | card / panel background |
| `--color-surface-raised` | `#1a2127` | elevated card (DayRollup, modals) |
| `--color-border` | `#242d33` | hairline dividers |
| `--color-text` | `#e7eef1` | primary text |
| `--color-text-muted` | `#68777e` | secondary / caption |
| `--color-accent` | `#3ad0d6` | the ONE signature accent — signal cyan; restraint (in-range corridor, estimate marks, interactive) |
| `--color-success` | `#4ec97a` | on-target / within band |
| `--color-warning` | `#e0a63a` | approaching / over a target |
| `--color-over` | `#e5533f` | clearly over target |

Derived helper: `--band = rgba(58,208,214,0.12)` — translucent accent fill for the "honest
corridor" band and estimate note backgrounds.

### Light (derived from dark — invert lightness, keep hue, lower chroma)
| Token | Value |
|---|---|
| `--color-bg` | `#eceff1` |
| `--color-surface` | `#ffffff` |
| `--color-surface-raised` | `#ffffff` |
| `--color-border` | `#d5dde1` |
| `--color-text` | `#111819` |
| `--color-text-muted` | `#5a696f` |
| `--color-accent` | `#0e9aa0` |
| `--color-success` | `#2f9e57` |
| `--color-warning` | `#b07d1c` |
| `--color-over` | `#cc3d2a` |
| `--band` | `rgba(14,154,160,0.12)` |

### Type
| Token | Value | Notes |
|---|---|---|
| `--font-display` | `'Space Grotesk'` | characterful; big date + reference headings only |
| `--font-body` | `'IBM Plex Sans'` | labels, prose, food names |
| `--font-mono` | `'JetBrains Mono'` | **all numbers** — always `font-variant-numeric: tabular-nums`. Weights 400/500/600/700. |

Google Fonts weights: JetBrains Mono 400;500;600;700 · IBM Plex Sans 400;500;600 · Space Grotesk 500;600;700.

### Shape & rhythm
| Token | Value |
|---|---|
| `--radius` | `4px` (base; rollup card uses `calc(--radius * 1.5)` = 6px) |
| `--space-unit` | `8px` |

---

## Layout-slot contract (§2)

- **`AppShell`** — outer frame, Clerk-gated. Owns: the 210px left nav rail, the theme, and a single
  content slot. Nothing renders unauthenticated.
- **Nav rail** lists modules (`macros` active; `shopping` present but `SOON`/disabled). Active
  module gets a raised surface + a 2px inset accent bar on the left + a `▸` glyph.
- **Terminal header** (shell-owned, sticky top): a shell-path breadcrumb
  `curtis@justmy ~/{module}/{route} $` in `--font-mono` (`curtis@justmy` in `--color-success`, path
  in `--color-text-muted`, `$` in `--color-accent`), then a decorative blinking accent caret. For
  macros the route is the selected date: `~/macros/2026-07-05`. The **day-kind segmented control**
  (training / rest / unspecified) lives on the right of this header.
- A module page renders **only its own content**; it never redraws the chrome.

---

## Screens

### AppShell + Macros page (`Macro Tracker.dc.html`)
Nav rail (left, 210px) + main column. Main = sticky terminal header, then a scrolling content area
(max-width 940px): day-navigation row → DayRollup → EntryList → add-entry prompt.

**Day-navigation row:**
- Left: prev (`‹`) / next (`›`) square buttons (34×34, `--color-surface`, disabled+dimmed at ends),
  the large date `Jul 5` in `--font-display` 23px 600 with year in `--color-text-muted`, and below
  the weekday in `--font-mono` 9.5px letter-spacing 0.14em (`SUNDAY · TODAY` on the latest day).
- Right: a week strip of 7 day-chips (40px wide): 2-letter weekday, day-of-month mono tabular, and a
  **kind dot** (5px): training→`--color-warning`, rest→`--color-success`, unspecified→`--color-accent`.
  Selected chip gets accent border + `--band` fill.
- Selecting a day rewrites the header path, loads that day's kind + entries, recomputes the rollup.

---

## Component inventory (§3) — treatments

### `DayRollup` — the centerpiece
Elevated card (`--color-surface-raised`, 6px radius). Three stacked regions:

1. **Header row.** Left: label `DAY ROLLUP` (mono 10px, 0.14em, muted); the day's total calories in
   `--font-mono` 52px 600 tabular with a muted `kcal`; then the **estimation surface** — a small
   dotted-ring accent dot + "`{pct}% estimated · {n} of {m} entries`" (muted, pct in `--color-text`).
   Legible, **not alarming**. Right: **`TargetProfileBadge`**.

2. **Signature calorie band — THE HERO.** A 16px track (`--color-surface`, bordered). The visual
   embodiment of honesty-about-fuzziness; the single most important element.
   - **Dual-target state** (`day.kind === "unspecified"`): render the **honest corridor** — a
     `--band` region spanning between the rest and training calorie targets, bordered by accent
     hairlines. Ticks + labels below for `REST 2,200` and `TRAIN 2,800`. The day's total is a solid
     fill + a `--color-text` vertical marker. Summary reads both sides, e.g. "**560 under training ·
     40 over rest**" — never a single defaulted target.
   - **Known state** (`training`/`rest`): a single `TARGET` tick + summary like "−455 vs training target".

3. **Macro grid** — 3 columns (`MacroBar` for protein / fat / carbs).

### `MacroBar` / `MacroValue` (primitive)
Per macro: label (mono 10px muted) + a state word colored by the rule below; the value in
`--font-mono` 26px 600 tabular with a muted unit (`g`); an 8px track with the same dual-corridor /
single-tick treatment as the hero; and a target caption (`target 200–300 g` dual, or `target 300 g`
single). Units are **display-only**.

**Fill/state color rules (keep exact):**
- **Known kind (single target)**, `ratio = value / target`:
  - `< 0.90` → `--color-text-muted` ("under")
  - `0.90–1.02` → `--color-success` ("on target")
  - `1.02–1.10` → `--color-warning` ("slightly over")
  - `> 1.10` → `--color-over` ("over")
- **Unspecified (dual target)**:
  - `value < min(rest, training)` → `--color-text-muted` ("under both")
  - within the rest–training corridor → `--color-accent` ("in range")
  - `value > max(rest, training)` → `--color-over` ("over both")
- If rest target == training target (e.g. protein, both 160), treat as single target.

Track geometry: positions are `value / (max(target, value) * 1.15) * 100`, clamped 0–100.

### `EntryRow`
Grid columns: `time | food | KCAL | P | F | C | caret`. Food cell shows a 3-letter confidence tag +
name, quantity in mono muted below. Macro contributions mono tabular, right-aligned.
- **Confidence marker** (small, non-alarming):
  - `measured` → tag `MEAS`, muted border/text; value plain.
  - `estimated` → tag `EST`, **accent** border/text; the **kcal value gets a 1px dotted accent
    underline** (the fuzziness cue), and a caret toggles a note row.
  - `logged_serving` → tag `SRV`, muted; treated like measured.
- **Estimated note** expands beneath: an accent left-border panel with `--band` fill reading
  `≈ Claude's estimate — "one big thigh, eyeballed"`.

### `EntryList`
Column header (`TIME / FOOD / KCAL / P / F / C`) then a bordered list, one `EntryRow` per entry, in
insertion order. **No meal-slot grouping.** Empty state = an invitation to log, not a blank panel.

### `TargetProfileBadge`
Small bordered chip in the rollup header. A kind dot + kind name (mono 11px 600, 0.1em) + a sub-line:
- `unspecified` → dot `--color-accent`, `--band` fill, "dual target · 2,200 / 2,800 kcal"
- `training` → dot `--color-warning`, "2,800 kcal · 160g P"
- `rest` → dot `--color-success`, "2,200 kcal · 160g P"

### Add-entry prompt
Bordered row: `log ›` prompt in accent, a plain text input (`--font-mono`, accent caret), helper
line: "Describe it plainly. Claude estimates the macros — you can correct any number." Non-wired.

---

## Interactions & behavior
- **Day nav:** prev/next step through available days (disabled at ends); week chip jumps to a day.
  Both reset the kind-override and collapse open notes.
- **Day-kind control:** overrides the current day's displayed kind, re-deriving the rollup — an
  exploration affordance; the persisted kind is the day's own.
- **Estimated-note toggle:** caret expands/collapses the note row per estimated entry.
- **Theme toggle** (nav footer): dark ⇄ light via `data-theme` on the root. Default dark.
- **Blinking caret** in the header: decorative only (1.1s step-end blink).

## Mock data shape (§4)
Matches the contract's `DayRollup` response. The canonical day (Jul 5, `unspecified`) sums to
**2,240 kcal · 163g P · 78g F · 205g C**, with 4 of 9 entries estimated (≈39% of calories).
`targets`: training `{2800, 160, 90, 300}`, rest `{2200, 160, 70, 200}`.

## Assets
None. No images/icons/SVG — glyphs are Unicode (`▸ ▹ ‹ › ⌄ ≈ $`). Fonts load from Google Fonts.

## Source prototypes
The raw HTML prototypes (`Macro Tracker.dc.html`, `Design Reference.dc.html`) and screenshots
(`entries.png`, `history.png`) live in the Claude Design project
(`claude.ai/design/p/338fd708-c1b2-4c01-816a-217eea9bae8f`). They are authored in Claude Design's
`<x-dc>` templating format (not plain HTML), so this Markdown is the actionable distillation rather
than a byte-for-byte copy. Re-fetch a prototype on demand via the DesignSync MCP (`get_file`) when
building a component that needs its exact markup/geometry — e.g. the `Macro Tracker.dc.html`
`days()` mock data and the hero-band track math.

Every token value and state rule above was verified against the `Design Reference.dc.html` source.
