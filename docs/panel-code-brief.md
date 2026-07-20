# Implementation Brief — JustMy Wall Panel

**For:** Claude Code
**Read first:** `docs/panel-contract.md` — it is the source of truth for every
shape and route below. This document says *how and in what order*; the contract
says *what*.
**Repos:** justmy.website (primary), justmy.recipes (one small addition)

---

## 0. Two things to verify before writing code

**1. Neon compute-hours.** Open the Neon project's usage page and read the actual
number. This determines nothing about the design — §4.1 of the contract (version
endpoint backed by KV, not Neon) happens regardless — but it tells us whether this
is urgent or merely correct. Report the number.

**2. KV availability.** The version endpoint needs a KV store. Check whether the
project already has Vercel KV / Upstash provisioned. If not, that's a small setup
step, not a blocker. If there's a reason KV isn't available, stop and raise it —
don't fall back to querying Neon on the version endpoint.

---

## 1. Build order

This ordering is deliberate: **steps 1–7 are ordinary web work done at a desk.**
No Raspberry Pi is involved until step 8. The Pi is a delivery detail, not a
dependency. If the hardware turns out to be underpowered, we find out at step 8
with a finished app to measure — which is also the best possible data for the
buy-a-Pi-5 decision.

| # | Step | Verifiable by |
|---|---|---|
| 1 | `device_tokens` table + auth middleware | Unit tests; curl with a token |
| 2 | `panel_state` table | Migration runs |
| 3 | KV wiring + `/api/panel/version` + bump calls on all existing write paths | Version changes when you log food via the skill |
| 4 | `/api/panel/health`, `/api/panel/shopping`, `/api/panel/recipe` (GET) | curl each, verify against contract shapes |
| 5 | `POST /api/panel/recipe` + validation + normalizer | Unit tests on the normalizer, especially §6.4 raggedness |
| 6 | `/panel` UI — three routes + tab bar | Desktop browser at 720×1280 |
| 7 | Two write actions wired | Tap in browser, verify DB + version bump |
| 8 | Pi: OS, kiosk, systemd | Walk to the wall |
| 9 | justmy.recipes "Send to Panel" button | Click it, see it on the panel |

Step 9 can move earlier if convenient — it's independent of 6–8. Steps 1–5 are
strictly ordered.

---

## 2. Auth (contract §3)

Two credentials, one table, distinguished by scope. Details in the contract.

Implementation notes:
- Hash tokens. Never store raw. Compare with a constant-time comparison.
- **Panel routes accept either a device token OR a valid Clerk session.** This is
  not a convenience — it's what makes step 6 possible without hardware. Write the
  middleware to try Bearer first, fall through to Clerk.
- Update `last_seen_at` on device-token auth, but do it cheaply — this fires on
  every version poll. A KV write with periodic flush, or just accept the write, but
  **do not** make it a Neon write on the version path (see §3).
- `revoked_at IS NOT NULL` → 401.
- Scope check per route. `panel:read` does not grant `panel:write:recipe`.

Generate one token for the panel (`name: 'kitchen-panel'`) and one for the sender
(`name: 'justmy-recipes'`). Output them once at creation; they're not retrievable
after.

---

## 3. The version endpoint (contract §4) — the part most likely to go wrong

**`/api/panel/version` must not query Neon.** This is the highest-frequency request
in the system. Putting Neon on that path means the compute never autosuspends and
bills 24/7.

Shape: three keys in KV, one per section (`panel:v:health`, `panel:v:shopping`,
`panel:v:recipe`). Read all three, return them. That's the whole endpoint.

**The harder half is the bumps.** Every existing write path needs one added:

