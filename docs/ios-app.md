# Native iOS app — spec

> **Status: DRAFT for approval** (scoped with Curtis 2026-10-21). Nothing is built until Curtis
> approves this doc. Tracking epic: #66 (sub-issues #67–#74).

A SwiftUI app for Curtis's iPhone that shows the same six modules as the web UI (macros, weight,
lifting, rides, vitals, shopping) with native iOS navigation, plus the few writes a phone is
genuinely better at. Native-only features (widgets, Live Activities, HealthKit, App Intents) come
after v1 and are named under "Later" so the seams stay open.

**The one idea:** *the same data, in a native shell.* The app adds no metrics, renames no fields and
computes nothing the platform doesn't already compute. It is a client of the token API, like the
skills, the kitchen panel and the ESP32 display.

---

## 1. Decisions (Curtis, 2026-10-21)

| | Decision |
|---|---|
| Stack | **SwiftUI**, iOS 27 deployment target (Xcode 27.1). No cross-platform layer. |
| Where | **`ios/` in this repo.** Same reasoning as `daemon/` and `skills/`: the client and the API contract it depends on change together, so they get reviewed together. |
| Data path | **Token API only.** The web UI reads the DB through server components; the app can't, so it is a **third surface** (like the panel) over `/api/**`. |
| Auth | **A paired device token**: the panel's DB-backed, hashed, scoped, revocable tokens, generalized to module routes (§3). Kept in the Keychain behind Face ID (§4). |
| v1 scope | All six modules **readable**, plus **light writes**: log a weight, add a shopping item, check one off (§6). |
| Maps | **MapKit** (native Apple Maps) for the ride route. Free in a native app — no API key, no usage billing — unlike the web's Carto basemap. |

---

## 2. Where this sits in the conventions

CONVENTIONS §1 says "two surfaces, one data". The app does not add a third *kind* of surface — it
is another API client — but it is the first client that a human uses to browse every module, so the
table gains a row:

| | Reads | Writes |
|---|---|---|
| **Web UI** (`/`, Clerk-gated) | server component → `repo` | server action → `schema.parse` → `repo` |
| **Token API** (`/api/**`) | route → `repo` | route → `schema.parse` → `repo` |
| **iOS app** (`ios/`) | token API `GET` | token API `POST`/`PATCH` (so: `schema.parse` → `repo`) |

What does **not** change:

- **Surfaces differ on read, never on write.** App writes go through the existing API routes, so they
  hit the same `schema.parse()` and the same `repo` function as every other write. No new write path.
- **The web UI still never calls the API.** Nothing in this spec touches `src/app/(app)/`.
- **Server-side code never crosses modules.** If the app later shows a cross-module "Today" screen,
  it assembles it client-side from per-module reads — the same rule as the `manage-health` skill
  (CONVENTIONS §9): read-only, no new metrics, no renamed fields.
- **Domain logic stays in `src/lib`.** The app renders what the API returns. If a view needs a
  number the API doesn't expose, the fix is to expose it from `src/lib/{module}` (§7), never to
  reimplement the math in Swift.

On approval, CONVENTIONS §1 (the table) and §2 (the device-token rule), AGENTS.md ("Two tokens") and
ARCHITECTURE.md (surfaces) are amended to match. Those edits ride in the same PR as this doc.

---

## 3. Kernel change — device tokens on module routes

### 3.1 Today

Two token systems, deliberately separate (`src/lib/db/schema.ts` → `device_tokens`):

- **Static env tokens** guard `/api/**`: `JMW_API_KEY` (primary), `JMW_AGENT_TOKEN` (agent), plus
  the two single-purpose scoped tokens `JMW_PUBLISHER_TOKEN` (daemon, push-only, two routes) and
  `JMW_DISPLAY_TOKEN` (ESP32, read-only, one route).
- **DB-backed device tokens** guard `/api/panel/**` only: random `jmw_…` tokens, stored as
  `sha256(raw)`, each with a `scopes text[]` and a `revoked_at`. Minted by `npm run panel:token`.

### 3.2 Why not the alternatives

- **`JMW_API_KEY` on the phone** — full access, including hard DELETE, and not revocable without
  rotating the key everywhere (skills, scripts). A phone is a losable device.
