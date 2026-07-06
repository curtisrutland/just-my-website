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
- [ ] **UI Phase 4** — mobile/responsive pass, handled in code (not a separate design spec).
      Reflow: nav rail → compact top bar/drawer, macro grid 3-col → 1-col, entry table → stacked,
      hero corridor full-width. Reviewed live like the other phases.
- [x] **First deploy** — pushed to GitHub, Vercel production live at `justmy.website` (apex → www);
      API confirmed end-to-end against the domain. Auth is on the Clerk **dev** instance for now.
- [ ] **Switch auth to Clerk production** on `justmy.website` (deferred — intentionally on dev for now).
      Point the prod Clerk instance at the domain → add its DNS records in Squarespace (`clerk.`,
      `accounts.`, email DKIM CNAMEs) → set `pk_live`/`sk_live` in Vercel prod env → redeploy. The
      prod instance is already configured (email-only, restricted, Curtis's user). Until then the UI
      runs on the dev instance (dev banner, usage limits, `accounts.dev` sign-in).
- [~] **`manage-macros` skill** — rebuilt against `justmy.website` (stdlib client, `name` param),
      verified end-to-end against prod with system python3. Zip is at `skills/dist/manage-macros.zip`.
      Remaining: Curtis re-uploads the zip to claude.ai (publish step).

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

- **Remove the add-entry ("log ›") prompt from the macros page.** We don't log from the site
  (Option A — Claude adds via the skill; the web only corrects/deletes), so the bottom prompt is
  misleading. Delete `AddEntryPrompt` from `DayContent` (and the component).
- **Index/home link in the sidebar.** The nav rail lists modules but has no way back to the root
  landing. Add a home/index affordance in the rail (alongside the module list) so you can get back to
  the module switcher from within a module.
- **`justmy.recipes` cross-link.** Add a link to the sibling site — a subtle entry in the sidebar
  rail styled in the recipes brand color, and a more fully branded link on the index/landing page.
- **DayRollup hero corridor legibility.** When the day is "in range" (unspecified), the value fill
  is solid cyan and the corridor band is also cyan-tinted, so they blend and the "honest corridor"
  reads less crisply than it should — and it's the single most important element. Proposed: make the
  value fill more translucent, strengthen the corridor's accent hairline edges, and make the
  text-colored value marker more prominent, so the total visibly sits *within* the rest→training
  corridor. (Raised Phase 1; approved look otherwise.)

## Future modules

- **Weight tracker.** A daily body-weight module: log a weight per day, show weekly rolling averages
  (smooths daily noise) and other useful stats/trends. Its own module under `src/lib/weight/` +
  `src/app/(app)/weight/` following the module anatomy; add a nav entry + a landing card.

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

- **`/preview` route** is dev-only (404s in prod, guarded in proxy). Keep as a component preview
  harness or remove before/at first deploy — decide at deploy time.
- **API observability.** Route handlers have no per-request logging (Vercel function logs cover the
  basics). Add structured logging/error tracking if debugging needs it.
- **Preview env for `JMW_*` tokens.** Skipped due to an outdated Vercel CLI quirk; add before the
  first preview deploy (or after `npm i -g vercel@latest`).