| Existing write path | Bump |
|---|---|
| `manage-macros` skill → macro entry create/update/delete | `health` |
| `manage-macros` skill → day-type set | `health` |
| Web UI macro entry create/update/delete | `health` |
| Web UI day-type set | `health` |
| `manage-weight` skill → weight create/update/delete | `health` |
| Web UI weight create/update/delete | `health` |
| `manage-shopping` skill → any list change | `shopping` |
| Web UI shopping change | `shopping` |
| `POST /api/panel/shopping/:id/check` | `shopping` |
| `POST /api/panel/day-type` | `health` |
| `POST /api/panel/recipe` | `recipe` |

**Do this centrally, not at each call site.** If these write paths already funnel
through service/repository functions, put the bump there. If they don't, the
scattered-bump version will rot the first time a new write path is added and
someone forgets. If a central seam doesn't exist, say so and propose one before
implementing — don't sprinkle 11 bump calls.

Failure mode to avoid: a bump that throws takes down a write. Bumps are
fire-and-forget. A missed bump means the panel is stale until the next poll
notices via some other change — annoying, not broken. A failed food log is broken.
Wrap accordingly.

---

## 4. Section endpoints (contract §5)

Three GETs. Straightforward, with these notes:

**`/api/panel/health`**
- Compute `remaining` server-side. The panel does no arithmetic. `remaining` can be
  negative — do not clamp at zero.
- Read `target` from the **dated target profile**, not a constant. The current
  profile is flat 2300/160/75/220 for both day kinds, but the schema supports it
  changing and hardcoding it will bite.
- `weight.latest`, `rollingAvg7`, `trend`, `trendPerWeek`, `range` are all nullable.
  Return null; don't fabricate. `series` is `[]` when empty. (`toWaypoint` was
  **removed** in contract v1.1 — the weight module tracks trends, not goals.)
- The whole weight block maps from `weight/repo.ts:getRollup({ windowDays: 30 })` —
  see contract §5.1. It's a mapping, not new math.
- `trend` (enum) derives from `trendPerWeek`: deadband = display precision. If the
  signed rate rounds to `0.0 lb/wk` it's `"flat"`, else the sign. Document the
  rounding in code so the glyph can't contradict the number beside it.
- `date` is "today" in Curtis's timezone (America/Chicago), not UTC. Getting this
  wrong means the panel rolls over at 7pm.

**`/api/panel/shopping`**
- Full list, not a slice. Include checked items; the UI decides how to show them.
- Preserve `category` from the existing shopping module.

**`/api/panel/recipe`**
- Returns `active_recipe_norm` (the normalized view), not the raw payload.
- `recipe: null` when nothing has been sent. Normal state, 200 not 404.

---

## 5. Send-to-panel (contract §6) — where the real work is

### 5.1 The endpoint is sender-anonymous

`POST /api/panel/recipe` takes a JSON-LD Recipe. It does not know justmy.recipes
sent it. Do not add a special case for justmy.recipes, do not validate the source
URL's domain, do not couple. A future URL importer or manual paste must work
without touching this code.

### 5.2 Validate on receive, never on render (contract §6.3)

Reject malformed payloads at the endpoint so the sender surfaces the error while
the user is on a device with a keyboard. The panel must never be the thing that
discovers a bad payload.

Return `400` with a useful `errors` array. The button on justmy.recipes shows it.

### 5.3 Normalize on receive, never on render (contract §6.4)

This is the piece that most rewards care. schema.org permits `recipeInstructions`
as a bare string, an array of strings, an array of `HowToStep`, or `HowToSection`
objects containing nested steps. **Handling that branching in the panel renderer
would put conditional logic in the lowest-powered, hardest-to-debug part of the
system.** Flatten it here.

Store both:
- `active_recipe` — the **raw payload, unmodified**. Fields we don't render today
  (notably `image`) ride along and get picked up whenever the viewer learns them.
  No contract change, no re-send of stored recipes.
- `active_recipe_norm` — the flat shape the viewer reads.

Unit-test the normalizer against all four instruction shapes. The live sender only
emits one of them (see below), so these tests are the only thing keeping the
general case honest.

### 5.4 What the live sender actually emits — verified

