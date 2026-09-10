# Garmin daemon — spec

A small Python service on Curtis's Upboard (Linux) that polls Garmin Connect's **unofficial** API and
pushes facts into justmy.website. It is the platform's first component that runs on Curtis's own
hardware, and the reason the `vitals` module and `POST /api/rides/upload` exist in the shape they do.

**Status: SPEC — not yet approved, no code written.**

Lives in `daemon/` in this repo (not a separate one): the daemon and the API contract it depends on
change together, so they get reviewed together — the same reasoning that keeps `skills/` here.

```
daemon/
  garmin_daemon.py          the service
  requirements.txt          garminconnect (see "Dependencies")
  state.json                gitignored — last-seen activity ids, last vitals poll
  tokenstore/               gitignored — Garmin OAuth tokens. NOT the password.
  README.md                 install + first-run on the Upboard
  systemd/jmw-garmin.service
```

---

## What it does

Two loops, one process:

| Loop | Cadence | Action |
|---|---|---|
| **Activities** | every 15 min | list recent activities → for each unseen id: download `ORIGINAL` → unzip → `POST /api/rides/upload` (raw FIT bytes) |
| **Vitals** | hourly | for today + the previous 3 days: fetch the day's measurements → `POST /api/vitals` (upsert) |

**Why the trailing 3-day re-poll:** Garmin revises a day after the fact — sleep is finalized in the
morning, resting HR updates late, a watch that syncs a day late backfills. Upserts are idempotent, so
re-sending is free and correctness wins.

**Why 15 minutes for activities:** rides reach Garmin only after the watch syncs through the phone, so
sub-15-minute polling buys nothing real, and this is an unofficial API we do not want to antagonize.

---

## The three findings that shape this design

All verified against Curtis's real account on 2026-08-25.

