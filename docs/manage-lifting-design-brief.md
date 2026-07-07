# Design Brief: `manage-lifting` read UI (justmy.website)

**Audience:** Claude Design. **Author:** Claude (chat), with Curtis.
**Status:** design spec. Companion to two docs — read both as context:
- **`manage-lifting-contract.md`** — the API you consume. **Every number and list on every screen
  comes from an endpoint defined there.** Do not invent response fields; if a screen seems to need
  data the contract doesn't provide, flag it as a contract change, don't fabricate it.
- **`manage-lifting-handoff.md`** — the code agent's brief (backend + skill). Context only; you
  don't implement it. It owns the contract.

---

## 1. What this UI is (and isn't)

A **read-only dashboard with exactly one write: importing a Hevy CSV.** That constraint is
deliberate and firm.

**Not in scope — do not design any of these:**
- No manual data entry, no add-a-set / add-a-workout forms.
- No editing or correcting stored data. No delete. No inline edits.
- No settings beyond what import needs. No auth screens (Clerk handles that).
- Not an analysis rebuild of Hevy — Hevy already has dashboards and form video. This UI is the
  *glanceable, non-conversational* window onto the same data, plus the import mechanism. The deep
  reasoning surface is Claude-in-chat via the skill; the UI is the at-a-glance view for the phone.

**Primary device: phone.** Curtis checks this on mobile. Design mobile-first; desktop is the
widened version, not a different layout.

**Dark mode by default** (platform-wide preference). Match the existing justmy.website visual
language — this is a new module *inside* an existing app, not a standalone product. Reuse the
app's existing type scale, spacing, surface colors, and nav patterns.

---

## 2. Charts

Charts are in scope. **Match the style and approach of the weight-tracker module's line chart —
not strict reuse of that component.** Build siblings in the same visual language (same SVG-rendered
approach, same axis/gridline/stroke treatment, same dark-mode palette), so the lifting screens feel
like the same app. Don't introduce a new charting library or a second charting stack; if the weight
tracker's chart is already a generic shared piece you can extend cleanly, great, but the instruction
is *stylistic consistency*, not forced dependency on that exact file.

Two chart types are needed:
- **Line chart** — per-exercise trend (§4.3). Same family as the weight tracker's.
- **Bar chart** — muscle-group volume per week (§4.5). Same visual language, grouped/stacked bars.

---

## 3. Screen inventory

Five surfaces. Keep it to these; resist scope creep.

1. **Import** — the only write.
2. **Recent workouts** — session list (likely the home/landing view).
3. **Exercise trend** — pick a lift, see its line.
4. **Stalls** — the progressing/flat/regressing panel.
5. **Muscle volume** — weekly bar chart.

On phone these are best as a **single scrollable dashboard** — Recent workouts, Stalls, and Muscle
volume stack as sections — with **Exercise trend as the one drill-in** (tap a lift → its own view →
back). That's the whole nav model: a page with sections, plus one page-local detail view.

**Important platform context: this is the first multi-screen module on justmy.website.** Every
existing module (macros, weight, shopping) is a single screen, so **no app-shell / global-nav
pattern exists yet, and this module must not establish one as a side effect.** Do **not** introduce
a bottom tab bar, a global nav rail, or any app-level chrome — those are platform decisions that
shouldn't be made implicitly by one module, and would force every other single-screen module to
answer "what are my tabs?" Keep everything **self-contained to this module's page**: a scrolling
dashboard + one drill-in makes no claim on the app shell and is trivially consistent with the
single-screen modules sitting next to it. If a global-nav pattern is ever wanted, that's a separate,
deliberate platform decision — flag it, don't bake it in here.

---

## 4. Screen specs

### 4.1 Import  *(POST /api/lifting/import)*
- File picker + drag/drop for one Hevy CSV. Nothing else.
- On success, echo the import summary **verbatim from the response**: inserted / updated /
  unchanged / workouts_seen.