justmy.recipes' API was inspected directly. **Its output is much narrower than
schema.org permits.** This is good news for the current path and a trap for the
normalizer if you optimize for it.

Verified:
- `recipeInstructions` is **always** `HowToStep[]` on read: `{ "@type":
  "HowToStep", "text": string, "name"?: string }`. `name` is a short heading,
  frequently present. **Never** a bare string, never `HowToSection`.
- `recipeIngredient` is an array of free-text strings. No structure.
- `nutrition` is schema.org shape with **plain numbers** (not `"22 g"` strings),
  **per serving**, paired with `recipeYield`.
- `recipeYield` is a string ("6 bites"), not always numeric.
- Times are ISO 8601 durations. Store as-is; the viewer formats.

**Write the normalizer for the general case anyway.** §5.1 says the sender is
anonymous; a normalizer that only handles `HowToStep[]` makes that a lie.

### 5.5 ⚠ `notes` is not schema.org and must not be dropped

justmy.recipes has a top-level freeform `notes` field carrying real content —
storage life, substitutions, technique warnings. A strict JSON-LD-only consumer
would silently drop it, and the user would notice.

**The send payload is JSON-LD plus `notes`.** The normalizer reads `notes` if
present and carries it to `active_recipe_norm.notes`. A sender without notes omits
the field; the viewer renders without it. Do not try to shoehorn it into a
schema.org field.

### 5.6 No hidden render logic — verified

justmy.recipes does **not** scale ingredients by servings, does **not** parse
quantities into structure, and does **not** do anything in its renderer that the
data doesn't capture. A JSON-LD+notes consumer has everything. There is no logic to
port. (Ingredient scaling is a future feature on both sites, not a gap here.)

---

## 6. The panel UI (step 6)

Routes per contract §2. `/panel` → 302 → `/panel/health`.

**Claude Design is producing the visual design.** Implement against it. If the
design and the contract disagree on a data shape, the contract wins — flag it.

Implementation constraints that are yours, not the designer's:

**Server-render everything you can.** The only client JS should be: the version
poll, tab navigation, and the two POST handlers. No client-side data fetching on
initial load. No heavy hydration. Target Pi 3.

**Fetch discipline.** Poll `/api/panel/version` (60s). Refetch a section only when
(a) its version moved AND (b) it's the visible tab. Do not refetch three tabs'
worth of DOM because a shopping item changed.

**Optimistic UI on shopping check-off.** The row responds to the tap immediately,
not after the POST resolves. Revert quietly on failure. The Pi is slow and the
round-trip is real; waiting feels broken.

**Recipe step progress is local state only.** Contract §10. No persistence, doesn't
survive reload, doesn't need to.

**No text input anywhere.** If you find yourself adding an `<input type="text">`,
something has gone wrong.

**Panel sleeps.** When the display blanks, stop polling. Use the Page Visibility
API. This is both a Neon-hours saving and correct behavior.

---

## 7. The Pi (step 8) — last, deliberately

Hardware: Raspberry Pi 3 (already owned), Raspberry Pi Touch Display 2, 720×1280
portrait via DSI, GPIO-powered.

⚠ **The Pi 3 uses the 15-pin DSI connector; the Display 2 ships with the Pi 5's
22-pin mini cable.** A 15-pin adapter cable is required. This is a hardware
ordering note, not a code task — but if the panel physically won't connect, step 8
stalls, so it's flagged here.

Setup:
- Raspberry Pi OS Lite (Bookworm, 64-bit). **No desktop environment** — X11 (not
  Wayland; better-trodden on Pi 3) plus a bare window manager, nothing else.
- Chromium in kiosk mode, pointed at `https://justmy.website/panel` with the device
  token supplied. Decide how: a cookie set once, a token in a URL param on first
  load that's exchanged for a cookie, or a local proxy that injects the header. The
  first two are simpler; pick one and document it.
- Static IP reservation in **192.168.1.2–.63** (the AT&T gateway's DHCP pool is
  .64–.253, so that range is free). The kiosk URL should never move.
