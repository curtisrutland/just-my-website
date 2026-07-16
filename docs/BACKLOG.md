# justmy.website — backlog & tracker

Running tracker for outstanding work, deferred decisions, and refinements. Newest context at
the top of each section.

## Build roadmap

- [x] Infra: git, Neon, Clerk, tokens, USDA key (provisioned + verified)
- [x] Data layer: Drizzle schema (live on Neon), Neon client
- [x] Zod schema + normalization
- [x] Repo + day-rollup (live-tested)
- [x] USDA resolver (mapper + cache-on-first-resolve)
- [x] Auth/http kernel (two-token, error envelope, pagination)
- [x] Token API routes (CRUD + rollup + USDA; 20 live smoke checks)
- [x] Next 16 skeleton (Clerk, next/font, Tailwind theme, proxy)
- [x] **UI Phase 1** — AppShell chrome + DayRollup hero (approved)
- [x] **UI Phase 2** — EntryList/EntryRow + add-entry prompt + day-navigation row + sticky-shell fix
      (chrome fixed, only content scrolls) (approved)
- [x] **UI Phase 3** — real data via repo (server components), day nav (links), day-kind persist +
      entry correct/soft-delete (server actions), Clerk UserButton, seed script. Option A: the web
      corrects + deletes entries; *adding* is Claude's path (skill). Add-entry prompt is a non-wired
      placeholder until the skill lands.
- [x] **Root landing** (Index) — gated `/` module list (macros LIVE, shopping SOON) + no-flash
      theme script in the root layout (persisted theme applied before paint, app-wide).
- [x] **Skill + Python client** (`manage-macros`) — SKILL.md + client.py (httpx) over the token API;
      verified end-to-end against the live API (log/review/correct/tag/delete, 12/12). Claude's write path.
- [x] **Build scripts** — `build-skills.ts`→ token-injected skill under `skills/dist` (gitignored);
      `build-openapi.ts` → OpenAPI generated from Zod (`npm run build` prebuild works).
- [x] **UI Phase 4** — mobile/responsive pass (done). Shell scaffold moved to CSS classes
      (`.shell/.rail/.rail-*/.topbar/.content`) so a single `@media(max-width:768px)` block reflows
      it: nav rail → top bar with a horizontal module-chip strip, stat grid 4→2, weigh-in table drops
      the NOTE column, macros day-nav stacks + week strip scrolls, entry/macro grids tighten. MacroBar
      swaps its multi-word state for a directional glyph on mobile (was wrapping + shoving the value).
      Verified at a true 390px viewport (`scrollWidth === 390`, no overflow).
- [x] **First deploy** — pushed to GitHub, Vercel production live at `justmy.website` (apex → www);
      API confirmed end-to-end against the domain. Auth is on the Clerk **dev** instance for now.
