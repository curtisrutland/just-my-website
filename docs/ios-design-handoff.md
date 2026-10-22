# Design handoff → build: JustMy for iPhone (native)

The design for the native iPhone app, settled on 2026-10-22 against the design brief
(archived at `docs/archive/ios-design-brief.md`) and `docs/ios-app.md`. Issue #71 is the design; the
build that consumes this is #73 (read views) and #74 (light writes). The spec wins on any
conflict; where the design changed the spec, §9 of this doc lists the amendment and `ios-app.md`
carries it.

**The visual reference is the Claude Design canvas:**
<https://claude.ai/code/artifact/fd0160f7-9fcf-464d-9528-ef4edd1fabad>. Every artboard is plain
HTML (`project/*.dc.html` in the canvas's files); read the markup for exact spacing, sizes and the
chart math rather than working from screenshots. Boards are iPhone 17 Pro frames (402 × 874 pt)
unless noted; two detail boards are drawn at full scroll length.

Every screen was designed against **real data pulled from the live API on 2026-10-22**, and the
field names used below are the response views' names (`src/lib/{module}/schema.ts`).

---

## 1. Principles that survived from the web

1. **Honest about fuzziness.** Estimates are marked, the estimated fraction is rendered, nulls
   are `—` (never 0, never hidden).
2. **Numbers are an instrument.** Every number is `.monospacedDigit()`. Imperial for display.
3. **No verdicts.** No scores, streaks, rings, grades, red alarms. A week-over-week change is a
   signed number in `secondaryLabel`.
4. **Nothing is custom chrome.** Stock `TabView`, `NavigationStack`, `List` / inset grouped
   sections, sheets with detents, `.swipeActions`, `.refreshable`. Liquid Glass comes from using
   the system components and not styling them — no custom tab bar, no `.background` on toolbar
   items.

Dynamic Type is **not a requirement** (single user, default text size). Still use the system
text styles (`.body`, `.footnote`, …) because they're the default API; just don't build
accessibility-size layouts or test them.

## 2. Tokens

### 2.1 Named colors (asset catalog, light + dark)

Roles and names are the contract shared with the web. Light values were **darkened** so text
passes 4.5:1 on `systemGroupedBackground` (`#F2F2F7`), not just on white; dark values are the
web's.

| Name | Dark | Light | Used for |
|---|---|---|---|
| `Accent` | `#3AD0D6` | `#0A7278` | App tint. Chart lines and sparklines, the ride route, selection, the `≈` estimate mark, the estimation strip. Never a fill behind text. |
| `Success` | `#4EC97A` | `#1E7342` | On target / within band: calories landed, protein floor cleared. |
| `Warning` | `#E0A63A` | `#845D12` | Approaching / over a ceiling. |
| `Over` | `#E5533F` | `#BF3523` | Clearly over a ceiling. |
| `Band` | Accent @ 12% | Accent @ 12% | A target corridor or range fill; the only tinted fill. |

Everything else is a system color: `systemGroupedBackground`, `secondarySystemGroupedBackground`
(cards), `tertiarySystemGroupedBackground` (cards inside a sheet), `label`, `secondaryLabel`,
`separator`, `systemFill` (neutral tracks).

### 2.2 Chart scales (categorical and ordinal data)

These use the **iOS system colors**, deliberately off-token: they are the scale everyone already
reads, and `Color.indigo` etc. adapt to light/dark on their own. Success/Warning/Over are
reserved for state-against-target and are never chart series.

| Scale | Values |
|---|---|
| Sleep stages (categorical) | Deep `Color.indigo` · Light `Color.blue` · REM `Color.purple` · Awake `Color.orange` |
| HR zones (ordinal) | below Z1 `systemGray` @ 45% · Z1 `systemGray` · Z2 `Color.blue` · Z3 `Color.green` · Z4 `Color.orange` · Z5 `Color.red` · above max → same as Z5. `Color.yellow` is the spare step if a profile ever carries six zones. |
| Macros budget (energy by source) | Protein `Accent` · Fat `Color.pink` · Carbs `Color.yellow` (`#E5B800` in light). Source hues only; state lives in the ticks and the delta text. |
| Everything else | Single hue: Accent line (and a 12% Accent area under ride charts) on a `secondaryLabel` ground. |

### 2.3 Type ramp (text styles)

SF Pro throughout; SF Mono only for machine strings.

| Role | Style |
|---|---|
| Hero numeral | `.system(size: 44, weight: .semibold).monospacedDigit()`, letter-spacing −0.6. One per screen. |
| Hero unit / target / remainder | `.body`, `secondaryLabel`, baseline-aligned to the hero |
| Screen title | `.largeTitle` (navigation bar). Dates read `Wed, Oct 21`. |
| Sheet / detail title | `.title2.bold()` |
| Trend value (vitals, weekly strip) | `.system(size: 28, weight: .semibold).monospacedDigit()` |
| Stat tile value | `.title2` semibold (22) / `.title3` semibold (20) in 4-up bands |
| Row label | `.body` |
| Row value | `.body.monospacedDigit()`; units in `.footnote` `secondaryLabel` |
| Macro label, delta, rate | `.subheadline.monospacedDigit()` `secondaryLabel` |
| Caption, section header, banner | `.footnote` `secondaryLabel`; headers uppercased, letter-spacing 0.4 |
| Machine string | SF Mono `.footnote` `secondaryLabel` — server address, version |

### 2.4 Shape and spacing

Cards are inset grouped sections with 26 pt radius (22 on the dense shopping list); 16 pt side
margins; 18/16 pt card padding; rows min 44 pt with `11 16` padding; hairline separators inset
to the content. Section headers sit 16 pt in from the card edge. Glass toolbar buttons are 44 pt
circles; the "Today" button is a 44 pt capsule.

## 3. Shared state patterns (States board)

| State | Treatment |
|---|---|
| Loading, first fetch | Skeleton blocks in the real layout (hero, three macro rows, the strip), pulsing 1.3 s. No centered spinner. |
| Refreshing | System `.refreshable`; content stays. Also refetch on return to foreground. |
| Offline / error | Keep the last data. One quiet banner under the title: `Offline · showing 10:42 AM` — `secondarySystemGroupedBackground`, 12 pt radius, wifi-slash symbol, `.footnote`. A validation `400` shows the server's message in the same banner. No modal, no red. |
| Empty | One plain sentence where the content would be (`Nothing logged yet today.`). No illustration. |
| Not measured | `—` in `secondaryLabel`, `accessibilityLabel("not measured")`. |
| Revoked (`401`) | App-level: back to the pair screen with the revoked notice. |
| Privacy cover | `systemBackground` + the wordmark `JustMy` in `secondaryLabel` `.title2` semibold, centered. Shown whenever the app isn't frontmost. |

The day boundary is `America/Chicago`. Dates `Wed, Oct 21`; times `7:28 PM`.

## 4. Navigation

Four tabs: **Macros** `fork.knife` · **Body** `figure` · **Training** `figure.outdoor.cycle` ·
**Shopping** `cart`. Body and Training have a segmented control under the large title
(Weight | Vitals; Lifting | Rides — Rides is the default and the last choice is remembered).
Settings is a leading toolbar gear on each tab's top screen, presenting a medium sheet.

## 5. Screens

### 5.1 Macros › Day (`GET /api/macros/days/{date}` → `DayRollup`)

Boards: `Main`, `MacrosDay-Light`, `MacrosEntry-Dark/Light`, `MacrosNullTarget-Dark`.

- **Nav:** large title = the date. Trailing: calendar glass button (date picker) and `Today`
  capsule (hidden when already on today). Horizontal swipe pages days.
- **Rollup card** (one inset section) — the **budget**. Boards `MacroBudget` (four real days)
  and `MacroColorOptions` (the directions that were rejected) show how it was chosen.
  - Hero line: `2,409` (hero numeral) `/ 2,600 kcal` (body, secondary) left; the calorie state
    right, baseline-aligned (below).
  - **The budget bar**, 10 pt, radius 5: a track that runs to **115% of the calorie ceiling** (so
    an overshoot has room). It fills left to right with the day's energy **by source**: protein
    in `Accent`, fat in `Color.pink` (`#FF375F`), carbs in `Color.yellow` (`#FFD60A` dark,
    `#E5B800` light), 4/9/4 kcal per gram, scaled so the three segments sum to the logged
    `calories`. Two 2 pt white ticks with 11 pt labels under them: **floor** at
    `proteinContent target × 4 × scale` and **ceiling** at 100%. A `Band` tint behind the track
    from 95% to 100% is the landing zone.
  - **Calorie state** (the ceiling is also the goal): under 95% → `191 left` in secondary; 95–100%
    → `landed · 26 left` in `Success` semibold; over → the overflow is drawn past the ceiling
    tick as a solid stub and the delta reads `+387 over`, both in `Warning` up to 3% over and
    `Over` beyond.
  - **Protein row**: Accent legend dot, `187 / 160 g`, and the floor state in a fixed 110 pt
    column: `cleared · +27 g` in `Success` once `proteinContent ≥ target`; while short on the
    current day, `45 g to floor` in secondary (not a finding yet); short on a past day,
    `12 g short` in `Warning` (a hard finding).
  - **Levers row**: fat and carbs are **not goals** and never get "left" / "over" / a color
    judgment. Legend dots + `72 g fat · 258 g carbs`, then a 6 pt **balance bar**: fat's share of
    lever calories (`fatContent × 9 / (fatContent × 9 + carbohydrateContent × 4)`) in pink, the
    rest in yellow, with a white tick at the guideline's share (same formula over the targets).
    Caption `fat 38% of the levers · guide 36%` left, `guide 75 / 295 g` right.
  - Hairline, then the **estimation row**: `≈` in Accent, `11% estimated` Accent semibold,
    `· 3 of 15 entries` secondary; beneath it the **estimation strip** — one 6 pt segment per
    entry, 3 pt gaps, estimated entries in Accent, the rest `systemFill`. This is the signature;
    don't drop it.
  - This **settles #49 for the app**: one goal (calories, a ceiling), one floor (protein), two
    levers judged only for balance. Thresholds — 5% landing zone, 3% Warning/Over split — are
    the app's; the web can follow.
- **Entries section** header `ENTRIES · 15`. Rows: `name` in `.body` (wraps), subtitle
  `.footnote` secondary `240 g`, plus ` · ≈ estimated` in Accent when `confidence ==
  "estimated"`, or ` · serving` in secondary when `logged_serving`. Trailing `441` tabular
  `.body` + `kcal` footnote. kcal whole, grams whole. No chevron; tap presents a sheet.
- **Entry sheet** (medium detent, grabber, glass close button): title = `name` `.title2.bold()`,
  subtitle `250 g · ≈ estimated`; one section with the eight macros, one decimal, nulls as `—`
  with the label dimmed (`Fiber`, `Sugar`, `Sodium` (mg), `Saturated fat`); a `HOW IT WAS
  ESTIMATED` section showing `note` in quotes (section omitted when `note` is null) with the
  footnote *Claude's note on the entry. Correct it by telling Claude; the app doesn't edit food.*
- **Null target:** hero is `2,409 kcal · no target yet`; the budget bar is the same bar as pure
  proportions (full width, no ticks, no band); protein is a bare `187 g`; the balance bar has no
  guide tick and reads `no guide`; one footnote: *No target applies to this day — the first
  target profile starts later. Numbers only; nothing to compare against.* The estimation row stays.
- **Rounding:** kcal whole; grams whole on the list, one decimal in the sheet.
- No add button. Food logging is Claude's.

### 5.2 Body › Weight (`GET /api/weight/rollup?window=`, `GET /api/weight/entries`)

Boards: `Weight-Dark/Light`, `WeightLog-Dark`.

- **Trend card:** hero `250.9` + `lb`; right: `↓ 2.6 lb/wk` (arrow symbol + number, secondary —
  direction only, no color). Caption `7-day average · today 250.0 lb · last 30 days 249.2–261.4`.
  Window picker (`30 · 90 · 365 · All`, a small segmented control) right-aligned above the chart.
- **Chart (Swift Charts):** daily `weight` as 2.5 pt dots at `secondaryLabel` 45%; `avg` as a
  2.5 pt Accent line; horizontal gridlines at round values with trailing labels; first/last date
  under the axis. Gaps stay gaps (no interpolation). Chart height 168.
- **Recent weigh-ins:** rows `Today, Oct 22` / `250.0 lb` / delta from the previous entry in a
  fixed 44 pt secondary column (`+0.6`, `−3.2`, `0.0`).
- **Log weight sheet** (`+` trailing glass button → `POST /api/weight/entries`): its own bar
  with `Cancel` / `Log weight` / `Save` (Save semibold). A `WEIGHT` card with a 44 pt decimal
  field + `lb` (decimal pad); a two-row section: `Date` with a compact date chip (default today)
  and `Note` (placeholder *Optional*). Footnote, when today already has an entry: *Today already
  has 250.0 lb, logged at 8:09 AM. Saving replaces it — one weigh-in per day.* The route is an
  upsert and returns `200`.

### 5.3 Body › Vitals (`GET /api/vitals/summary?window=`, `GET /api/vitals`, `GET /api/vitals/{date}`)

Boards: `Vitals-Dark/Light`, `VitalsDay-Dark`, `VitalsDayNulls-Dark`.

- **Nav:** window picker (`14 · 30 · 90 · All`) trailing in the toolbar.
- **Trends card:** three rows (`Resting heart rate`, `HRV, last night`, `Sleep`), each: label
  footnote; current at 28 pt + unit; `7-day 46.7 · +1 bpm/wk` footnote; a 104 × 40 Accent
  sparkline with a dot on the last point, right. Sleep in `h:mm` everywhere (`7:44`, `+1:15/wk`).
  HRV delta rounds to a whole ms.
- **Gaps:** a footnote under the card. With gaps: `No data Oct 3 · Oct 7`. Without: *Every day
  since Oct 9 has data. Week-over-week change is a plain number — there is no score.*
- **Days list**, newest first: `Today, Oct 22` / `7:44 sleep · 51 ms · 47 bpm · 62 steps so
  far`. The partial day says `so far`; others say `steps`. Chevron → push.
- **Day detail** (inline title = the date, back to Body):
  - **Sleep card:** hero `7:44` + `asleep`; the window `10:56 PM – 7:44 AM` right (from
    `sleepStartAt`/`sleepEndAt`, local); a 14 pt **stage bar** (deep/light/REM/awake widths over
    the four stage sums, 2 pt gaps, radius 4) in the sleep scale; a 4-column legend with dot,
    name and `h:mm`; footnote *Stages are Garmin's classification. No sleep score exists here.*
  - **OVERNIGHT:** `Resting heart rate 47 bpm` (aside `min 45 · max 83`), `HRV 51 ms` (aside
    `5-min high 80`), `Blood oxygen 96 %` (aside `low 88`), `Respiration 14 /min`. Asides in
    `.footnote` secondary before the value.
  - **THROUGH THE DAY:** `Steps 62 so far`, `Intensity minutes 0 so far`. For the current day
    the section header reads `THROUGH THE DAY · IN PROGRESS · SYNCED 10:02 AM` (from
    `updatedAt`); past days just `THROUGH THE DAY` and no `so far`.
  - **Nulls (Jul 28 board):** hero `—`, the stage bar an empty `systemFill` track, legend `—`s,
    footnote *The watch recorded no sleep this night — not worn, or not synced. A null is a
    dash, never a zero.* Overnight nulls get the daytime figure as the aside where one exists
    (`daytime avg 94%`).
- Units: sleep `h:mm`, HRV `ms`, HR `bpm`, SpO2 `%`, respiration `/min`, steps with a thousands
  separator.

### 5.4 Training › Rides (`GET /api/rides`, `GET /api/rides/weekly`, `GET /api/rides/{id}?streams=1`)

Boards: `Rides-Dark/Light`, `RideDetail-Dark` (full scroll length), `RideReplay-Dark`
(interactive), `RideNoGPS-Dark`.

- **Week card:** header `THIS WEEK · FROM MON, OCT 19`; four 28 pt numbers in a row: `4 rides ·
  21.1 mi · 2:37 moving · 1,083 ft`; under them a six-week distance strip (bars, 6 pt gaps, the
  current week in `label`, earlier weeks `secondaryLabel` 30%; labels are the week-start dates).
  No goal line.
- **Ride rows** (`RIDES · 52`, paged as you scroll): title = `name`, else `GRAVEL — Oct 21`
  (`sportProfileName` + date); line 2 `Wed, Oct 21 · 8:28 PM · GRAVEL`; line 3 `16 min · 2.7 mi ·
  79 ft · avg 115 bpm`. Moving time under an hour reads `16 min`, over reads `1:38`. Chevron.
- **Ride detail** (inline title, back to Training):
  1. **Map card**, 240 pt: MapKit standard map, muted (`.mapStyle(.standard(elevation: .flat,
     pointsOfInterest: .excludingAll))`), the route as an `MKPolyline` in Accent 3 pt, white
     start dot, Accent end dot. A glass **Replay** button bottom-right. Omitted entirely when
     the stream has no `lat`/`lon`.
  2. **Summary card:** caption `Tue, Oct 20 · 4:23 PM · MTB · Instinct 3`; a 3 × 2 tile grid:
     Moving time (`1:37:40`; add `elapsed 19:52` as the tile's sub-line only when it differs),
     Distance mi, Ascent ft (sub `725 ft descent`), Heart rate bpm (sub `max 175`), Speed mph
     (sub `max 20.0`), Calories kcal. Tiles for absent channels disappear (no power → no power
     tile; `0` distance/speed on an indoor activity → not measured, per #40).
  3. **HEART-RATE ZONES · THIS RIDE'S BOUNDARIES:** a 16 pt bar of the seven `timeInHrZone`
     buckets in the zone scale (buckets with 0 s dropped), then one row per bucket: dot, name,
     `123–143 bpm` from `hrZoneHighBoundary`, time `m:ss` right. Bucket 0 is `Below Z1 · < 90`;
     bucket 6 is `Above max · > 179`.
  4. **OVER THE RIDE** (header has a trailing `Scrub and replay ›`): three static charts
     (Elevation, Heart rate, Speed), 64 pt each, Accent 1.8 pt line over a 12 % Accent area,
     caption row with the range (`85–170 bpm`), `0:00 · 0:30 · 1:00 · 1:30` ticks. `null` buckets
     are visible gaps. The whole card is tappable → Replay.
  5. **NOTE:** the ride's `note` as prose, section omitted when null.
- **Replay** (full-screen cover, `Done` top-right; the new view, see §6).
- **No GPS (Elliptical, Aug 6):** no map, no replay, no distance/speed/ascent tiles; a footnote
  in the summary card explains the 0s; zones as usual; a single HR chart if the stream has one.

### 5.5 Training › Lifting (`GET /api/lifting/sessions`, `GET /api/lifting/sessions/{id}`, `GET /api/lifting/lifts/{templateId}`)

Boards: `Lifting-Dark/Light`, `LiftingSession-Dark` (full scroll length).

- **THE GOAL · SINCE OCT 12:** the goal `statement` in `.body`/24 clamped to 4 lines with a
  `more` link in Accent that expands in place. **The list must not nag:** no "days since", no
  empty-streak copy anywhere.
- **SESSIONS · 24** with a trailing status: `all read`, or `3 need a read` (from
  `GET /sessions?interpreted=false&limit=1` → `count`). Rows: title; line 2 `Mon, Sep 28 ·
  3:38 PM · 36 min`; line 3 `11,850 lb · top e1RM 153 lb · no PRs` (`2 PRs`). An uninterpreted
  session shows an 8 pt Accent dot after the title (`accessibilityLabel("needs a read")`).
  `annotation.focus`, when present, goes after the duration on line 2 (`· full body`).
- **Session detail** (inline title `Session A`, back to Training):
  1. **Header card:** title `.title2.bold()`; caption `Mon, Sep 28 · 3:38–4:15 PM · 36 min · full
     body · from Hevy`; a 4-up band: Tonnage (lb), Sets (sub `180 reps`), Top e1RM (lb), PRs
     (`—` + `repeat day` when zero).
  2. **THE READ · CLAUDE, AGAINST THE GOAL OF SEP 1:** `annotation.interpretation` as paragraphs
     at `.body`/25 in its own card. Give it the room; this is the editorial half.
  3. **SETS · HEVY'S NUMBERS, IN LB:** one block per exercise: title semibold; `e1RM 153 lb · 7
     sessions` footnote when the lift has an e1RM; an 84 × 28 Accent sparkline of the lift's
     `points[].e1rmKg` (in lb) with a chevron, tappable → the lift's progression (push). Then
     one line per set: index (secondary), load (`60 lb`, or `bodyweight`, or `m:ss` for
     duration-only sets), reps (`× 10`, or `hold`/`bike`). Warm-up is a time. Hevy's exercise
     `notes` as a footnote `Hevy note: …` when present. PR marks: a small Accent `PR` chip after
     the set's reps (none in the sample session).
  4. Session notes and quality (1–5) as a final section when present (null in the sample).
- kg → lb: `round(kg × 2.20462)`; show whole pounds everywhere.

### 5.6 Shopping (`GET /api/shopping/list` → `ShoppingList`; `POST /items`; `PATCH /items/{id}`; `DELETE /items/{id}`)

Boards: `Shopping-Dark/Light`, `ShoppingCheck-Dark`, `ShoppingAdd-Dark`, `ShoppingEmpty-Dark`.

- **Header:** large title `Shopping`, readout `19 on the list` (`activeCount`) beneath it;
  `nothing on the list` at zero.
- **Groups:** one inset section per category, alphabetical, header `MEAT · 4`. Rows: a 26 pt
  circle (1.8 pt `secondaryLabel` 40% stroke) and `text` in `.body`, wrapping freely. Row min
  44 pt. No quantities, no notes — they live in the text.
- **Check off:** tap anywhere on the row → `PATCH {status: "bought"}` optimistic. Light haptic;
  the circle fills Accent with a check; text strikes and dims; a 2 pt Accent bar drains along the
  row's bottom edge for ~2.5 s; then the row moves to **RECENTLY BOUGHT · LAST 7 DAYS** at the
  end of the list (grey filled check, subtitle `Meat · just now`). A tap during the drain cancels.
  Tapping a bought row un-checks it (`PATCH {status: "needed"}`). The header count updates with
  the optimistic state and reverts with the row on error (quiet banner).
- **Swipe to delete** (v1, see §9): trailing `.swipeActions` with the stock red `Delete`
  (trash symbol); full swipe deletes. `DELETE /api/shopping/items/{id}` (soft). Also on bought
  rows.
- **Add bar:** a glass capsule 20 pt above the tab bar (a tab-bar accessory): a category chip
  (`Pantry ▾`, remembers the last used) and the field (placeholder *Add to the list*). On focus the
  keyboard rises, the tab bar hides, and a horizontal chip strip appears above the field with
  every existing category (selected one filled white) plus `+ New` in Accent, which turns into a
  text field for a new category name. Return or the Accent **Add** button posts
  `{category, text}`, clears the field, keeps focus, and refetches `/list`.
- **Empty:** *Nothing on the list. Add something below, or tell Claude.* The add bar stays.

### 5.7 Settings, pair, lock

Boards: `Settings-Dark`, `Pair-Dark`, `Lock-Dark`; the privacy cover is on `States`.

- **Settings** (medium sheet, `Done`): `THIS IPHONE` — `Server` (SF Mono), `Paired` (`Curtis's
  iPhone · Oct 21`), `Lock` (*Face ID after 5 min in the background*); a red centered **Unpair
  this iPhone** row with a confirm, footnote *Deletes the token from this phone's Keychain. Asks
  first. Revoking from the web does the same thing from the other end.*; `Version` in mono.
- **Pair** (keeps #72's flow): the revoked notice at top when applicable (shield symbol in
  `Color.orange`, `secondarySystemGroupedBackground`, 16 pt radius); **Scan pairing code** as the
  one filled Accent capsule (56 pt) with a footnote on where the code comes from; `OR PASTE`
  section with the code field (SF Mono, a `Paste` chip) and a `Server` row (used only for a bare
  token); a `Pair` capsule, disabled until a code is present; a footnote that pairing makes one
  read before saving to the Keychain.
- **Lock** (boards `Lock-Scanning-Dark`, `Lock-Checking-Dark`, `Lock-Dark`): the app icon's
  mark, large (128 pt, white stroke, Accent dot), inside a **dial of 60 ticks** (260 pt, ticks
  1.3° wide every 6°, radius 113–130, `secondaryLabel` 18%) — the composition sits in the top
  third (centered at y ≈ 280) because iOS draws its own Face ID glyph at the screen's center
  during `evaluatePolicy`. Wordmark `JustMy` `.title2` semibold under it, then a status line in
  `.subheadline` `secondaryLabel`. Three beats:
  1. **Scanning:** a 110° arc of Accent-lit ticks sweeps around the dial once per 1.8 s
     (`TimelineView` rotating a conic mask over an Accent copy of the ticks); the mark's dot
     breathes on the same beat (scale 1 → 1.18, opacity 1 → 0.75). Status `Face ID`.
  2. **Checking the token** (the one allowlisted read before the app opens): all ticks lit in
     Accent, a slow alternate fade (0.35 → 1, 1.2 s). Status `Checking the token…`.
  3. **Failed or dismissed:** ticks dim and still, dot stays Accent, the status line becomes the
     error in `Color.red` (`Face ID didn't match. Try again, or use your passcode.`), and the
     filled Accent capsule **Unlock with Face ID** appears at the bottom with the footnote
     *Face ID is asked on appear. This button is for when it was dismissed.*
  Success has no state: the ring completes, then the screen cross-dissolves into the app
  (`.opacity`, ~250 ms). The same view, static, is the privacy cover. No assets: the dial is a
  `Canvas` or 60 rotated `Capsule`s; the mark is the icon's path.

## 6. Replay — new view (not in the brief)

A full-screen cover from the ride detail (map button or the chart card) that correlates the
four streams by time, with scrub and play. Board `RideReplay-Dark` is interactive: press its
Play button on the canvas.

Layout, top to bottom, all inside 874 pt:

1. **Map, 300 pt.** The whole route in `secondaryLabel` 28%, the ridden part in Accent growing
   behind the marker; a white 5.5 pt dot with a 2.5 pt Accent ring and a 25% Accent halo; the
   start dot stays.
2. **Readout card:** five bottom-aligned columns — elapsed at 28 pt with `of 1:37:40` under it,
   then `mi`, `ft`, `bpm`, `mph` at 20 pt with the unit beneath each. Values interpolate between
   stream samples. Tabular digits so nothing shifts while playing.
3. **Chart strip card:** Elevation, Heart rate, Speed at 62 pt each, uppercase 11 pt labels top
   left, no y-axes (the readout carries the values); a single 1.5 pt white sweeper line through
   all three with a white dot on each line at the selected time; `0:00 · 0:30 · 1:00 · 1:30`.
   **The strip is the scrubber:** a horizontal drag anywhere on it sets `t`
   (`chartOverlay` + `DragGesture`). Scrubbing pauses playback.
4. **Transport row:** Play/Pause as a 56 pt glass circle in Accent; speed as a segmented
   `30× · 60× · 120× · 300×` (remember the last pick app-wide); a trailing runtime readout
   `1:37 at 60×` (ride duration ÷ speed). Play at the end restarts from 0.

Implementation: `t` advances by `speed × dt` from a `TimelineView`/timer; the map marker is one
`Annotation` positioned by linear interpolation between the two samples around `t`; the ridden
polyline is the sample prefix plus that point. Interpolate the readout the same way. No replay
when the stream lacks `lat`/`lon`.

## 7. App icon

Board `AppIcon`. A lowercase "j" as one rounded stroke (104/1024 wide, round caps) with its dot in
Accent — the one data point on the instrument. Three Icon Composer layers: ground, stroke, dot.
Master: ground `#101316`, stroke white, dot Accent dark. Light: ground `#F5F5F7`, stroke `#111214`,
dot Accent light. Dark: ground black. Clear and tinted are generated by the system from the layers.
The path is in the artboard's SVG (`viewBox 0 0 1024 1024`):
`M548 292v360c0 90-62 150-150 150-44 0-82-14-110-38`, dot at `(548,176) r 64`.

## 8. Contract flags found while designing (no fields invented)

| Where | Flag |
|---|---|
| macros | `EntryView.name` is nullable. The row needs a fallback label; the design assumes one exists (the web's). **Resolved:** `ad-hoc`, the web's string (`EntryRow.tsx`). |
| macros | The entry sheet shows `Sodium (mg)`, but `sodiumContent` is stored in **grams** like every mass macro (CONVENTIONS §6). Multiply by 1,000 for display. |
| macros | Entries carry no time, only `consumedOn`. The list has no time column and is shown in API order. |
| lifting | ~~`annotation.focus` has no documented vocabulary beyond `full`.~~ **Corrected:** it is the `liftingFocus` enum (`push · pull · upper · lower · full · accessory · other`), so the generated client has an enum. The list shows a display label (`full` → `full body`). |
| lifting | ~~`GET /lifts/CC55119B` returns no `points`.~~ **Not reproducible:** checked against live data on 2026-10-22, it returns 15 points, 14 with an e1RM. The sparkline renders. |
| vitals | `sleepStartAt` / `sleepEndAt` are on the day row and the design uses them for the sleep window. They weren't in the brief; they are in the response view. |
| vitals | `updatedAt` on the day row is what `SYNCED 10:02 AM` reads. |
| rides | `timeInHrZone.timeInHrZone` has 7 buckets against 6 boundaries: below-Z1, Z1–Z5, above-max. Rendered as such. |
| rides | Indoor activities report `distanceMeters: 0`, `avgSpeedMps: 0` (#40) — shown as not measured, tiles omitted. |
| rides | List rows need `name`, `sportProfileName`, `startedAt`, `movingSeconds`, `distanceMeters`, `totalAscentMeters`, `avgHeartRate` — all on the list shape today. |
| settings | `Paired: Curtis's iPhone · Oct 21` — the app doesn't know the token's name: the pairing payload is `{v, base, token}`. The app records the pairing date itself; the name needs an optional `name` in the QR payload (#69), and until then the row shows `This iPhone · Oct 21`. |

## 9. Amendments to the spec and brief (carried into `ios-app.md`)

1. **Dynamic Type dropped** as a requirement; the "largest Dynamic Type" edge state is struck.
2. **Training tab icon** is `figure.outdoor.cycle` (was `dumbbell`).
3. **HR zone colors** are the ordinal system-color scale in §2.2, not a single-hue ramp.
4. **Replay** (§6) is added to the Rides screens for v1 read views (#73).
5. **Swipe-to-delete for shopping items is in v1** (the PWA has it): `DELETE
   /api/shopping/items/{id}` (soft) joins the `shopping:write` allowlist in `ios-app.md` §3.4.
   Hard delete (`?hard=true`) stays primary-key-only. Edit, and delete elsewhere, stay in #76.
6. Light-mode role colors are the darkened values in §2.1, not the web's hex.
7. Sheets are designed in dark only where the light mapping is identical to the parent screen.
8. **The macros rollup is the budget bar (§5.1), not four neutral bars.** The brief's "no
   under/in/over coloring in v1, wait for #49" and the §7.1 decision to ship numbers-only are
   superseded: this is the #49 presentation for the app, decided by Curtis on 2026-10-22 —
   calories a ceiling and a goal, protein a floor and a goal, fat and carbs levers judged only
   for balance. The read views shipped (#92) with the neutral card; the change is tracked as its
   own issue.