- Portrait, native orientation. No rotation — don't fight the panel.
- **systemd unit that restarts Chromium on exit.** Ten lines, and it saves walking
  over to a black rectangle. Do this.
- Screen blanking overnight; panel stops polling when blanked (§6).

Pi 3 tuning — do these, they're cheap and not cargo-cult:
- zram enabled
- `gpu_mem` bumped
- Chromium flags limited to **disabling things we don't need**: first-run,
  extensions, background timer throttling, translate, infobars, session restore.

Pi 3 tuning — do **not** do these yet:
- Rendering/compositing flags (`--disable-gpu-compositing` et al). These are
  heavily cargo-culted on Pi forums and mostly don't help a static kiosk page.
  **Measure first.** If it's sluggish, report *what* is sluggish (first paint?
  scroll? tab switch? the recipe step transition?) before tuning.

**If the Pi 3 is inadequate:** report specifics. Escalation path is Cog/WPE WebKit
(an embedded-focused browser with a much smaller footprint, built for exactly this)
*before* spending money. Only if Cog is also inadequate is a Pi 5 justified — and
at current RAM-crisis pricing that's ~$65 for the 2GB, which is the right variant
for a kiosk workload, not the $110 4GB.

### 7.1 As-built (2026-07-20) — Wayland/cage, not X11

Step 8 is **done**; the panel is live on the wall. Reality differed from the plan
above in three ways worth recording, because the next person (or the next panel)
will hit the same forks:

- **The OS shipped as Raspberry Pi OS Lite based on Debian 13 (Trixie), not Bookworm.**
  Trixie is Wayland-native, which *inverts* the plan's "X11 is better-trodden on Pi 3"
  bet (that was a Bookworm-era assumption). The X11 path failed silently — `xinit` ran
  but Xorg never started, never even wrote `/var/log/Xorg.0.log`, while `getty@tty1`
  held the VT. Rather than fight X on a Wayland-first OS, we pivoted to **`cage`** (a
  wlroots kiosk compositor: one fullscreen window, nothing else). This is the modern
  right answer for a Pi kiosk and it came up first try. The brief's own §7 said measure
  and adapt — this is that.
- **The Chromium package on Trixie is `chromium`, not `chromium-browser`.** The binary
  and the `apt install` target are both `chromium`. `matchbox-window-manager`,
  `unclutter`, `xserver-xorg`, `xinit` are no longer used (they were the X11 stack).
- **Token delivery (the §7 open decision): the session-cookie URL, re-hit every boot.**
  `kiosk.sh` points Chromium at `GET /api/panel/session?token=<device token>`, which
  validates the token, drops the 1-year httpOnly `panel_token` cookie, and 302s to
  `/panel/health`. Re-hitting it every boot is self-healing (survives cookie expiry or
  an SD reflash). The token lives in `kiosk.sh` on the SD card — sanctioned for a
  private device (contract §3.1).

As-built config on the Pi:
- `chromium --ozone-platform=wayland --kiosk …` (kiosk/disable-only flags per §7),
  launched by `cage -- /usr/local/bin/kiosk.sh`.
- `systemd` unit `kiosk.service`: `ExecStart=/usr/bin/cage -- /usr/local/bin/kiosk.sh`,
  `Restart=always`, `PAMName=login` on `/dev/tty1`, and crucially
  **`Conflicts=getty@tty1.service`** so the login console is evicted from the VT and
  cage can take DRM master (the missing piece that had silently blocked Xorg).
- Overnight sleep unchanged from the plan: root cron runs `panel-sleep` (stop `kiosk`
  + backlight `bl_power` off) at 23:00 and `panel-wake` at 07:00. Stopping the service
  truly halts the version poll — no browser, no requests — so Neon can autosuspend.