- **A new static env token (`JMW_PHONE_TOKEN`)** — same shape as the publisher/display tokens, but
  revoking it means a Vercel env change and redeploy, and there's no "last seen". The display token
  could get away with that because it reads one day's totals; the phone reads everything.
- **Clerk session JWT as a bearer** — adds a session path to the token API (which CONVENTIONS §2
  forbids outright), and couples the app to the dev-vs-prod Clerk instance question (#23, on hold).

The device-token table already has everything needed — hashing, scopes, revocation, `last_seen_at`
— so the change is to let it reach module routes, under the same discipline as the other scoped
tokens: **an explicit allowlist of routes, a model-doc entry (this doc), and a test.**

### 3.3 The change

1. **Scopes generalize from panel-only to platform-wide.** `src/lib/panel/scopes.ts` becomes a
   kernel module (`src/lib/auth/scopes.ts`) holding every device scope. The panel's three scopes
   are unchanged. New ones, named `{module}:{access}`:

   | Scope | Grants |
   |---|---|
   | `macros:read` · `weight:read` · `lifting:read` · `rides:read` · `vitals:read` · `shopping:read` | The module's `GET` routes listed in §3.4 |
   | `weight:write` | `POST /api/weight/entries` |
   | `shopping:write` | `POST /api/shopping/items`, `PATCH /api/shopping/items/{id}` |

   A `PHONE_SCOPES` preset (all six `:read` + the two `:write`) sits beside `KITCHEN_PANEL_SCOPES`.
   Module-qualified scopes cost nothing now and mean a second device (an iPad on the kitchen wall,
   a watch) can get a narrower grant later without a schema change.

2. **The token code moves to the kernel.** `src/lib/panel/tokens.ts` (hash, mint, look up, the KV
   cache) moves to `src/lib/auth/device-tokens.ts`; the panel imports it from there. The
   `device_tokens` table and its comment are updated: it now guards `/api/panel/**` **and** the
   allowlisted module routes. No migration — the columns don't change.

3. **One new auth helper.** `requireScope(request, scope)` in `src/lib/auth/tokens.ts`, async:
   - Env tokens first, exactly as today: `JMW_API_KEY` / `JMW_AGENT_TOKEN` pass for any scope
     (they already pass `requireBearer` on these routes, so nothing changes for skills).
   - Otherwise, a device token that is live (not revoked, not deleted) **and** holds `scope` passes.
   - Anything else is `401` with the usual envelope. A present-but-bad token never falls back.
   - Best-effort `last_seen_at` stamp on success (not awaited on the response path).

   Device tokens are **not** added to `identify()`, so they can never pass `requireBearer` or
   `requirePrimary`. That is the structural guarantee: a route only accepts a phone if its handler
   calls `requireScope`, and no device scope ever grants hard DELETE.

4. **Only the routes in §3.4 switch** from `requireBearer` to `requireScope`. Every other route
   keeps rejecting device tokens. Widening the list later is a kernel change: an entry here and a test.

5. **OpenAPI** gains a `deviceToken` security scheme on exactly those operations (as
   `displayToken` / `publisherToken` do today), so the generated Swift client knows which calls take it.

6. **Revocation becomes real.** Today there is no revoke path (`tokens.ts` notes one "should also
   DEL the cache key"). `revokeDeviceToken(id)` sets `revoked_at` and deletes the KV cache key.
   The cached lookup stays on the panel version poll only; module routes use the direct lookup, so
   revoking the phone takes effect on its next request.

### 3.4 The allowlist

Read (`{module}:read`):

Only the routes the v1 views actually call (§5, checked against the audit in §7). Least privilege:
a route the app doesn't need stays off the list even if it's harmless.

| Module | Routes |
|---|---|
| macros | `GET /api/macros/days/{date}` |
| weight | `GET /api/weight/rollup`, `GET /api/weight/entries`, `GET /api/weight/days/{date}` |
| lifting | `GET /api/lifting/sessions`, `GET /api/lifting/sessions/{id}`, `GET /api/lifting/lifts/{templateId}` |
| rides | `GET /api/rides`, `GET /api/rides/{id}` (incl. `?streams=1`), `GET /api/rides/weekly` |
| vitals | `GET /api/vitals/summary`, `GET /api/vitals`, `GET /api/vitals/{date}` |
| shopping | `GET /api/shopping/list` |

The macros entry sheet renders the `EntryView` already in the day rollup, so
`GET /api/macros/entries/{id}` (which returns a different shape, §7.3) isn't needed. The lifting
goal comes back on `GET /api/lifting/sessions`, so `/goal` and `/goals` aren't either.

Write:

| Scope | Routes |
|---|---|
| `weight:write` | `POST /api/weight/entries` |
| `shopping:write` | `POST /api/shopping/items`, `PATCH /api/shopping/items/{id}` |

Deliberately **not** on the list in v1: every `DELETE` (including soft-delete), every other
`PATCH`, ingestion (`/api/rides/upload`, `POST /api/vitals`, `/api/lifting/pull`, webhooks),
`/api/macros/usda/*`, foods and batches. Food logging stays Claude's job (the `manage-macros`
skill), where estimation and pinned ingredients live.

If closing a gap in §7 ever adds a read endpoint, that endpoint joins this table in the same PR.

### 3.5 Tests

Following `src/lib/auth/tokens.test.ts` and `src/lib/panel/auth.test.ts`:

- a phone token passes each allowlisted route's scope and fails a route outside the list (one per
  module, e.g. `DELETE /api/weight/entries/{id}`, `POST /api/macros/entries`);
