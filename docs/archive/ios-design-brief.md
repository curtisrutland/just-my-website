> **Archived 2026-10-22.** This brief is consumed: the design is on the Claude Design canvas
> linked from `docs/ios-design-handoff.md`, which is now the build reference (#73, #74). Things the
> design changed from what's written below — Dynamic Type dropped, the Training icon, the HR zone
> colors, the added Replay view, shopping swipe-to-delete in v1, the darkened light-mode roles —
> are listed in the handoff's §9. Kept as the historical record; don't edit.

# Design brief → Claude Design: JustMy for iPhone (native)

The native iPhone app for justmy.website: the same six modules as the web UI, shown in a native
shell. This brief covers **v1 read views plus the three light writes** (`docs/ios-app.md` §6). The
spec, `docs/ios-app.md`, wins on any conflict; this brief is its §5.1 made concrete. Issue #71;
the build that consumes it is #73.

**This is a native pass, not a port.** The web design (`docs/UI-CONTRACT.md`, the tokens in
`src/app/globals.css`) is the reference for what things *mean*, not for how they're built. Don't
recreate the nav rail, the terminal header, or the web's card chrome in SwiftUI. Do keep the
product rules that make it this product (below). The deliverable is a **visual + structural
reference that a SwiftUI developer can build from with system components**: single-file artifact
is fine, iPhone-sized frames (402×874 pt, the iPhone 17 Pro), light and dark.

Everything below was checked against **real data** pulled from the live API on 2026-10-22
(excerpts in each screen section). Design for those numbers, not for a fitness-app screenshot.

---

## 1. What carries over, what goes native

### Carries over — product rules, not styling

1. **Honest about fuzziness.** An estimate is never shown as measured. Macros marks estimated
   entries and shows how much of the day is estimated; vitals shows `—` ("not measured"), never 0.
2. **Numbers are an instrument.** Every number uses tabular digits so columns align. Units are
   imperial for display (lb, mi, ft, mph, °F) even though storage is SI/kg.
3. **No verdicts.** No scores, streaks, rings, grades, "great job", or red alarms. The app reports;
   it doesn't judge. (Vitals: measurements, not verdicts. Rides: the log is the value.)
4. **The color roles**, with the web's values as the starting point (asset-catalog named colors,
   light + dark):

   | Role | Dark | Light | Used for |
   |---|---|---|---|
   | `Accent` | `#3AD0D6` | `#0E9AA0` | the one signature accent: chart lines, the ride route, selection. Used with restraint. |
   | `Success` | `#4EC97A` | `#2F9E57` | on target / within band |
   | `Warning` | `#E0A63A` | `#B07D1C` | approaching / over a ceiling |
   | `Over` | `#E5533F` | `#CC3D2A` | clearly over a ceiling |
   | `Band` | accent @ 12% | accent @ 12% | a target corridor or range fill |

   You may tune these for iOS contrast (they were picked for the web's near-black surfaces). The
   **roles and their names** are the contract; the hex values are a starting point.

### Goes native — structure

- **Navigation:** a four-tab `TabView`, a `NavigationStack` per tab, pushes for detail, sheets for
  entry and settings. No custom chrome.
- **Surfaces:** grouped lists / inset sections and system materials (Liquid Glass on iOS 27), not
  the web's `--color-surface` cards. Use system backgrounds; spend the brand colors on data only.
- **Type:** SF Pro + SF Mono, mapped to **Dynamic Type text styles** (everything must scale with
  the user's text size). The web's Space Grotesk / IBM Plex / JetBrains Mono don't come along.
- **Iconography:** SF Symbols only.
- **Gestures:** pull to refresh, swipe actions, sheets with detents, context menus. All standard;
  nothing invented.

### Decided already (don't redesign)

- Tabs: **Macros · Body (Weight | Vitals) · Training (Lifting | Rides) · Shopping**, with a
  segmented control at the top of Body and Training. Settings is a toolbar button, not a tab.
- The **pair** and **lock** screens exist (built in #72, functional and plain). Restyle them
  (§8), but keep the flow.
- The ride route uses **MapKit** (Apple Maps), not Leaflet. It's free in a native app and needs no
  key.
- **Macros has no under/in/over coloring in v1** (#49 is redesigning goal/floor/lever and is still
  open). Show each macro as a number against its target, neutrally. See §3.

---

## 2. Cross-cutting

**Type ramp.** Propose one, as Dynamic Type styles: a hero numeral (the one big number per screen),
section titles, body, captions, and the mono numeral styles. Hero numerals may use SF Mono or SF Pro
with `.monospacedDigit()`. Your call, but be consistent and keep digits tabular.

**States every screen needs** (design them once as shared patterns, then show where they land):

| State | When | Treatment |
|---|---|---|
| Loading (first) | the first fetch after unlock | skeleton rows in the real layout, not a centered spinner |
| Refreshing | pull to refresh, or return to the foreground | system refresh control; content stays visible |
| Offline / error | network failure | **keep the last data on screen** with a quiet banner ("Offline · showing 10:42 AM") |
| Empty | genuinely nothing (no rides this week, no entries today) | a plain sentence, no illustration |
| Not measured | a null value | `—` in the muted color, accessibility label "not measured" |
| Revoked | a 401 | handled by the app, which returns to the pair screen; nothing to design per screen |

**The day boundary is America/Chicago**, not the phone's zone. "Today" never moves when Curtis
travels. Dates read as `Wed, Oct 22`; times as `7:28 PM`.

**Privacy cover.** Whenever the app isn't frontmost it shows a cover (the app switcher must never
show data). Design that cover: plain, brand-quiet.

---

## 3. Macros tab — the day

**The one idea:** *honest about fuzziness.* Curtis tells Claude what he ate in words; Claude
estimates or pins it. The day view shows where he stands **and how much of that is estimated**.
The estimation fraction is the product's signature, so render it, don't bury it.

**Screen: Day** (`GET /api/macros/days/{date}` → `DayRollup`)

- **Hero:** calories eaten vs. target (`2,409 / 2,600 kcal`) and what's left (`191 left`).
- **The four macros** against target: calories, protein, fat, carbs. **Neutral in v1**, so no
  green/amber/red per macro. Over-target is shown as a number ("+27 g"), not a color. Design so the
  #49 treatment can drop in later (protein is a *floor*, fat a *ceiling*, carbs the *lever*),
  without re-laying the screen.
- **Estimation:** `11% estimated · 3 of 15 entries`. Each estimated entry is visibly marked.
- **Entries:** a list (name, grams, kcal, and the confidence mark). Tap → a sheet with the entry's
  full macros and its `note` (the words Curtis actually said).
- **Paging:** swipe horizontally between days; a toolbar date picker jumps; a "Today" button
  returns. The title shows the date.
- **No add button.** Food logging is Claude's job (the `manage-macros` skill); the app reads.

Real data (2026-10-21, 15 entries):

```json
{ "totals": { "calories": 2409.1, "proteinContent": 186.5, "fatContent": 71.7, "carbohydrateContent": 258.1 },
  "target": { "calories": 2600, "proteinContent": 160, "fatContent": 75, "carbohydrateContent": 295 },
  "estimation": { "estimatedFraction": 0.115, "entryCount": 15, "estimatedCount": 3 },
  "entries": [ { "name": "Nutricost whey iso (smoothie)", "quantityGrams": 40, "confidence": "measured", "calories": 148.6, "proteinContent": 34.3, "note": null }, "…" ] }
```

Things to handle:
- **Protein over target is the normal case** (186 of 160). Show it calmly.
- **Long names** (`Icelandic Provisions whole milk skyr (smoothie)`).
- **A `null` target:** before any target profile existed.
- **Rounding:** kcal whole, grams whole on the list and one decimal in the detail.

---

## 4. Body tab — Weight | Vitals

### Weight

**The one idea:** *the trend is the truth.* A single weigh-in swings ±1–2 lb. Lead with the 7-day
average and its rate; daily numbers are subordinate scatter.

**Screen: Weight** (`GET /api/weight/rollup?window=` → `WeightRollup`, `GET /api/weight/entries`)

- **Hero:** `250.9 lb` (7-day average) and `−2.6 lb/wk` (trend). The rate is neutral, so no green
  for losing. The direction arrow is fine.
- **Chart** (Swift Charts): daily points as subordinate dots, the 7-day average as the line, with
  the window's range. Window picker: **30 · 90 · 365 · All**. Gaps (unlogged days) are gaps, not
  interpolated.
- **Recent entries:** date, weight (one decimal), and the delta from the previous entry.
- **`+` in the toolbar → Log weight sheet** (one of the three v1 writes): a big decimal number
  field (lb), date (default today), and an optional note. Logging is an **upsert per day**: if
  today already has an entry, the sheet shows it and says the new number replaces it.

Real data: `summary { currentAvg: 250.9, current: 250, trendPerWeek: -2.6, range: {min: 249.2, max: 261.4}, window: 30 }`,
109 weigh-ins since July, near-daily.

### Vitals

**The one idea:** *measurements, not verdicts.* What the watch measured overnight and through the
day. No readiness score, no Body Battery, no sleep grade. They don't exist in this data on
purpose.

**Screen: Vitals** (`GET /api/vitals/summary?window=` → `VitalsRollup`, `GET /api/vitals`)

- **Three trends:** resting HR, HRV, and sleep duration. Each shows its current value, its 7-day
  average, and the week-over-week change as a plain number (`+1 bpm/wk`), with a small sparkline.
  Window: **14 · 30 · 90 · All**.
- **Gaps strip:** days with no data, stated as fact ("no data Oct 3").
- **Days list**, newest first → **Day detail** (push): the **sleep stage bar** (deep / light / REM
  / awake as four segments, labeled as *Garmin's classification*), total sleep, overnight SpO2 and
  respiration, HRV, resting HR, steps.

Real data (2026-10-22): sleep `7:44` (deep 0:59 · light 5:07 · REM 1:39 · awake 1:03), HRV 51 ms,
RHR 47 bpm, SpO2 96%, respiration 14 /min, **steps 46**. Today is a partial day: the morning sync
has the night but almost none of the day. Design today's row so a low step count reads as "day in
progress," not as a bad day.

Units: sleep `h:mm`, HRV `ms`, HR `bpm`, SpO2 `%`, respiration `/min`, steps with a thousands
separator.

---

## 5. Training tab — Lifting | Rides

**Default segment: Rides.** Lifting is deliberately paused (see below), so open on what's active.
Remember the last segment chosen.

### Rides

**The one idea:** *the log is the value.* A calm, chronological record of what was ridden. No
hero, no fitness score, no streaks. (Unchanged from the web rides brief, `docs/archive/rides-design-brief.md`;
read its STOP section, all of it still applies.)

**Screen: Ride log** (`GET /api/rides` paged, `GET /api/rides/weekly`)
- **Weekly strip:** the last few weeks' rides, distance, moving time, and ascent. Quiet bars or
  numbers; no goal line.
- **Ride cards:** the title (the ride's `name`, else `sportProfileName` + date → **"GRAVEL — Oct
  21"**), local start time, moving time, distance, ascent, and avg HR. Paged as you scroll.

**Screen: Ride detail** (`GET /api/rides/{id}?streams=1` → `RideDetail`)
- **Map:** the route on **MapKit** from the stream's `lat`/`lon`. Indoor rides have no GPS, so no
  map section at all.
- **Stat band:** moving time (elapsed only if it differs), distance, ascent/descent, avg/max HR,
  avg speed, and calories. Sections for absent channels **disappear**: no power meter means no
  power, anywhere.
- **HR zone bar:** time per zone as one horizontal bar, labeled by **bpm range** from the ride's
  own boundaries, in a muted single-hue ramp (not green-to-red).
- **Charts** (Swift Charts): elevation, HR, and speed against time. `null` buckets are visible
  gaps.
- The ride's `note`, if any, as prose.

Real data: recent rides are **short, unnamed, `GRAVEL` profile, no power**. For example: 16 min,
4.37 km (2.7 mi), 24 m (79 ft) ascent, avg HR 115, zones
`[26, 220, 459, 252, 3, 0, 0]` s. Weekly: `{ weekStart: 2026-10-19, rides: 4, distance 33.9 km, moving 2:37, ascent 330 m }`.
Convert: mi one decimal, ft whole, mph one decimal.

### Lifting

**The one idea:** *the numbers are Hevy's; the meaning is ours.* On a session, the cold, precise
set table sits beside Claude's warm, editorial interpretation. That juxtaposition is the module.
(See `docs/archive/lifting-design-brief.md`.)

**Lifting is dormant right now, and that's the plan.** The current goal (Oct 12) says Curtis isn't
lifting until winter, and "an absence of lifting sessions is the plan, not a lapse." The last
session is **Sep 28**. So:
- The list must not nag. No "it's been 24 days," no empty-streak guilt.
- Show the **current goal** at the top of the list as prose. It's long (several paragraphs), so
  give it a collapsed form with "more."

**Screen: Sessions** (`GET /api/lifting/sessions`): session cards with the title (`Session A — Hinge
+ Horizontal`), date, duration, tonnage (whole lb), top e1RM (whole lb), PR count, and focus, plus a
quiet "needs a read" marker on uninterpreted sessions.

**Screen: Session detail** (`GET /api/lifting/sessions/{id}`):
- The **set table**: exercise → sets, weight in **whole lb** (kg is storage; 18.14 kg *is* 40 lb),
  reps, and PR marks. Duration-only sets (warm-up: `313 s`) read as time.
- The **interpretation**: Claude's prose read, several sentences. It's the editorial half; give it
  room.
- Each lift's **e1RM sparkline**; tap → the lift's full progression (`GET /api/lifting/lifts/{templateId}`).
- Curtis's own session notes and quality (1–5), if present.

Real data: 3 recent sessions, tonnage 2,268–5,375 kg (5,000–11,850 lb), top e1RM 66.5–69.6 kg
(147–153 lb), 36–40 min, 0–5 PRs. All interpreted.

---

## 6. Shopping tab

**The one idea:** *a working utility, not a dashboard.* A calm, dense, grouped list, tuned for
**adding** and **checking off** in a store with one hand. (See `docs/archive/shopping-design-brief.md`.)

**Screen: List** (`GET /api/shopping/list` → `ShoppingList`)
- Items **grouped by category**, categories alphabetical. Each row is the freeform `text`, which
  carries its own quantity and notes.
- **Check off:** tap the row or its checkbox. It should feel satisfying (a light haptic and a
  brief strike-through), then the item moves to **Recently bought** (the last 7 days, newest
  first), where tapping it un-checks it. It's optimistic, with a quiet revert if the server says
  no.
- **Add:** an add field pinned above the keyboard or at the bottom: category (pick from the
  existing categories, or type a new one) plus text. One hand, few taps.
- The header readout: `19 on the list`.
- **No edit or delete in v1** (phase 2 adds them as swipe actions; leave room).

Real data: 19 items across Frozen 1 · Household 2 · Meat 4 · Pantry 8 · Pet 1 · Produce 3. Text is
long and specific:
`Wei-Chuan frozen lemongrass, 7oz - freezer aisle near the dumplings`,
`pint mason jars - a few, for salsa macha and small batches`. Rows must wrap gracefully at 2–3
lines.

---

## 7. Settings sheet

Server address (mono), the lock rule ("after 5 min in the background"), **Unpair this iPhone**
(destructive, with confirm), and the version. It's plain by design; just make it belong.

## 8. Pair and lock screens

Built and working in #72; restyle them.

- **Pair:**
  - **Scan pairing code** is the primary action (the QR comes from `/settings/devices` on the web).
  - Paste is the fallback, with a server field used only for a bare token.
  - The notice "This iPhone's token was revoked. Pair it again to continue." appears after a
    revocation.
- **Lock:** the app name, a Face ID unlock button (unlock also triggers on appear), and an error
  line.
- **Privacy cover**, from §2.

## 9. The app icon

A mark for "JustMy," calm and instrument-like, consistent with the accent. Supply the 1024×1024
master plus the iOS 27 light, dark, and tinted variants.

---

## 10. Out of scope (don't design)

- Food logging; adding rides or lifts. Those arrive from Claude, the Garmin daemon, and Hevy.
- Edit and delete everywhere (phase 2, #76). Leave room for swipe actions and an edit sheet.
- Widgets, Live Activities, Siri, HealthKit, notifications, and a cross-module "Today." These come
  after parity (spec §9).
- iPad and Watch layouts. iPhone only.
- Any score, streak, ring, badge, or goal celebration.

## 11. What to deliver

1. **Tokens:** the named colors (light + dark, with any contrast tuning noted), the Dynamic Type
   ramp, and the mono numeral styles. These are what the build references by name.
2. **The shared state patterns** (§2): loading skeleton, refreshing, offline banner, empty, not
   measured, privacy cover.
3. **Each screen**, light and dark, against the real data above:
   - Macros: the day, plus the entry sheet.
   - Weight, plus the log-weight sheet.
   - Vitals, plus the vitals day detail.
   - The ride log, plus a ride detail with the map.
   - Lifting sessions, plus a session detail.
   - The shopping list, including the check-off moment and the add flow.
   - Settings, pair, and lock.
4. **Edge states**, at least:
   - an empty macros day;
   - a null target;
   - a ride with no GPS;
   - a vitals day with nulls;
   - the dormant lifting list;
   - an empty shopping list;
   - the largest Dynamic Type size on the macros day.
5. **The app icon.**

Bind to the field names in the response views (`src/lib/{module}/schema.ts`, the "Response views"
sections added in #82; the generated Swift types carry the same names). If a screen needs a
field that isn't there, **flag it as a contract change**; don't
invent it.