**Cursor (a cage wart worth knowing):** a pointer arrow renders dead-centre and never
moves. It is **not** the page's cursor — it's cage/wlroots' own *compositor* cursor,
one layer below the web page. cage hides the cursor for touchscreen-only seats, but the
DSI Touch Display 2 *also* enumerates as a pointer device, so cage can't distinguish it
from a mouse and parks a cursor at screen centre permanently (cage issues #83/#235/#422).
Two dead ends before the fix:
- **CSS is the wrong layer.** `cursor: none` only governs the page's cursor; it can't
  reach the compositor's. An earlier `panel.css` rule attempting this was reverted — it
  did nothing here (and on this hardware the panel can even report `pointer: fine`,
  because the touchscreen enumerates as a pointer, so a touch-scoped media query may not
  match at all).
- **cage ignored `XCURSOR_THEME`.** Pointing it at a blank theme via the service
  environment didn't take; cage loaded Adwaita regardless.

**Fix — on the Pi** (device filesystem state, not in this repo; recorded here so it's
reproducible): overwrite the arrow in the theme cage actually loads, **Adwaita**, with a
transparent Xcursor.
1. Generate a 1×1 transparent Xcursor. `xcursorgen` is gone from Trixie's repos, so emit
   the ~68-byte Xcursor binary directly with a short `python3` script (file header + one
   TOC entry + a 1×1 fully-transparent ARGB image tagged nominal size 24).
2. `sudo cp --remove-destination` that file over BOTH
   `/usr/share/icons/Adwaita/cursors/left_ptr` and `.../default` (wlroots may request
   either name; `--remove-destination` replaces them even when they're symlinks).
3. `sudo systemctl restart kiosk`.

Undo: `sudo apt install --reinstall adwaita-icon-theme`. (A `/usr/share/icons/blank`
theme + a `kiosk.service.d/cursor.conf` drop-in setting `XCURSOR_THEME=blank` were left
in place as harmless scaffolding, but the Adwaita overwrite is what actually works.)

---

## 8. justmy.recipes: the Send to Panel button (step 9)

Small, self-contained, independent of steps 6–8.

- A button on the recipe page.
- It calls **justmy.recipes' own server-side route handler**, which holds the
  service token and forwards to `POST https://justmy.website/api/panel/recipe`.
- **The service token must never reach the browser.** No `NEXT_PUBLIC_` anything.
- Payload: the recipe's JSON-LD **plus `notes`** (§5.5), plus `sourceUrl`.
- Surface the 400 errors from justmy.website. The user is on a device with a
  keyboard; this is the moment to tell them something's wrong.
- Success feedback should be quiet — a confirmation, not a celebration. It does not
  navigate anywhere. **Send-to-panel is passive:** it sets the row; the panel picks
  it up when he walks over and taps the tab. The panel does not self-navigate.

---

## 9. Out of scope — do not build

Contract §10 is the full list. The ones most likely to be built by accident:

- **No WebSockets, SSE, Pusher, or Ably.** Vercel functions can't hold persistent
  connections and SSE bills the whole open duration. The version-poll is the design.
- **No active panel switching.** Send-to-panel sets a row. That's all.
- **No write paths beyond the two in contract §7.** Not food logging, not weight,
  not adding shopping items, not editing recipes. All of those are better on a
  phone; building them here makes the panel worse.
- **No recipe browser on the panel.** No list, no search, no picker. The panel
  receives exactly one recipe.
- **No ingredient scaling.** Neither site does it (verified §5.6).
- **No image rendering.** `image` rides along in the raw payload, ignored by the
  viewer.
- **No multi-panel support.** `panel_state` is one row. Add `panel_id` when a
  second panel exists, not before.

---

## 10. Report back

- The Neon usage number (§0).
- Whether a central write seam exists for the version bumps, or whether one needs
  building (§3).
- The `trend` rule you chose (§4).
- Which token-delivery approach you picked for the kiosk (§7).
- If you hit step 8 and the Pi 3 struggles: *what specifically* is slow, before any
  tuning.