- [ ] **Switch auth to Clerk production** on `justmy.website` (deferred — intentionally on dev for now).
      Point the prod Clerk instance at the domain → add its DNS records in Squarespace (`clerk.`,
      `accounts.`, email DKIM CNAMEs) → set `pk_live`/`sk_live` in Vercel prod env → redeploy. The
      prod instance is already configured (email-only, restricted, Curtis's user). Until then the UI
      runs on the dev instance (dev banner, usage limits, `accounts.dev` sign-in).
- [x] **Skills uploaded + validated** — both `manage-macros` and `manage-weight` rebuilt against
      `justmy.website` (stdlib client, `name` param), verified end-to-end against prod with system
      python3, and now **uploaded to claude.ai and validated** (publish step done). Zips are at
      `skills/dist/manage-macros.zip` and `skills/dist/manage-weight.zip`.
- [x] **Weight module** — second module, full anatomy: `src/lib/weight/` (schema + normalization,
      repo with day-rollup + windowed stats, repo tests), `src/app/api/weight/` (days/entries/rollup
      routes), `src/app/(app)/weight/` (live trend, stat tiles, entry form + list, correct/soft-delete
      server actions). Wired as an active nav item and landing card; OpenAPI fragment generated
      (`openapi/weight.json`). Live.
- [x] **Shopping module** — third module, full anatomy per `docs/shopping-model.md` +
      `docs/shopping-design-handoff.md`: `src/lib/shopping/` (schema, repo with two-section
      `getList`, repo tests — 4 suites green vs Neon), `shopping_item` table + migration
      `0003_*` (applied), `src/app/api/shopping/` (items/[id]/list; 11 live smoke checks incl. the
      two-token rule), `src/app/(app)/shopping/` + `src/components/shopping/ShoppingBoard.tsx` (the
      web-primary full editor — grouped list, check-off grace timer with linger/drain/undo, inline
      edit, collapsed recently-bought). Nav chip + landing flipped to LIVE (landing now "3 modules ·
      3 live"); OpenAPI fragment registered (`openapi/shopping.json`); README + ARCHITECTURE table
      updated. `manage-shopping` skill built + verified (see below). Local UX pass done (2.5s linger,
      recipes-style confirm-delete, mobile always-visible actions, row-tap toggle, "recently checked").
      **Deployed to production** (`justmy.website`, commit `e1a0d81`): live API verified end-to-end
      against the domain (`/api/shopping/list` 200 with the two-section shape; 401 unauthed); prod
      shares the same Neon DB where the migration was applied. Authenticated page render is Curtis's
      to confirm in-browser (auth-gated; can't be checked headless).

## Panel module (kitchen wall panel) — scoped, not started

New module: a wall-mounted Pi 3 / 7" touchscreen (720×1280 portrait, kiosk Chromium) at
`/panel`, read-mostly, three tabs (Health / Shopping / Recipe), built for five. Full spec:
`docs/panel-contract.md` (binding — wins on conflict), `docs/panel-design-brief.md` (design,
**done**), `docs/panel-code-brief.md` (implementation how/order). New module ⇒ owes an OpenAPI
fragment + docs/README/ARCHITECTURE wiring per `docs/MODULE-RUNBOOK.md` — nothing auto-wires it.

**Build order** (code brief §1; 1–5 strictly ordered, desk work only until step 8):
- [ ] 1. `device_tokens` table + panel auth guard (Bearer-first, Clerk-session fallback)
- [ ] 2. `panel_state` table
- [ ] 3. KV wiring + `/api/panel/version` + bump calls on every existing write path
- [ ] 4. `GET /api/panel/health` · `/shopping` · `/recipe`
- [ ] 5. `POST /api/panel/recipe` + validation + JSON-LD normalizer (+ raggedness unit tests)
- [ ] 6. `/panel` UI — three routes + tab bar (server-rendered; verify at 720×1280 desktop)
- [ ] 7. Two write actions wired (shopping check-off, day-type)
- [ ] 8. Pi: OS Lite, X11 + WM, kiosk Chromium, systemd restart, static IP, screen-blank
- [ ] 9. justmy.recipes "Send to Panel" button (server-side, service token never in browser)

**Decisions locked (2026-07-16, discussion with Curtis):**
- **Version bump seam** → new `src/lib/panel/` module owns `version.ts` exporting a
  fire-and-forget `bump(section)`; the `macros`/`weight`/`shopping` repos import it and call it
  *after* the DB write commits. A missed bump = stale-until-next-change, never a failed write.
  ⚠ **Sanctioned exception to the self-contained-module rule** — document it in `AGENTS.md` at
  build time (reacting to writes elsewhere is the panel's whole purpose).
- **KV** → **Upstash Redis via the Vercel Marketplace** (Vercel KV is sunset). Curtis provisions
  the one Marketplace auth handshake; Claude drives `vercel integration` + `vercel env pull`.
  Reads ~29K/mo, writes ~1–2K/mo — comfortably free-tier.
- **Auth** → **coexist**, not a token-table migration. Env tokens (`JMW_API_KEY`/`JMW_AGENT_TOKEN`)
  keep guarding `/api/**` untouched; new hashed/scoped/revocable `device_tokens` guards
  `/api/panel/**`. ⚠ **Two documented `AGENTS.md` exceptions** to write at build time: (a) two
  token systems by design; (b) `/api/panel/**` accepts a Clerk session — a deliberate, scoped
  bend of "API is token-only, always," justified by the no-hardware dev path (Curtis OK'd both).
- **Weight `trend`** → window **30 days** (matches the as-designed screen); `trend` enum derives
  from the signed `trendPerWeek` with **deadband = display precision** (rounds to `0.0 lb/wk` ⇒
  `flat`). Whole weight block maps from `getRollup({ windowDays: 30 })` — no new math.
- **Contract v1.1** → `toWaypoint` **dropped** (weight tracks trends, not goals — would've been
  net-new); added `trendPerWeek`, `series`, `windowDays`, `range`. Reconciled in
  `docs/panel-contract.md`; the frozen `~/Downloads` bundle is intentionally left stale.
- **Design delivered + validated (Claude Design "Wall Panel")** — reviewed against contract v1.1;
  every rendered field maps, nothing rendered that the contract can't supply, so **no further
  contract changes**. Two-phase recipe solved as Overview ↔ Step-through + a bottom ingredients
  drawer; shopping grouped-by-category with a collapsed "GOT IT" (uncheckable) section; tab bar
  `flex:1` (5-ready). Panel type scale + colors captured in contract §11.
- **Fonts** → design uses 3 Google families (Space Grotesk / IBM Plex Sans / JetBrains Mono).
  **Self-host all three via `next/font`; drop the Google `<link>`** (Pi 3 has no font cache /
  flaky overnight net). Branded families kept, brief §2 honored. (Contract §11.2.)
- **Over-target color** → floor-vs-ceiling model (Curtis): **amber appears only when a ceiling
  (kcal/fat/carb) is exceeded** (red panic retired). Protein is a **floor** — **neutral while
  short (no nag), success-green when met**; protein never shows amber. Full table in contract §11.4.
- **Unspecified day-type target** → resolve to the **lower-calorie profile, wholesale** (not a
  per-field min). Conservative for the driving ceilings; moot while flat. (Contract §5.1.)

**Verified before building (code brief §0):**
- **Neon compute is a non-problem today** — 5.7 / 100 CU-hrs this billing window (~6%), compute
  Idle/autosuspending correctly. §4.1 (KV-backed version endpoint) is still mandatory: a naive
  60s DB-poll would keep `.25 CU` awake ~16h/day ≈ **120 CU-hrs/mo, over the whole allowance** on
  its own. So: do it right, no schedule pressure.
- **Central write seam exists** — every module's `repo.ts` is the sole table-touch point and both
  surfaces (token API + Clerk actions) funnel through it, so ~15 named write functions are the
  bump insertion points (no shared write helper; bump goes per-function via `bump()`).
- **No KV/Redis provisioned yet** (step 3 setup, not a blocker).

## Bugs — fixed

- [x] **"today" used UTC in production.** Fixed: `todayISO()` computes the date in Curtis's timezone
  via `Intl` (`America/Chicago`, overridable with `JMW_TZ`) — correct on any server zone. (Vercel's
  `TZ` env name is reserved, so it's in code.) Deployed + serving.
- [x] **Entries rendered "ad-hoc".** Fixed: added `name` to `macro_entry` (migration); `log_entry`
  takes a `name`; the rollup coalesces entry-name → food-name. Verified live (`foodName` shows the
  label).

## Skill hardening (from claude.ai feedback) — fixed

- [x] **Targets configured** — training/rest profiles set (2800 / 2200), so tagged and unspecified
  days resolve target(s). Verified live.
- [x] **Zero dependencies** — `client.py` rewritten on the stdlib (`urllib`); ran green with system
  `python3` (no venv, no pip).
- [x] **Egress declared** — SKILL.md states the skill needs `https://justmy.website`.
- [x] **`log_entry` return clarified** — SKILL.md shows capturing the created entry to confirm inline.
- [x] **`log_entry` `name` param** — entries are self-describing (see the ad-hoc fix).

## UI refinements

- [x] **Remove the add-entry ("log ›") prompt from the macros page.** Done — `AddEntryPrompt` is gone
  from `DayContent`; the web only corrects/deletes (Option A), adding is Claude's skill path.
- [x] **Index/home link in the sidebar.** Added a terminal-style `../` link at the top of the nav
  rail (matches the shell breadcrumb metaphor) that returns to the root module switcher.
- [x] **Equal module-header heights.** The terminal header bar's height tracked its `headerRight`
  child, so macros (tall day-kind segmented control) and weight (short TREND readout) differed and
  content shifted on module switch. Fixed with a `minHeight: 55` + `box-sizing: border-box` floor on
  the shared `AppShell` header; shorter content centers.
- [x] **Macros nav = soft navigation.** `/macros` is a `force-dynamic` redirect stub → linking it
  forced a hard reload (redirect hop, no prefetch). Nav rail + landing now link straight to
  `/macros/${todayISO()}` (a real, prefetchable page); root page is `force-dynamic` so today isn't
  baked at build.
- [x] **`justmy.recipes` cross-link.** Done (⚠️ uncommitted/undeployed): a subtle sidebar-rail link
  + a fully-branded landing row, in the recipes brand color `#c9804f`. Built from the design's
  Index/Weight update. Landing footer now reads "3 modules · 2 live · 1 site". Commit + deploy pending.
- [x] **GitHub link in the sidebar + index.** Done — a muted "off-site" repo link in the nav rail
  (grouped with `recipes`, outline marker + `REPO ↗`) and a matching neutral row on the landing
  (outline `◇` vs recipes' filled `◆`; footer reads "N off-site").
- **Food list rows → clean two-row item on mobile ([#3]).** On the macros page the food/entry list
  (`EntryList`/`EntryRow`, `.entry-grid`) is a single 6-column row — `FOOD name | KCAL | P | F | C |
  caret` — kept as one row on mobile too (mobile `.entry-grid` is just narrower:
  `minmax(0,1fr) 48px 32px 32px 32px 20px`, `src/app/globals.css` ~L341-343). That leaves ~190px for
  the name on a 390px screen, so names truncate hard ("Chocolate stra…", "2 Alaska cod fi…"). Want:
  each entry lays out as a **two-row item** on mobile — the full food name (with its MEAS/EST/SRV badge
  and qty) on line 1, wrapping without an ellipsis; the KCAL/P/F/C numbers on line 2. Everything fits,
  nothing truncates.
  - **Not pure CSS.** The name span carries *inline* `whiteSpace:nowrap; overflow:hidden;
    textOverflow:ellipsis` (`EntryRow.tsx` L58), and inline styles can't be overridden by `@media` —
    so the truncation lives in the component, not the stylesheet. Move those onto a class (e.g.
    `.entry-name`) so the mobile rule can allow the name to wrap.
  - **Reflow the grid.** Give mobile `.entry-grid` a two-row `grid-template-areas` layout (name block
    spanning row 1, the four numbers + caret on row 2) instead of the 6-across columns; assign each
    `EntryRow` cell to its area via a class.
  - **Header row.** `EntryList`'s `FOOD/KCAL/P/F/C` header also uses `.entry-grid` (L23-29) and won't
    line up over the new two-row items — hide it or simplify it on mobile.
  - Files: `src/app/globals.css`, `src/components/macros/EntryRow.tsx`, `src/components/macros/EntryList.tsx`.
    Verify at a true 390px viewport (full names visible, no overflow, numbers still aligned). **Effort: S.**
- **DayRollup hero corridor legibility.** When the day is "in range" (unspecified), the value fill
  is solid cyan and the corridor band is also cyan-tinted, so they blend and the "honest corridor"
  reads less crisply than it should — and it's the single most important element. Proposed: make the
  value fill more translucent, strengthen the corridor's accent hairline edges, and make the
  text-colored value marker more prominent, so the total visibly sits *within* the rest→training
  corridor. (Raised Phase 1; approved look otherwise.)

## Future modules

- _(none queued — macros, weight, and shopping are all live.)_

## PWA — installable to home screen ([#4])

**Decision: standalone-only, no service worker.** Offline was explicitly ruled out (single-user private
data tool — caching auth-gated personal data on-disk buys little and risks stale reads; the fork's PWA
guide confirms install prompts work without offline). So no SW, no `@serwist`/webpack detour. The shell
is already a fixed-frame layout, so `display: standalone` is a natural fit.

- [x] **Manifest** — `src/app/manifest.ts` (Next metadata route → served at `/manifest.webmanifest`):
  name/short_name, `start_url: "/"`, `display: standalone`, `background_color`/`theme_color` `#0a0d0f`
  (the dark `--color-bg`), icons array.
- [x] **Icons** — `scripts/build-icons.mjs` (sharp) rasterizes `src/app/icon.svg` →
  `public/icons/icon-{192,512}.png` (purpose `any`) + `icon-maskable-512.png` (full-bleed bg, mark in
  the safe zone). `apple-icon.png` still covers the iOS apple-touch-icon; re-run the script if the SVG
  changes.
- [x] **iOS/viewport meta** — `layout.tsx` now exports `viewport` (`themeColor #0a0d0f`,
  `viewportFit: "cover"`, `colorScheme`) and `metadata.appleWebApp` (`capable`, title `justmy`,
  `statusBarStyle: "black"` — opaque bar above the app, so no notch underlap / safe-area work). The
  `manifest.ts` file convention injects the `<link rel="manifest">` automatically.
- [x] **Auth-proxy reachability** — no `proxy.ts` change needed: the matcher already whitelists
  `webmanifest` and `png`, so `/manifest.webmanifest` and `/icons/*.png` are served unauthenticated
  (verified by testing the matcher regex). The earlier `.json` gotcha doesn't bite because Next serves
  the manifest as `.webmanifest`. `start_url: "/"` stays auth-gated (correct — launching the app lands
  on the Clerk-gated switcher).

**Verified here:** `tsc` clean; `next build` compiles + typechecks the PWA additions successfully
(build only stops later on `DATABASE_URL`, the pre-existing env need); `manifest()` output shape and
icon dimensions checked; icons eyeballed. **On-device iOS install: tested + valid** (Curtis confirmed
add-to-home-screen → full-screen standalone, status bar, icon on the live deploy). **PWA done.**

**No in-app data-refresh affordance (Curtis, 2026-07-10).** In the standalone PWA there's no browser
chrome, so the only way to pull fresh server data is to navigate away from a page and back (which
re-runs the server-component fetch). Because data is written by Claude out-of-band (the skills), the
web view can sit stale with no way to re-pull from within the app. Want an explicit refresh
affordance — pull-to-refresh on the content area and/or a refresh control in the terminal header —
wired to `router.refresh()` (re-fetches server components in place, no full reload). Shared-shell
concern → applies to all three modules. **Effort: S.**

**Deferred (only if a concrete need appears):** a service worker for **offline** and/or **web push**
(iOS push requires an installed PWA + SW). Both are purely additive later — none of the above blocks
them.

## Ingredient registry (extend macros `/foods` — NOT a new module)

Full scoping brief: **`docs/ingredient-registry-brief.md`** (drafted, awaiting Curtis's review of the
five open decisions). Summary + correction of an earlier mis-scope below.

**Why:** logging a smoothie re-derives per-gram macros from Claude's memory every time, so the *same
product* drifts day-to-day (a near-identical smoothie logged 47g protein one day, 34g the next — pure
Claude-side estimation churn on branded/label items: Ripple, Sports Research whey, Icelandic skyr).
Fix reuse at the **ingredient** level (atoms recur across variations), not the recipe level (too many
variations to enumerate). Resolve each product once, reuse everywhere — same pattern as `resolve_usda`.

**Scoping correction:** this is **not** a new module and does **not** start from `MODULE-RUNBOOK.md`
(an earlier backlog note wrongly framed it that way). The macros `/api/macros/foods` catalog already
stores per-100g foods with `name`/`source`/`fdcId`/`servingLabel`/`servingGrams` + macros, and entries
already link a food via `foodId`. The brief's recommendation is to **extend `/foods` additively**, not
fork a parallel `/ingredients` table (which would desync from the existing entry-linkage). Work:
  - **Additive food fields:** `brand`, `category` (required enum, small closed list, `other` escape
    hatch), `tags` (freeform — deliberately *not* a controlled vocabulary yet), `labelBasis` (printed
    serving + macros stored verbatim so the /100g is auditable) — plus **expanding the existing
    `source` enum** to `usda|scanned|proxy|estimated` so provenance/trust is first-class (no separate
    `confidence` field — that word is already the entry-level enum).
  - **Skill methods** mirroring `MacrosClient`: `search_ingredient` (fuzzy + category/brand filter,
    never auto-picks), `resolve_ingredient` (cache-on-resolve), `register_ingredient` (**mandatory
    dedupe-on-write** — surfaces likely dup rows so Claude picks update-vs-new), `update_ingredient`
    (upgrade a proxy→scanned in place, same id; errors on unknown field like `correct_entry`).
  - **manage-macros integration:** log-from-registry, preferring **link-via-`foodId`** with
    snapshot-at-log-time preserved (correcting a food later must not rewrite past days).
  - **No UI for v1** — skill-first.

**Open decisions — RESOLVED (Curtis, 2026-07-08; see brief):** extend `/foods` (not a new table);
category enum = brief's list + `egg|legume|beverage|cheese`; linkage via `foodId` (option 1, already
in `snapshotMacros()`); collapse provenance into the expanded `source` enum (`custom`→`estimated` on
migrate); skyr proxy→scanned is a later validation step, not a build gate. Related: the "USDA branded
foods" deferred note below is the same per-serving↔per-100g tension — `labelBasis` captures the printed
per-serving values, /100g is computed from them. **Status: BUILT + verified locally on branch
`ingredient-registry`** — migration `0004` (new food fields + `custom`→`estimated`, applied to Neon),
expanded `source`/new `foodCategory` Zod enums, `listFoods` category/brand filters, `search`/`register`
(dedupe)/`resolve` (session cache)/`update` (loud) methods on `manage-macros`, SKILL.md registry section,
OpenAPI regenerated. 48/48 tests green. **DONE + LIVE** (PR
[#7](https://github.com/curtisrutland/just-my-website/pull/7) merged, deployed to `justmy.website`,
verified end-to-end against the prod domain — register/dedupe/update round-trip). Ingredient adding
has been exercised successfully in real use. skyr `proxy`→`scanned` upgrade remains as a natural
future validation when its label is in hand (not a task).

## Pending publish / follow-ups

- [x] **`manage-shopping` skill** — built (`skills/manage-shopping/` — SKILL.md + stdlib Python
  client over `/api/shopping/**`; batch-add, read-the-list, check/uncheck, edit, soft-delete) and
  verified end-to-end against the local dev server (9/9 checks, system python3). Registered in
  `build-skills.mjs`; zip at `skills/dist/manage-shopping.zip`. First upload shipped a zip pointing at
  `localhost:3000` (the build's old default) — **fixed**: `build-skills.mjs` now defaults the base URL
  to `https://justmy.website` and warns on localhost; the zip was rebuilt with the prod URL. Uploaded
  to claude.ai (done).

- **Shopping refinements (deferred within scope, from `docs/shopping-model.md`).** Store-aisle
  category order (alphabetical for now); old-bought purge (filter-only for now); a real-browser pass
  on the live check-off/linger interactions (verified via SSR + data/API so far).

## Soft-delete recovery (trash + undelete)

From claude.ai: the agent can soft-delete but has no way to undo it — no API path and no UI to
restore — so a soft-delete "feels hard." Soft-delete is a kernel convention (`deletedAt`,
CONVENTIONS §5), so recovery is **cross-cutting** (macros / weight / shopping all soft-delete the
same way). Auth model by symmetry: the agent may soft-delete **and restore** (both non-destructive);
only the primary key may hard-delete / purge — so the agent can fully reverse its own deletes but
never permanently destroy.

**Status: both tracks backlogged, not scheduled.** Low urgency in practice — if the agent deletes
something by mistake it can just **recreate** it, and soft-deleted rows are visible/recoverable
directly in **Neon's admin view** in the meantime. Revisit if that ever feels insufficient. The
scope below is kept as-is for when we do pick it up.

- **Undelete via API + skill (scoped, deferred).** Per module: `restoreItem(id)` (finds the
  soft-deleted row bypassing the `live` filter, clears `deletedAt`) + `listDeleted()` in the repo;
  `POST /api/{module}/items/{id}/restore` (agent-allowed, `requireBearer`) + a trash read
  (`GET /api/{module}/trash`); a `restore_item` / `list_trash` method on each skill client +
  SKILL.md guidance. Document restore in CONVENTIONS §5. Dedicated restore endpoint (not a PATCH
  overload). When picked up, decide: all three modules at once, or shopping-first.
- **Web trash view (UI — deferred).** A per-module view of soft-deleted rows where Curtis can Restore
  or **Purge** (hard-delete). The web writes via server actions → repo directly (Curtis is fully
  trusted; the two-token rule is an API-surface concern), so Purge is a server action calling
  `hardDelete`. Consumes the same `listDeleted()` read.

## Deferred decisions

- **Clerk lockdown = Restricted sign-up mode + a manually-created user** (allowlist is Clerk Pro-
  only, not needed). **Production instance** already configured (email-only, Restricted, Curtis's
  user) — done early; still needs a real/verified domain to activate at deploy.
  **Development instance** (what local dev + the `_test_` keys use) is NOT yet configured — mirror
  the same settings there if we want the locked-down flow locally; otherwise dev defaults to public
  sign-up (fine for local, your machine only).
- **Mobile handled in code, not designed.** No separate mobile design spec — the design system is
  established and the web UI's mobile role is review-focused (logging goes through Claude, not the
  form). Responsive reflow done in code (Phase 4), reviewed live. Revisit a design ref only if the
  signature hero's small-screen treatment needs bespoke attention.
- **EntryRow "time" column.** The design's EntryRow grid includes a time column, but the data model
  deliberately stores no entry time (date-keyed only, no meal slots). Phase 2 drops the time column.
  Revisit only if we ever decide to store entry timestamps (currently out of scope).
- **USDA branded foods.** The resolver maps `foodNutrients` as per-100g (correct for Foundation /
  SR Legacy / Survey). Branded foods carry per-serving `labelNutrients`; if branded logging matters,
  add per-serving→per-100g normalization. Currently we prefer the cleaner per-100g data types.
- **Local sign-in pages.** Using Clerk hosted sign-in for now (fine for a 2-user tool). Add
  `app/sign-in/[[...sign-in]]` + `app/sign-up` and the `NEXT_PUBLIC_CLERK_SIGN_IN_URL` env vars if we
  want the auth flow on our own domain.

## Tech debt / cleanup

- **Vercel Analytics.** Add `@vercel/analytics` and drop `<Analytics />` into the root layout to
  enable web analytics. (Consider `@vercel/speed-insights` + `<SpeedInsights />` at the same time.)
  Note: single-user private app behind auth, so traffic volume is tiny — value is mostly Web Vitals /
  confirming the deploy is healthy, not audience metrics.
- [x] **Documentation audit.** Swept README, AGENTS/CLAUDE, CONVENTIONS, the OpenAPI generator, and
  both skills against the code. Skills + the auth/error/pagination/nutrition kernel verified accurate.
  Fixes: **weight added to the OpenAPI generator** (`build-openapi.ts` now emits `openapi/weight.json`
  too — makes the "per-module fragment" convention true); README de-scaffolded (weight + both skills,
  `weight_entry`, `db:seed`, weight docs); `CONVENTIONS §7` documents the upsert `200`+Location
  carve-out; `CONVENTIONS §8` fixed `macroDailyTarget`→`macroTargetProfile` + added `weightEntry` and
  the OpenAPI fragment; `HANDOFF-CODE` dropped the stale `+ httpx` (clients are stdlib-only).
- **`/preview` route** is dev-only (404s in prod, guarded in proxy). Keep as a component preview
  harness or remove before/at first deploy — decide at deploy time.
- **API observability.** Route handlers have no per-request logging (Vercel function logs cover the
  basics). Add structured logging/error tracking if debugging needs it.
- **Preview env for `JMW_*` tokens.** Skipped due to an outdated Vercel CLI quirk; add before the
  first preview deploy (or after `npm i -g vercel@latest`).

[#3]: https://github.com/curtisrutland/just-my-website/issues/3
[#4]: https://github.com/curtisrutland/just-my-website/issues/4