- a token without the scope gets `401`, a revoked token gets `401`, a deleted token gets `401`;
- env tokens still pass every switched route (no skill regression);
- a phone token never passes `requireBearer` / `requirePrimary`.

---

## 4. Pairing and Face ID

### 4.1 Minting and pairing

A new Clerk-gated web page, **`/settings/devices`** (kernel UI, not a module), lists every device
token — name, scopes, created, last seen, revoked — and does two things:

- **Pair a phone:** mints a token with `PHONE_SCOPES` and shows it **once** as a QR code, with the
  raw string below it for paste. Closing the page discards it; it can never be shown again.
- **Revoke:** per token, with a confirm. Uses `revokeDeviceToken` (§3.3.6).

This also gives the existing panel tokens a revoke button, which they don't have today.

The QR payload is JSON, not a URL: `{"v":1,"base":"https://justmy.website","token":"jmw_…"}`.
Not a URL so the system Camera app can't hand the token to Safari; only the app's own scanner
reads it. `base` lets a dev build pair against `http://<mac>.local:3000` from the same flow.

In the app, first launch shows **Pair this iPhone**: scan (VisionKit `DataScannerViewController`)
or paste. The app calls one allowlisted read to confirm the token works before saving it.

`npm run panel:token -- phone` gets a `phone` kind too, for pairing before the web page exists.

### 4.2 Storing the token

- One Keychain item, `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`, with a `SecAccessControl`
  of `.userPresence` (Face ID, falling back to the device passcode). Never synced to iCloud
  Keychain, never in `UserDefaults`, never logged.
- Reading the item is what prompts Face ID, so the lock is enforced by the Secure Enclave, not by
  an `if` in app code.

### 4.3 Locking

- **On launch** and **on return to the foreground after 5 minutes away**, the app shows a lock
  screen and unlocks with Face ID (reading the Keychain item). Under 5 minutes, no prompt.
- **App-switcher privacy:** when the app leaves the foreground it covers its content with the lock
  view, so the switcher snapshot shows no health data.
- Fetched data is held in memory only in v1; nothing is written to disk, so a locked app has
  nothing cached to read. (An on-disk cache is a "Later" item and would need file protection.)
- **Sign out / unpair** (in a Settings sheet) deletes the Keychain item. Revocation from the web is
  the remote kill switch: the next request gets `401`, and the app drops back to the pair screen.

---

## 5. Navigation map

The web UI is a flat list of six modules. On iPhone a tab bar shows five tabs before collapsing
into "More", and "More" is a poor home for a module used daily. The app groups the six into
**four tabs**, using the pairs the data already suggests:

| Tab | SF Symbol | Contents | Web equivalent |
|---|---|---|---|
| **Macros** | `fork.knife` | Day view | `/macros/[date]` |
| **Body** | `figure` | Segmented: **Weight · Vitals** | `/weight`, `/vitals` |
| **Training** | `dumbbell` | Segmented: **Lifting · Rides** | `/lifting`, `/rides` |
| **Shopping** | `cart` | The list | `/shopping` |

Settings (unpair, server, version) is a toolbar button, not a tab.

Within each tab, a `NavigationStack`:

- **Macros** — the day view for today (America/Chicago, the platform's day boundary). Swipe
  horizontally to page between days; a toolbar date picker jumps; a "Today" button returns. Tap an
  entry → entry detail (sheet, from the rollup's `EntryView`).
- **Body › Weight** — rollup (raw values + 7-day average, Swift Charts) with the web's window
  choices (30 / 90 / 365 / all), over the recent entries. `+` in the toolbar → **Log weight** sheet (§6).
- **Body › Vitals** — summary (the three trends, window 14 / 30 / 90 / all) up top, then a list of
  days; tap a day → day detail with sleep stages.
- **Training › Lifting** — session list (focus filter, needs-read count, the goal) → session detail
  (push), with each lift's e1RM sparkline from `/api/lifting/lifts/{templateId}` → a lift's full
  progression (push).
- **Training › Rides** — weekly strip (`/api/rides/weekly`) + ride list, paged as you scroll →
  ride detail (push): route on **MapKit** (an `MKPolyline` from the stream's `lat`/`lon` channels,
  `?streams=1`), stream charts and HR zones with Swift Charts, the summary facts.
- **Shopping** — the list; swipe or tap to check off; an add field pinned at the bottom (§6).

Everywhere: pull-to-refresh; refetch when the app returns to the foreground; skeletons while loading.

### 5.1 Design — a native pass, not a port

The web design language doesn't map one-to-one onto iOS, so the app gets its own design pass before
the read views are built: `docs/ios-design-brief.md`, for Claude Design, following the same Phase 2
pattern as the module design briefs. The split:

- **Carries over (the meaning).** These are product rules, not styling:
  - the semantic color roles from `docs/UI-CONTRACT.md` §1: one restrained accent, and
    success / warning / over;
  - tabular monospaced numbers, since this is a numbers instrument;
  - estimates always marked as estimates;
  - "glanceable first, detail on tap".
  The token *names* survive as named colors in the asset catalog (light and dark), so web and app
  talk about the same roles.
- **Goes native (the structure):**
  - the tab bar and navigation stacks instead of the nav rail;
  - grouped lists and system materials (Liquid Glass) instead of custom card surfaces;
  - SF Pro and SF Mono instead of the web fonts, with Dynamic Type;
  - SF Symbols;
  - swipe actions, sheets, and pull-to-refresh.
  The display font and the web's custom chrome don't come along.
- **New to design:** the hero treatment of each tab's top screen (the macros day, the weight trend);
  chart styling in Swift Charts; the MapKit ride route over the stream charts; the lock and pair
  screens; the app icon.

The brief has to be settled before the read views (§10).

**Open for Curtis:** grouping into four tabs vs. six flat tabs (five + More). The grouping is the
recommendation; it's a one-file change either way.

---

## 6. v1 scope

### In

- Pairing, Keychain + Face ID lock, unpair (§4).
- All six modules readable, as mapped in §5.
- **Log a weight** — number + date (defaults to today) + optional note → `POST /api/weight/entries`.
  The route is an **upsert per day** (returns `200`, not `201`): if the day already has an entry the
  sheet shows it and says the new number replaces it, the same as the web.
- **Add a shopping item** (`category` + `text`) → `POST /api/shopping/items`, then refetch `/list`.
- **Check / uncheck a shopping item** → `PATCH /api/shopping/items/{id}` with
  `status: "bought" | "needed"`, then refetch `/list`. Optimistic in the UI, reverted on error.
- Error envelope surfaced honestly: a validation `400` shows the server's message; a `401` means
  unpaired/revoked and returns to the pair screen; network failure keeps the last data on screen
  with a banner.

### Out of v1 (named so the seams stay open)

- **Food logging / editing macros** — stays with the `manage-macros` skill.
- **Edit or delete** anything, including weight entries and shopping items (soft-delete stays off
  the allowlist).
- **Lifting goals, ride names/notes** — editable on the web or via skills.
- **Offline mode / on-disk cache / queued writes.**
- **iPad, Mac, Watch layouts.** iPhone only; iPad runs it as a phone app.
- **App Store distribution.** It's a one-person app (§8).

---

## 7. API coverage gaps

Audited 2026-10-21: every web page's data vs. what the token API returns, per module. Done against
the code on `main` at `e324f24`.

**Headline: every v1 view's data is reachable through existing read endpoints. No new route is
needed.** The gaps are smaller, and fall into three kinds:

1. **Domain logic that lives in web components.** A native client would have to reimplement it,
   which the layering rule forbids. It should move into `src/lib/{module}` first.
2. **Paging and time-zone work.** The client has to do these because the web page does them
   server-side.
3. **Shape divergences** between list and detail routes (#40). These are mostly avoided by the
   v1 allowlist.

The line between "presentation" (fine to do in Swift) and "domain" (must come from the server):

- **Presentation:** unit conversion (kg→lb, °C→°F, m→mi), deltas between adjacent rows, counts
  over a returned series, chart scaling, time-zone formatting of a timestamp, choosing which stat
  tiles to show.
- **Domain:** thresholds and states judged against a target, aggregates with business rules
  (which sport, which weekday starts a week), defaults the schema doesn't apply.

### 7.1 Domain logic to move into `src/lib` (before or with the app view that needs it)

| Module | What | Where today | Fix |
|---|---|---|---|
| macros | `barState`, `trackSummary`, `targetCaption` — the under/in/over state and wording of each macro against its target | `src/components/macros/macro-state.ts` | Move to `src/lib/macros/` and expose the per-macro state on `GET /api/macros/days/{date}` (exposure of existing logic, the same move as panel-contract 1.1). **Coordinate with #49**, which is redesigning exactly this goal/floor/lever presentation. If #49 is still open when the app reaches macros, v1 shows numbers vs. target without a state color rather than copy logic that's about to change. |
| shopping | Blank category becomes `"Uncategorized"` | `ShoppingBoard.tsx:89` (the API rejects a blank category) | Move the default into `shoppingCreateSchema`, so web, API and app share it. |
| rides | The weekly strip's aggregate (cycling only, Monday-start weeks) | `src/app/(app)/rides/page.tsx`, computed over the 200 rides it loads | Have the page use the repo function behind `GET /api/rides/weekly`, and confirm the numbers match. Then app and web can't drift. |
| vitals | Sleep total = max(`sleepTotalSeconds`, sum of stages) | `SleepStages.tsx:24` | Small. Move to `src/lib/vitals/` and expose it on the day view, or decide the raw total is right. |

### 7.2 Client-side work the app must do (no server change)

- **"Today" is America/Chicago** (`APP_TZ`, `src/lib/date.ts`, overridable by `JMW_TZ`). The web
  decides it on the server; the app has to decide it itself, with a fixed
  `TimeZone(identifier: "America/Chicago")`, not the phone's zone. That way a trip to another time
  zone doesn't move the day boundary. Ride start times ("7:46 PM") are formatted the same way.
- **Paging past 100.** The API caps `limit` at 100 (`src/lib/http/pagination.ts`). The rides page
  loads 200 in one go, and the vitals "all" window needs up to 365 days. The app pages: the ride
  list loads more as you scroll; vitals "all" fetches in pages by `from`/`to`.
- **Lifting needs-read count.** The web counts over its 100 loaded sessions. The app reads `count`
  from `GET /api/lifting/sessions?interpreted=false&limit=1`, which is exact rather than
  capped at 100.
- **Lift sparklines are N+1:** one `GET /api/lifting/lifts/{templateId}` per exercise, the same as
  the web page does. That's fine for a session's handful of exercises. A batch endpoint can wait
  until it's measurably slow.
- **Enums** (lifting focus, ride sport, shopping status) come from the generated client, i.e. from
  Zod. They're never hand-copied, unlike `FOCUSES` in `src/components/lifting/format.ts`.

### 7.3 Shape divergences (#40 and adjacent)

- **macros:** `GET /entries` and the day rollup return `EntryView` (with the resolved `name`), but
  `GET /entries/{id}` returns the raw `MacroEntry` row (`getEntryById`, `src/lib/macros/repo.ts`).
  The app avoids this by using the rollup's `EntryView`. It should still be fixed under #40.
- **shopping:** `GET /list` returns the view shape; `GET /items` and `/items/{id}` (and the POST/PATCH
  responses) return raw rows. The app reads only `/list` and refetches after each write.
- **rides:** sentinel zeros (`restingHeartRate: 0` in the zone block; `distanceMeters` /
  `avgSpeedMps` of 0 on elliptical activities) are already tracked in #40. The app shows them as
  "—", not 0, until #40 fixes them at the source.

Not gaps: macros day view (`/days/{date}` *is* `getDayRollup`), weight (`/rollup` is the same
`getRollup`), lifting detail and progression, ride streams/map (`?streams=1`), vitals summary
(`/summary` is the same `getRollup`), shopping list (`/list` is the same `getList`).

---

## 8. Project shape

```
ios/
  JustMy.xcodeproj
  JustMy/                 — the app target (SwiftUI)
    App/                  — entry point, lock, pairing, settings
    Modules/{Macros,Weight,Lifting,Rides,Vitals,Shopping}/
    Shared/               — formatting, chart styles, error banner
  JMWClient/              — local Swift package: the generated API client
    Package.swift
    Sources/{Macros,Weight,…}API/   — one target per module
  README.md               — build, run, pair, sign
```

- **Generated client.** `swift-openapi-generator` (Apple's) produces one client per module from the
  checked-in `openapi/{module}.json` (OpenAPI 3.0.3, which it supports). The spec stays downstream of
  Zod, and the Swift client stays downstream of the spec. Field names arrive verbatim — the same
  schema.org names the skills use (`proteinContent`, `calories`, …), no aliases. Whether the
  generator's build plugin can read the specs via a symlink into each target, or needs a copy step
  added to `npm run openapi:build`, is settled during the scaffold.
- **Dependencies:** `swift-openapi-generator`, `swift-openapi-runtime`,
  `swift-openapi-urlsession`. Nothing else third-party; Charts, MapKit, VisionKit,
  LocalAuthentication and Security are system frameworks.
- **Base URL:** from the pairing payload, so a dev build points at the local dev server and the
  phone points at production, with no code change.
- **Signing:** Curtis's personal team. A **free** Apple ID can build to his own iPhone from Xcode,
  but the provisioning profile expires every 7 days (rebuild to renew). The paid Developer Program
  ($99/yr) removes the expiry and adds TestFlight. Some of the "Later" capabilities may require the
  paid program; check each one when it comes up rather than assuming. v1 needs nothing beyond the
  free tier.
- **Tests:** unit tests for the pairing payload parser, the lock timer and day-boundary math;
  everything else is verified by running it in the Simulator and on the phone. No Swift in CI in v1.

---

## 9. Later — native-only (not v1)

The reason to go native at all. Not scoped; listed so v1 doesn't paint them into a corner.

- **Widgets** (Home Screen / Lock Screen): today's macros remaining, the weight trend. Needs the
  token readable by an extension, so the Keychain item moves to a shared access group then.
- **Live Activity** during a ride or lift.
- **App Intents / Siri / Shortcuts:** "log my weight 178".
- **HealthKit:** read-only context alongside vitals, or writing weight to Health. Either direction is
  a scoping conversation of its own — it touches the "the watch is the source of truth" rule.
- **A cross-module Today tab**, built client-side under the §9 cross-cut rules.
- **Notifications:** none in v1; there is no server push infrastructure.

---

## 10. Open / deferred

- **Tab grouping** (§5) — four grouped tabs recommended; six flat is the alternative.
- **Native design brief** (§5.1) — written: `docs/ios-design-brief.md` (#71). The read views (#73) build to
  the design Claude Design returns from it.
- **Paid Developer Program** — not needed for v1; revisit if a "Later" item needs it.
- **#23 (Clerk production instance)** — independent of this app, which never talks to Clerk.