**1. `garth` is dead — do not use it.** `garth` 0.8.0 raises a `DeprecationWarning` on import
("no longer maintained", [discussion #222](https://github.com/matin/garth/discussions/222)). More
decisively, **`garminconnect` 0.3.11 has already moved off it** — its dependencies are `curl_cffi`,
`requests`, `ua-generator`, with no `garth` import anywhere in the module. The daemon depends on
`garminconnect` alone.

**2. Logins are IP rate-limited; token sessions are not.** The first interactive login returned
`429 GarminConnectTooManyRequestsError` on two of its three auth paths before succeeding on the
fallback. **The daemon must never log in on a schedule.** It authenticates once, from the persisted
tokenstore, and refreshes tokens — a re-login loop is how this account gets blocked.

**3. `download_activity(..., ORIGINAL)` returns a ZIP, not a FIT.** Every one of the 5 sampled
activities came back as `PK\x03\x04`, containing exactly one member named `{activityId}_ACTIVITY.fit`.
The daemon unzips and posts the inner bytes. The upload route is unchanged — it still takes raw FIT
binary, and that FIT was confirmed to decode cleanly through this repo's own
`decodeFitRide` + `fitRideSchema.parse` (`cycling`/`mountain`, correct start time, device serial,
file hash).

---

## Authentication and secrets

**Garmin side.** One interactive login, performed by Curtis on a machine with a terminal, writes an
OAuth tokenstore. That directory is then copied to the Upboard. **The daemon never holds Curtis's
Garmin password**, and the password never appears in the repo, in a shell history, or in an
environment variable. If the tokens are ever fully rejected, the daemon stops and says so — it does
not attempt to re-authenticate with credentials it should not have.

**justmy.website side.** One secret: `JMW_PUBLISHER_TOKEN`, in the systemd unit's environment file
(mode `0600`), never on the command line. That token is accepted by exactly two routes
(`POST /api/rides/upload`, `POST /api/vitals`) and cannot read, PATCH, or DELETE anything, anywhere —
see `docs/vitals-model.md` § "Kernel departure". A compromised Upboard can push facts and nothing else.

---

## State

`state.json`, written atomically (temp file + rename):

```json
{
  "seenActivityIds": [24075251218, 24055587995],
  "lastVitalsPollAt": "2026-08-25T17:00:00Z",
  "lastActivityPollAt": "2026-08-25T17:12:00Z"
}
```

State is an **optimization, not a correctness mechanism**. Losing `state.json` causes re-downloads and
re-posts, not duplicates: `POST /api/rides/upload` dedupes on file hash and returns
`200 {"deduped": true}`, and `POST /api/vitals` upserts on `measuredOn`. The server is the source of
truth about what exists; the daemon is allowed to be forgetful.

---

## Failure modes and how it behaves

| Condition | Behaviour |
|---|---|
| Garmin `429` | Exponential backoff with jitter, cap ~1 h. Never retry-storm an unofficial API |
| Garmin `401` / tokens rejected | Stop the loop, log loudly, exit non-zero so systemd surfaces it. Do **not** try to re-login |
| Garmin 5xx / network down | Backoff and retry; the next tick is soon and nothing is lost |
| justmy.website 5xx | Retry with backoff; keep the activity id **unseen** so it is retried |
| justmy.website `400` (validation) | Log the body and mark the item **failed**, not seen. A malformed day must be visible, not silently skipped |
| Upload returns `deduped: true` | Normal. Mark seen, say nothing |
| One activity fails | Continue with the others. One bad file does not stall the queue |

Logging goes to stdout (journald picks it up). One line per poll with counts; full detail on failure.

---

## What the daemon may NOT do

Deliberate constraints, so this stays a dumb pipe:

- **No interpretation.** It never writes a ride `name`/`note`, never sets a lifting `interpretation`.
  Meaning is Claude's job through the skills; the daemon moves bytes.
- **No derived numbers.** It does not compute averages, totals, or scores — the repo derives, per
  `docs/vitals-model.md`. It does not even normalize: epoch-ms → instant conversion happens in
  `vitalsDaySchema`, so there is exactly one place that decides what a field means.
- **No reads of justmy.website.** Its token cannot read, and it should not want to.
- **No deletes**, ever, on either side.
- **No writing to Garmin.** `garminconnect` exposes `set_*`, `add_*`, `upload_*`, `delete_*`. The
  daemon calls only `get_*` and `download_*`. Garmin is a read-only upstream.

---

## Dependencies

`garminconnect` only (which brings `curl_cffi`, `requests`, `ua-generator`). Pinned in
`requirements.txt` and installed into a venv on the Upboard. Explicitly **not** `garth`.

Note that this is an **unofficial, unsupported API** that Garmin can change or block without notice.
That is an accepted risk, mitigated by: `rawPayload` retention (history survives even if the API
dies), the daemon being isolated from the web app, and the manual FIT drag-and-drop upload path in
the web UI remaining as a permanent fallback.

---

## Deployment

A **systemd user service** running as Curtis's own login user (`~/jmw-garmin`, unit in
`~/.config/systemd/user/`). Deliberately not a system service with a dedicated account: the daemon
needs no privileges and owns nothing outside `$HOME`, so a user service removes the service account,
removes sudo from the install entirely, and keeps its journal under `journalctl --user`. Boot
persistence comes from `loginctl enable-linger` (which needed no sudo), because without lingering
systemd tears the user manager down at logout.

`Restart=on-failure`, `EnvironmentFile` holding `JMW_PUBLISHER_TOKEN` at mode `0600`. A single
long-lived process with internal sleeps — simpler than two cron entries, and it keeps one
authenticated client in memory rather than re-authenticating per run, which finding #2 makes
important. `daemon/README.md` carries the exact install steps.

**Deployed 2026-08-27** on the Upboard (Ubuntu 26.04, Python 3.14). One wrinkle worth recording:
Ubuntu 26.04 ships neither `pip` nor `ensurepip`, so `python3 -m venv` fails and the venv has to be
built `--without-pip` with pip bootstrapped in afterwards.

## Open / deferred

- **First-run backfill.** ~28 days of vitals + 16 activities (history starts 2026-07-28). A single
  cheap pass; a `--backfill` flag rather than special startup logic.
- **Health reporting.** The daemon currently only reports into journald. A heartbeat ping to the
  platform would make silence detectable — but that needs a read or a new write route, so it is
  deferred rather than quietly widening the publisher token's scope.
- **Multi-sport.** Already fine: 13 mountain_biking, 2 elliptical, 1 cycling in the sampled 16, and
  the rides module accepts any sport today. Issue #35 is presentation/labelling and does not block this.
- **Webhook instead of polling.** Garmin's official Health/Activity APIs offer push, but require a
  developer-program agreement. Polling is the pragmatic choice for one person.