- **`unmapped_exercises` must be surfaced prominently, not buried** — if non-empty, show a clear
  callout: "New exercise not yet categorized: *Barbell Squat*. It's stored and appears in trends,
  but won't count toward muscle-group volume until mapped." This callout is the UI's job precisely
  because it's the one place a new lift needs attention (see contract import note). Show `warnings` if present.
- Empty/first-run state everywhere else points here ("Import your Hevy export to get started").

### 4.2 Recent workouts  *(GET /api/lifting/recent-workouts?limit=n)*
- List, most recent first. Each row: session `title`, date, total volume (lbs), set count, duration.
- Secondary line or expandable: the `exercises` list for that session.
- This is the "am I actually hitting A/B/C ~3×/week" glance — make cadence legible (date prominent).

### 4.3 Exercise trend  *(GET /api/lifting/exercises then /exercise-history?exercise=)*
- An exercise picker (from `/exercises`), then a **line chart** of that lift over time.
- **Y-axis depends on `kind`** — the contract's per-kind signal rules are load-bearing here:
  - `weighted` → plot `e1rm` where present, else `top_weight_lbs`. Label the axis accordingly.
    Show `top_weight_lbs × top_reps` as the point tooltip/context.
  - `bodyweight` → plot `top_reps`. Axis is "reps," **not** weight. No lbs anywhere.
  - `timed` → plot `top_duration_s`. Axis is "seconds/hold." No lbs, no e1RM.
- **Never render an lbs/e1RM axis for bodyweight or timed exercises.** e1RM is `null` for those by
  design — don't plot nulls, don't show a blank weight axis.
- Mark `is_pr` points visually (a dot/badge on the line).

### 4.4 Stalls  *(GET /api/lifting/stalls)*
- Arguably the most valuable screen — it's what Curtis acts on. Make it scannable.
- One row per exercise: display name, `best_signal` **labeled by `best_signal_label`** (e1RM / top
  weight / reps / hold — the label comes from the API, use it, don't hardcode "lbs"), best in last
  30d, sessions since PR, and the `trend` as a clear visual state.
- **Trend is the signal:** `progressing / flat / regressing` should read at a glance — color +
  icon (e.g. up / flat / down). Sort or group so `regressing` and `flat` surface at the top; a
  stalled lift is the thing worth seeing first.
- Show `trend_window_sessions` somewhere subtle so the flag's basis is legible.

### 4.5 Muscle volume  *(GET /api/lifting/muscle-volume?weeks=n)*
- **Bar chart**, weekly volume per muscle group, same visual language as the weight chart.
- **The `unmapped` bucket is always rendered when present** (contract puts it last) — give it a
  visually distinct/muted treatment and a tap affordance explaining it's uncategorized lifts. Never
  hide it; its whole purpose is to make new-but-unmapped volume visible rather than silently missing.
- Week count selectable (e.g. 4 / 8 / 12 weeks) if cheap; otherwise a sane default.

---

## 5. States every screen must handle (from contract §"Empty / edge states")
- **Before first import:** endpoints return empty arrays, not errors. Show empty states that point
  at Import. Don't show broken charts or "0 lbs" axes.
- **Timed/bodyweight exercises:** no lbs axis, no e1RM, no volume-in-lbs. The kind drives the render.
- **Unmapped-only muscle weeks:** a week whose only bucket is `unmapped` must still render sensibly.
- Loading + error states consistent with the rest of justmy.website.

---

## 6. Explicit non-goals (guardrails)
- No write surface beyond CSV import. If a design instinct adds an edit/delete/add affordance, cut it.
- **No app-shell / global-nav pattern** (no bottom tab bar, no nav rail, no app-level chrome). This
  is the platform's first multi-screen module; keep the nav self-contained to this module's page
  (scrolling dashboard + one drill-in). A global-nav pattern is a deliberate platform decision, not
  a byproduct of this build — flag it if you think it's needed, don't introduce it here.
- No new charting dependency — match the weight tracker's approach.
- No feature the skill already does better in chat (deep querying, cross-metric reasoning). The UI
  is glance + import. When in doubt, simpler.
