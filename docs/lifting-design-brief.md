# Design brief → Claude Design: Lifting journal (justmy.website)

A **fourth module** for justmy.website. **Reuse the existing design system you already built** for
this project — the exact same tokens (`--color-*`, `--font-*`, `--radius`, `--band`), the dark-mode-
first look, the mono/tabular numbers, and the `AppShell` chrome (210px nav rail + terminal header).
This module adds a `lifting` nav entry (flip it from `SOON`/disabled to **LIVE**) and two screens: a
**journal list** and a **session detail**. Don't invent a new aesthetic; extend the one that's there.
Produce a **visual + structural reference** (single-file artifact is fine), rendered against the mock
data below. Full binding spec is `docs/lifting-model.md` — it wins on any conflict.

## The one idea that must come through visually
**The numbers are Hevy's; the meaning is ours.** This is a *training journal / interpretation layer*,
**not a workout tracker** — Hevy already logs the sets. Unlike weight (trend-over-noise hero) or
macros (honest-about-fuzziness hero), the signature here is a **juxtaposition**: on the session
detail, the **cold, precise set table** sits beside the **warm, editorial interpretation**. That
contrast *is* the module. Spend your boldness on making that pairing feel deliberate — the hard grid
of numbers on one side, the prose read on the other — not on a data-viz hero. There is a small
progression chart, but it is supporting evidence, never the star.

## Screen 1 — `SessionDetail` (the signature surface; spend your care here)
Two zones, side by side on desktop (stacked on narrow):

- **The facts (left) — Hevy's truth, cold and exact.** The exercise → set table. Each exercise is a
  quiet mono subheading (like the `DAY ROLLUP` / column-header treatment); under it, set rows:
  **set index**, **weight** (mono/tabular, kg — offer a small kg/lb toggle in the header), **reps**,
  **RPE**. Distinguish **warmup** sets (muted) from **working** sets (full weight). Mark **PR** sets
  with a single `--color-accent` glyph (decisive, rare — this is where the accent earns emphasis).
  Show a per-exercise **e1RM** in mono; when it's flagged *unreliable* (high-rep estimate), render it
  parenthesized/muted, not authoritative. This side should read like an instrument panel.
- **The meaning (right) — ours, warm and editorial.** A stacked panel:
  - **`session_notes`** — Curtis's editable textarea (the web write path). Placeholder like
    "`how did it feel?`". Quiet, roomy.
  - **`quality`** — a 1–5 selector Curtis sets (pips or a small segmented control). Subjective, his.
  - **`focus`** — a single tag from a fixed set (`push · pull · legs · upper · lower · full ·
    accessory · other`), Claude-set, shown as a quiet chip.
  - **Claude's `interpretation`** — rendered as **prose, read-only** in the web (Claude writes it via
    the skill). Give it editorial warmth — comfortable measure, `--font-body`, a subtle left rule or
    label ("`the read`") so it reads as commentary, distinct from Curtis's own notes. When empty,
    show a muted "`no interpretation yet`" state.
  A session header carries date, title, and a derived stat line (tonnage, duration, working sets).

## Screen 2 — `LiftingJournal` (the list surface)
Session cards, **newest first**. Each card, scannable in one pass:
- Date + workout **title**; a compact mono stat line (**tonnage**, **top e1RM**, **duration**).
- The **`focus`** chip and the **`quality`** pips.
- A **one-line interpretation snippet** (truncated) — so the journal reads as a diary, not a log.
- **PR badge(s)** (`--color-accent`) when the session set one.
- A quiet **"needs read"** marker when the session is un-interpreted (muted — information, not alarm).
Header offers **filter chips** for `focus` and an **un-interpreted** toggle. Empty state: a friendly
mono line ("`no sessions yet — connect Hevy`").

