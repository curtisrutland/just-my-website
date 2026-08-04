# Design brief → Claude Design: Weight tracker (justmy.website)

A **second module** for justmy.website. **Reuse the existing design system you already built** for
this project — the exact same tokens (`--color-*`, `--font-*`, `--radius`, `--band`), the dark-mode-
first look, the mono/tabular numbers, and the `AppShell` chrome (210px nav rail + terminal header).
This module just adds a `weight` nav entry (LIVE) and one new page. Don't invent a new aesthetic;
extend the one that's there. Produce a **visual + structural reference** (single-file artifact is
fine), rendered against the mock data below.

## The one idea that must come through visually
A single day's body weight is **noise** — it swings ±1–2 lb from water/food/glycogen. The **trend**
is the truth. This module is honest about that: it **leads with the smoothed 7-day rolling average**,
and the daily numbers are shown as subordinate scatter. This mirrors the macro module's honesty-
about-fuzziness — same family, different axis. **Get this into the hero.**

## The signature element: `WeightTrend` (the hero — spend your boldness here)
A time-series chart over a window (default 90 days):
- **Daily raw weigh-ins** → small, **muted** dots (`--color-text-muted`). The noise.
- **The 7-day rolling-average line** → the **accent** (`--color-accent`). The truth. This is what the
  eye follows. It's the hero mark, the weight-module equivalent of the DayRollup honest-corridor.
- A big **current 7-day-avg** number in `--font-mono`, with the **trend rate** ("−0.6 lb/wk") and the
  raw current weight as a smaller secondary figure.
- A window selector (30 / 90 / 365 / all).
- Missed days (gaps) are normal — the average line carries through them; there's just no dot.

## Supporting components (quieter — reuse existing patterns)
- **`WeightStat` tiles** — small mono stat cards: current 7-day avg, trend (lb/wk), latest raw,
  range (min–max) over the window.
- **`WeightEntryForm`** — a single number input for *today's weight* (lb) + optional note → save.
  (Web entry IS allowed for weight — it's one number.) Prefilled if today's already logged.
- **`WeightList` / `WeightRow`** — recent days: date + raw weight (mono) + optional note, each
  correctable/deletable inline (same treatment as the macro `EntryRow`).

Page layout, top to bottom: entry field → `WeightTrend` hero → `WeightStat` tiles → `WeightList`.

## Color / tone
Down-trend is generally the goal here, but **keep it calm — information, not judgment.** Trend rate
can use `--color-success` (down) / `--color-over` (up) sparingly; don't turn it into a scold. Numbers
in `--font-mono` tabular. Dark-mode-first; light derived.

## Mock data (render against this)
A ~90-day daily series with realistic noise around a gentle downward trend (≈183 → ≈177 over the
window), a few gaps. Shape:

```jsonc
{
  "summary": { "currentAvg": 178.4, "current": 177.6, "trendPerWeek": -0.6,
               "range": { "min": 176.9, "max": 183.2 }, "window": 90 },
  "series": [ { "date": "2026-04-07", "weight": 182.4, "avg": 182.7 },
              { "date": "2026-04-09", "weight": null, "avg": 182.1 }  /* gap: avg carries */ ],
  "entries": [ { "measuredOn": "2026-07-05", "weight": 177.6, "note": "morning, fasted" } ]
}
```

## Out of scope
No macro/food content (that's the other module). No goal-weight lines or coaching. No new tokens or
fonts. Just the weight page + its `weight` nav entry, in the established look.
```
