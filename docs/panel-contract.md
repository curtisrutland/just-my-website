# JustMy Panel — Shared Contract

**Status:** In-repo working copy — authoritative for implementation
**Audience:** Claude Code (implements), Claude Design (designs against)
**Version:** 1.1

This is the single source of truth for the panel's data shapes and routes. Both
the design and implementation work reference this document. If either side needs
a shape that isn't here, that's a contract change — raise it, don't invent it.

> **This is the in-repo copy** (`docs/panel-contract.md`), which supersedes the
> original brief bundle in `~/Downloads`. Companion docs: `docs/panel-design-brief.md`,
> `docs/panel-code-brief.md`.
>
> **Changelog**
> - **1.1 (2026-07-16)** — §5.1 `weight` reconciled with the as-designed health screen
>   (Claude Design, done). `toWaypoint` **removed** (the weight module tracks trends, not
>   goals; distance-to-goal would have been net-new tracking we're not adding). Added
>   `trendPerWeek` (the on-screen "0.6 lb/wk" rate), `series` (the 30-day sparkline),
>   `windowDays`, and `range` (extent of the rolling-average line). All are already
>   produced by `weight/repo.ts:getRollup()`, so this is exposure, not new computation.

---

## 1. What the panel is

A wall-mounted Raspberry Pi running a 7" touchscreen in portrait, displaying a
kiosk-mode browser pointed at `/panel` on justmy.website.

**Fixed constraints — these drive every decision below:**

| Constraint | Value | Consequence |
|---|---|---|
| Viewport | 720 × 1280 CSS px, portrait, no rotation | Phone-shaped, but see viewing distance |
| Viewing distance | ~24–36 inches (arm's length, wall-mounted) | Effective density is far lower than a phone at 6" |
| Input | Touch only. No keyboard, no mouse, no hover. | No text entry anywhere. No hover states. |
| Hardware | Raspberry Pi 3 (1GB RAM, VideoCore IV) | Cheap rendering. No heavy animation, no large DOM. |
| Theme | Dark, fixed | No theme toggle. Panel is on a wall in a kitchen. |
| Posture | User is standing, possibly cooking, possibly holding something | Large targets. Forgiving mis-taps. |

**Design principle:** the panel is read-mostly and does less on purpose. Anything
that is better on a phone stays on the phone. The panel's job is to be glanceable
from across the room and tappable without precision.

---

## 2. Routes

```
/panel               → 302 to /panel/health
/panel/health        → macros + weight trend
/panel/shopping      → shopping list, tap to check
/panel/recipe        → the active recipe (whatever was last sent to the panel)
```

Navigation between the three is a **fixed bottom tab bar**, always visible, three
tabs. Room to grow to five (lifting and riding modules are planned). Beyond five,
the nav design gets revisited — do not build a menu.

There is no other navigation. No back button, no breadcrumbs, no links off-panel.

---

## 3. Authentication

Two distinct credentials. Do not conflate them.

### 3.1 Device token — the panel itself

The panel is not a logged-in user. It authenticates with a long-lived device
token, sent as `Authorization: Bearer <token>`.

```
device_tokens
  id            uuid pk
  name          text          -- 'kitchen-panel'
  token_hash    text          -- hash, never store the raw token
  scopes        text[]        -- see below
  last_seen_at  timestamptz
  revoked_at    timestamptz   -- null = active
  created_at    timestamptz
```

Scopes for the kitchen panel:
- `panel:read`
- `panel:write:shopping`
- `panel:write:daytype`

**Panel API routes accept either a device token OR a valid Clerk session.** The
Clerk path exists so the panel UI can be developed and debugged in a normal
desktop browser without provisioning a token. Same routes, same responses.

### 3.2 Service token — send-to-panel

justmy.recipes calling justmy.website is server-to-server. It uses a **separate**
credential with a single scope: `panel:write:recipe`.

Store it in the same `device_tokens` table (simpler) with `name = 'justmy-recipes'`.
The distinction is enforced by scope, not by table.

**The service token must never reach the browser.** The "Send to Panel" button on
justmy.recipes calls justmy.recipes' own server-side route handler, which holds
the token and forwards to justmy.website.

---

## 4. The version endpoint

The panel polls this. It is the cheapest, most frequent request in the system.

```
GET /api/panel/version
Auth: panel:read

200 →
{
  "health":   1721145600,
  "shopping": 1721145600,
  "recipe":   1721098200
}
```

Values are opaque monotonic integers (unix seconds is fine). The panel compares
them against what it last saw and refetches **only the section whose number moved,
and only if that section is the currently-visible tab.**

### 4.1 CRITICAL: this endpoint must not query Neon

Coupling the highest-frequency request to the database defeats the purpose and
burns Neon compute-hours by never letting the instance autosuspend. See §9.

Back it with a KV store (Vercel KV / Upstash Redis). Every write path bumps the
relevant key. Neon is only touched when a section actually changed.

### 4.2 Write paths that must bump versions

| Write | Bumps |
|---|---|
| Any macro entry created/updated/deleted (skill or web) | `health` |
| Day-type change (skill, web, or panel) | `health` |
| Any weight entry created/updated/deleted (skill or web) | `health` |
| Any shopping list change (skill, web, or panel) | `shopping` |
| Send-to-panel | `recipe` |

This means the existing skill clients and web UI write paths need a bump call
added. That is part of this work, not a follow-up.

---

## 5. Section endpoints

Each is fetched only when its tab is active and its version has moved. Plus once
on initial load.

### 5.1 `GET /api/panel/health`

Auth: `panel:read`

```jsonc
{
  "date": "2026-07-16",              // the day this reflects, in Curtis's TZ
  "dayType": "training",             // "training" | "rest" | null
  "macros": {
    "consumed": { "kcal": 1420, "protein": 98, "fat": 44, "carb": 152 },
    "target":   { "kcal": 2300, "protein": 160, "fat": 75, "carb": 220 },
    "remaining":{ "kcal": 880,  "protein": 62,  "fat": 31, "carb": 68 }
  },
  "weight": {
    "latest":      { "value": 177.6, "loggedAt": "2026-07-16T11:40:00Z" },  // nullable — the "latest raw" line
    "rollingAvg7": 177.6,            // hero number. nullable if <2 readings in window
    "trend": "down",                 // "down" | "flat" | "up" | null — drives the glyph + color
    "trendPerWeek": -0.6,            // the on-screen "0.6 lb/wk" rate, signed. nullable. down = negative.
    "windowDays": 30,                // the window trend + series + range span. "last 30 days" on screen.
    "series": [                      // the 30-day sparkline: one point per day, the 7-day rolling avg
      { "date": "2026-06-17", "avg": 180.4 },
      { "date": "2026-06-18", "avg": 180.1 }
      // … up to windowDays points. [] if empty; design handles the empty/sparse chart.
    ],
    "range": { "min": 177.7, "max": 180.4 }  // min/max of the rolling-avg series over the window. nullable.
  }
}
```

Notes for the implementer:
- `remaining` is computed server-side. The panel does no arithmetic.
- `remaining` values may be **negative** (over target). The design handles this.
- `target` comes from the dated target profile, not a constant. Current profile is
  flat 2300/160/75/220 for both day kinds, but read it from the profile — the
  schema supports it changing.
- **When the day is unspecified (`dayType: null`), resolve the target to the
  lower-calorie profile, wholesale** — resolve both training and rest, pick the one
  with the lower `calories`, and use that whole profile (do **not** mix fields into a
  per-field min; that isn't a real profile). Conservative for the ceilings that drive
  "how much can I still eat." Moot while both profiles are flat; correct when they diverge.
- **Macro kind (floor vs ceiling) is a *display* semantic, not an API field.** kcal,
  fat, carb are **ceilings** (stay at/under); protein is a **floor** (reach at/over).
  The API returns numbers; the viewer colors them per §11. `remaining` stays signed for
  every macro either way.
- **The entire weight block maps from `weight/repo.ts:getRollup({ windowDays: 30 })`.**
  It already computes `currentAvg` (→ `rollingAvg7`), `trendPerWeek`, a per-day `series`
  with the rolling `avg`, and a `range`. This section is a mapping, not new math.
- `weight.latest` can be null (no reading today or recently). `rollingAvg7`,
  `trendPerWeek`, `trend`, `range` can all be null (<2 readings in window). `series`
  can be `[]`. Design handles the empty/partial states.
- `trend` (the enum) is derived from `trendPerWeek`: **the deadband is the display
  precision** — if the signed rate rounds to `0.0 lb/wk` at the shown precision it is
  `"flat"`, otherwise the sign gives `"down"`/`"up"`. This guarantees the glyph never
  contradicts the number beside it. Document the exact rounding in code.
- `range` is the extent of the **rolling-average** series (the plotted line), not raw
  daily readings. `windowDays` is currently `30`, matching the as-designed screen.

### 5.2 `GET /api/panel/shopping`

Auth: `panel:read`

```jsonc
{
  "items": [
    { "id": "abc123", "name": "Silk soymilk", "category": "Dairy", "checked": false },
    { "id": "def456", "name": "Bananas",      "category": "Produce", "checked": false },
    { "id": "ghi789", "name": "Skyr",         "category": "Dairy", "checked": true }
  ],
  "counts": { "total": 14, "unchecked": 11 }
}
```

- Return the **full** list, not a slice. The panel has its own tab now; it can scroll.
- Items are already categorized in the existing shopping module. Preserve `category`
  so the design can group.
- Checked items are included (the design decides whether/how to show them).

### 5.3 `GET /api/panel/recipe`

Auth: `panel:read`

```jsonc
{
  "recipe": { /* the stored snapshot — see §6.2 */ },   // null if nothing sent
  "sentAt": "2026-07-16T17:40:00Z",                     // null if nothing sent
  "sourceUrl": "https://justmy.recipes/r/chile-braised-shoulder-roast"  // nullable
}
```

`recipe: null` is a normal, expected state and needs a real empty state in the
design. It is not an error.

---

## 6. Send-to-panel

### 6.1 The endpoint

```
POST /api/panel/recipe
Auth: panel:write:recipe (service token)
Body: { "recipe": <JSON-LD Recipe object>, "sourceUrl": "https://..." }

200 → { "ok": true, "sentAt": "..." }
400 → { "ok": false, "errors": [ "..." ] }
```

**The sender is anonymous to this endpoint.** It accepts a JSON-LD Recipe. It does
not know or care that justmy.recipes sent it. A future URL importer, a manual
paste, or a second site all work without touching the panel.

### 6.2 Storage

```
panel_state                          -- single row for now; add panel_id if a 2nd panel appears
  id                 int pk default 1
  active_recipe      jsonb           -- the RAW payload as received, unmodified
  active_recipe_norm jsonb           -- the normalized view the panel renders (see 6.4)
  source_url         text
  set_at             timestamptz
  updated_at         timestamptz
```

**Store the raw payload as-is.** Fields the panel doesn't currently render (notably
`image`) ride along and get picked up whenever the viewer learns to use them. No
contract change, no re-send of stored recipes.

**Snapshot semantics are intentional.** What was sent is what gets cooked. If the
recipe is edited on justmy.recipes mid-cook, the panel does not change under the
user's hands. To get the update, re-send.

### 6.3 Validation — on receive, never on render

The panel must never be the thing that discovers a payload is malformed. Reject at
the endpoint so the sender can surface an error while the user is still on a device
with a keyboard.

Minimum accept criteria:
- `@type` is `"Recipe"` (accept a bare object without `@type` only if you choose to
  be lenient — document the choice)
- `name` is a non-empty string
- At least one of `recipeIngredient` or `recipeInstructions` is present and non-empty

Everything else is optional. Unknown fields are preserved, not rejected.

### 6.4 Normalization — on receive, never on render

schema.org permits `recipeInstructions` as: a bare string, an array of strings, an
array of `HowToStep`, or `HowToSection` objects containing nested steps. Handling
that raggedness in the panel renderer is exactly wrong — it puts branching logic in
the lowest-powered, hardest-to-debug part of the system.

Normalize on receive into a flat step list and store it in `active_recipe_norm`:

```jsonc
{
  "name": "Chile-Braised Shoulder Roast",
  "description": "…",                  // nullable
  "recipeYield": "6 servings",         // nullable, string
  "totalTime": "PT4H30M",              // nullable, ISO 8601
  "ingredients": [ "1.4 kg beef shoulder", "2 tbsp chile paste" ],   // flat strings
  "steps": [
    { "heading": "Sear the roast", "text": "Pat dry and sear all sides…" },
    { "heading": null,             "text": "Deglaze with stock." }
  ],
  "notes": "Better the next day.",     // nullable — see 6.5
  "nutrition": { "calories": 420, "proteinContent": 31, "fatContent": 22, "carbohydrateContent": 18 }  // nullable
}
```

- `steps[].heading` is nullable. A step may have text and no heading.
- `ingredients` is always a flat array of strings.
- Times stay ISO 8601 in storage; the **viewer** formats them for display.

### 6.5 Known shape of the actual sender (verified)

justmy.recipes' API was inspected directly. Its real output is narrower than
schema.org permits, which makes the normalizer nearly trivial for the current
sender — but write it to handle the general case anyway, because §6.1 says the
sender is anonymous.

Verified facts:

| Field | Actual shape |
|---|---|
| `recipeInstructions` | **Always** `HowToStep[]` on read. Each: `{ "@type": "HowToStep", "text": string, "name"?: string }`. `name` is a short heading and is frequently present. |
| `recipeIngredient` | Array of free-text strings. No quantity/unit structure. Not parsed. |
| `recipeYield` | String, e.g. `"6 bites"`. Not always a plain number. |
| `prepTime` / `cookTime` / `totalTime` | ISO 8601 durations. Often but not always all three present. |
| `nutrition` | schema.org shape, **plain numbers** (not `"22 g"` strings), **per serving**, paired with `recipeYield`. Fields: `calories`, `proteinContent`, `fatContent`, `carbohydrateContent`, sometimes fiber/sugar/sodium/saturated fat. |
| `recipeCategory` / `recipeCuisine` / `keywords` | Arrays of strings. Not needed by the panel — carry them in the raw payload, ignore in the normalized view. |
| `description` | String, usually present. |

**⚠ `notes` is NOT schema.org.** justmy.recipes has a top-level freeform `notes`
field that carries real, useful content — storage life, substitutions, technique
warnings, "re-pin the macros once the brand is known." A strict JSON-LD-only
consumer would silently drop it.

Resolution: the send payload is **JSON-LD plus `notes`**. The normalizer reads
`notes` if present and carries it into `active_recipe_norm.notes`. A sender that
doesn't have notes omits the field and the viewer renders without it.

**No hidden render logic found.** The site does not scale ingredients by servings,
does not parse quantities, and does not do anything in its renderer that the data
doesn't capture. A JSON-LD+notes consumer has everything it needs. Ingredient
scaling is therefore a future feature on both sites, not a porting problem.

---

## 7. Write actions from the panel

The **entire** write surface. Nothing else. Adding to it is a contract change.

### 7.1 `POST /api/panel/shopping/:id/check`

```
Auth: panel:write:shopping
Body: { "checked": true }
200 → { "ok": true }
```
Bumps `shopping` version. Idempotent.

### 7.2 `POST /api/panel/day-type`

```
Auth: panel:write:daytype
Body: { "type": "training" }     // "training" | "rest"
200 → { "ok": true }
```
Applies to today in Curtis's timezone. Bumps `health` version. Idempotent.

**Why only these two:** checking off a shopping item happens when you're in the
kitchen with your hands full and your phone in another room — the panel genuinely
wins. Day-type is a single binary tap. Everything else (logging food, logging
weight, editing recipes) is better on a phone, and building it here would make the
panel worse, not better.

---

## 8. Refresh & staleness

- The panel polls `/api/panel/version` on an interval. **60s is fine** given §4.1
  removes the database from the path; the constraint was never Vercel's request
  budget (a 60s poll is ~43k req/month against a 1M free-tier allowance).
- Manual refresh: **tap the section header.** Not a dedicated button — a button
  eats real estate on a 720px-wide panel for a rare action.
- The panel does not need to be current to the second. The user accepted this
  explicitly. A visible-but-quiet "last updated" affordance is enough.
- **Panel sleeps.** When the display blanks overnight, polling stops. This is both
  a Neon-hours saving and correct behavior.

---

## 9. Neon compute-hours — must verify before building §4

**Check the actual usage number on the Neon project's usage page before designing
around this.** It may already be a non-problem.

The risk: Neon's free tier meters compute-hours and autosuspends the compute when
idle (default ~5 min). A poll that touches the database every tick never lets it
suspend, so it bills 24/7 rather than only during real use. Against a free-tier
allowance well under 730 hours/month, that is the thing that actually breaks —
not Vercel.

§4.1 (version endpoint backed by KV, not Neon) resolves it structurally. Do that
regardless of what the usage page says: coupling the cheapest, most frequent
request to the most expensive resource is the thing you'd regret later.

Rejected alternatives, for the record:
- *In-memory version on the Vercel function* — serverless instances are ephemeral;
  versions would be inconsistent across cold starts.
- *Let Neon suspend between polls* — each poll still pays a wake cost (~100–500ms)
  and still ticks a compute-hour. Saves little.

---

## 10. Explicitly deferred

Do not build these. They are named so the seams stay open.

| Deferred | Seam that keeps it cheap later |
|---|---|
| Phone→panel *active* switching (panel self-navigates on send) | Send-to-panel is **passive**: it sets the row, the panel loads it when you navigate to the tab. The panel does not change under you while you're checking shopping. |
| WebSockets / SSE / Pusher / Ably | Vercel functions can't hold a persistent connection; SSE bills the whole open duration. The version-poll gets the same UX for no machinery. Revisit only if a real push flow appears. |
| Lifting and riding tabs | Tab bar is built for 5. Section endpoints and version keys are already per-section. |
| Ingredient scaling by servings | Neither site does it today (verified). Future feature on both. |
| Recipe images | `image` rides along in the raw payload and is ignored by the viewer. Contract does not change when it ships. |
| Cooking-mode step persistence | Step check-off is local state. Nobody resumes a recipe tomorrow. |
| Multiple panels | `panel_state` is a single row; add `panel_id` if a second one appears. |
| Any additional write path | §7 is the whole surface. |

---

## 11. Panel design tokens & color semantics

From the delivered design (`docs/design-reference` / Claude Design "Wall Panel"). These are
**panel-scoped** — a distinct surface at a distinct viewing distance, built on the same system
(design brief §3). Reused wholesale when Lifting/Riding tabs arrive.

### 11.1 Type scale (re-anchored for ~24–36″ viewing)

```
--p-hero:   112px   -- the one hero number (remaining kcal)
--p-num-xl:  56px
--p-num-lg:  40px   -- weight avg, protein emphasis
--p-title:   32px
--p-body:    26px   -- shopping rows, step-through body
--p-body-sm: 22px
--p-label:   16px   -- section labels
--p-micro:   13px   -- captions, "of Xg", "range …"
```

### 11.2 Fonts

- **Space Grotesk** — display / recipe & step headings (`--font-display`)
- **IBM Plex Sans** — body / prose (`--font-body`)
- **JetBrains Mono** — every number + label; load-bearing for the "instrument" feel (`--font-mono`)

⚠ **Self-host all three via `next/font`. Do NOT ship the design's Google Fonts `<link>`.**
The Pi 3 has no font cache and unreliable overnight network; an external font request means FOUT
or blocked first paint. Self-hosting is local, preloaded, CSP-clean, offline-safe. (Design brief
§2 said "no web fonts if the token system can avoid it" — self-hosting is how we honor that while
keeping the branded families.)

### 11.3 Colors (dark-only)

```
--p-bg:#0a0d0f  --p-surf:#12171a  --p-surf2:#1a2127  --p-border:#242d33
--p-text:#e7eef1  --p-muted:#68777e  --p-faint:#3a464c
--p-accent:#3ad0d6 (cyan)  --p-success:#4ec97a  --p-warn:#e0a63a (amber)  --p-over:#e5533f (red)
```

### 11.4 Macro color semantics — floor vs ceiling

The instrument colors macros by **attention in the direction that matters** — not "over = bad".

| Macro | Kind | Below target | At / over target |
|---|---|---|---|
| kcal (hero), fat, carb | **ceiling** (stay at/under) | calm — accent hero / neutral card | **muted amber** (`--p-warn`) — over the ceiling, informative |
| protein | **floor** (reach at/over) | calm / neutral — still short, **no amber, no nag** | **success** (`--p-success`) — floor met |

- **Amber (`--p-warn`) appears in exactly one situation: a ceiling exceeded.** Protein never shows
  amber — while short it stays neutral, and it turns success-green only once the floor is met. This
  keeps the panel reporting, not nagging (design brief §5).
- Progress bars follow the same rule: a ceiling bar goes amber past the line; the protein bar stays
  neutral while filling and flips to success at 100%.
- **`--p-over` red is retired from everyday macro states** — over-a-ceiling is amber, not a red
  panic. Reserve red for genuinely exceptional use.
- This is a UI concern. The API returns signed numbers; floor/ceiling and color live in the viewer.