## Supporting component (quieter — reuse existing patterns)
- **`LiftProgression`** — a small e1RM-over-time line for one lift, opened from a set/exercise row.
  Muted, `--color-accent` line, mono axis labels — the same restraint as any secondary chart.
  Evidence, not spectacle. Fine to sketch lightly / mark as phase-2.

## Interactions & behavior
- **Edit `session_notes` / set `quality`** → inline, optimistic, server-action save (no modal).
- **`interpretation` and `focus` are read-only in the web** — they're Claude's, written via the
  skill. Never show an editor for them here.
- **No add-a-workout affordance anywhere** — sessions only arrive from Hevy (webhook/pull). This is
  an ingestion module; the web never authors a session. (A quiet "catch up from Hevy" action may
  exist, but it's a *pull*, not a create — keep it understated, header-level.)
- **Theme toggle / terminal header / nav rail** — inherited from `AppShell`, unchanged. Header route
  reads `~/lifting`.

## Color / tone
Mostly **neutral** — `--color-text`, `--color-text-muted`, `--color-border` — with the **accent
reserved for what's genuinely notable**: PR marks and the progression line. The **`quality`** control
may use the accent for the selected value. Keep `quality` calm — it's a subjective note, not a score
to celebrate; no success/warning/over colors. `--font-mono` tabular for every number (weights, reps,
RPE, tonnage, e1RM, duration). Dark-mode-first; light derived. The emotional register: the left side
clinical, the right side reflective — one screen, two temperatures.

## Mock data (render against this)
Sessions newest-first; the second one is deliberately un-interpreted so the "needs read" state shows.

```jsonc
{
  "sessions": [
    {
      "startedAt": "2026-07-15T17:02:00Z", "endedAt": "2026-07-15T18:10:00Z",
      "title": "Push Day A",
      "derived": { "tonnageKg": 8420, "durationMin": 68, "workingSets": 18,
                   "prs": [{ "lift": "Bench Press (Barbell)", "kind": "e1rm", "value": 112.5 }] },
      "annotation": {
        "sessionNotes": "Slept ~5h, felt flat early, warmed up into it.",
        "quality": 3, "focus": "push", "interpreted": true,
        "interpretation": "A grind session — the flat opening tracks the short sleep, but the top bench single still edged a PR, so drive is intact. Hold volume; don't add load next push until sleep normalizes."
      },
      "exercises": [
        { "title": "Bench Press (Barbell)", "e1rmKg": 112.5, "e1rmUnreliable": false, "sets": [
          { "index": 0, "setType": "warmup", "weightKg": 60,    "reps": 8 },
          { "index": 1, "setType": "normal", "weightKg": 100,   "reps": 5, "rpe": 8, "pr": false },
          { "index": 2, "setType": "normal", "weightKg": 102.5, "reps": 3, "rpe": 9, "pr": true } ] },
        { "title": "Overhead Press (Barbell)", "e1rmKg": 70, "e1rmUnreliable": false, "sets": [
          { "index": 0, "setType": "normal", "weightKg": 60, "reps": 6, "rpe": 8, "pr": false } ] }
      ]
    },
    {
      "startedAt": "2026-07-13T16:40:00Z", "title": "Pull Day A",
      "derived": { "tonnageKg": 9110, "durationMin": 62, "workingSets": 20, "prs": [] },
      "annotation": { "sessionNotes": null, "quality": null, "focus": null,
                      "interpretation": null, "interpreted": false }
    }
  ]
}
```

Weights render kg with an optional lb toggle — never a unit-string baked into the data. Warmups muted,
working sets full-weight, PR sets accent-marked.

## Out of scope
No add/log-a-workout UI (ingestion only). No editing of Hevy facts (sets/reps/weights are read-only —
they come from Hevy). No editable `interpretation`/`focus` in the web (Claude's, via skill). No
big analytics dashboard, no per-body-part volume heatmaps, no calendar heatmap, no social/comparison
anything. No new tokens or fonts. Just the two `lifting` screens + the `lifting` nav entry, in the
established look.
