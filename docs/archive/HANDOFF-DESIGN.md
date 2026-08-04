# Handoff → Claude Design

## What this is
`justmy.website` is a private, single-user personal-data platform. One human (Curtis)
and one AI (Claude) are the only users. Everything sits behind auth — there are no
public pages. The first module is a **macro / food-intake tracker**; a shopping list
follows later. Your job is the **shell/chrome** plus a **visual reference** for the
macro module's components.

## Your deliverable is a REFERENCE, not production code
Code will be built separately by Claude Code as real Next.js 16 server components wired
to a database. You are producing the aesthetic and structural reference it builds from:
a self-contained artifact (single-file HTML/React is fine) that establishes the look,
the token values, and how the components read. Do not worry about data wiring, auth, or
Next.js specifics. Make it *look* and *feel* right and render against the mock data.

## Hard constraints (from `docs/UI-CONTRACT.md` — read it, conform to it)
- **Dark-mode-first.** Non-negotiable. Any light theme is derived from dark, not vice
  versa.
- **Use the exact token names** in UI-CONTRACT §1. You choose the *values* (the hex, the
  fonts, the spacing) — you own the aesthetic — but the variable *names* are fixed
  because Code references them.
- **Build the exact component inventory** in UI-CONTRACT §3, rendered against the mock
  `DayRollup` shape in §4. Names and the data they show are fixed; their visual
  treatment is yours.
- Numbers render in a mono/tabular face — this is a numbers instrument, digits align.

## The one idea that must come through visually
This tracker is **honest about fuzziness.** Curtis tells Claude what he ate in vague
terms ("a couple handfuls of almonds, a big chicken thigh") and Claude estimates. The UI
must never present an estimate as if it were a measured fact. Two places this shows up,
and both must be visible in your reference:

1. **The dual-target state.** A day can be `training` (~2,800 kcal), `rest` (~2,200), or
   `unspecified` (Curtis hasn't said). On an unspecified day, `DayRollup` shows BOTH
   targets — "on target if training, N over if rest" — not a silent default to one.
   This dual state is the single most important thing to get right; it's the visual
   embodiment of the whole product's honesty. Render it.
2. **The estimation marker.** Each entry is `measured`, `estimated`, or `logged_serving`.
   `DayRollup` surfaces what fraction of the day was estimated ("2,240 kcal · 40% est.").
   Make this legible but not alarming — it's information, not a warning.

## Aesthetic direction (your call, but here's the brief)
Follow the frontend-design skill. Take one real aesthetic risk you can justify. Avoid
the three AI-default looks (cream+serif+terracotta; near-black+acid-green; broadsheet
hairlines). The subject's world: cycling nutrition, calorie cycling, a rider hitting a
160g protein target on training vs rest days. The signature element should embody that —
the day-rollup is the natural hero. Spend your boldness there; keep everything else
quiet. Curtis rides trail and gravel, shoots and edits his own MTB video, is a
20-year engineer — the audience is technical, self-directed, allergic to anything that
feels like a consumer diet app. This is an instrument, not a coach.

## Out of scope
No workout logging (that's Strava/Hevy). No meal slots. No social/sharing anything. No
onboarding flow — it's a two-user private tool. Just the shell and the macro reference.
