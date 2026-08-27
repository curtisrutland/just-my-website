#!/usr/bin/env python3
"""justmy.website Garmin daemon — polls Garmin Connect and pushes facts to justmy.website.

Runs on Curtis's Upboard. Spec: docs/garmin-daemon.md. Two loops in one process:

  activities  every 15 min  list recent -> download ORIGINAL -> unzip -> POST /api/rides/upload
  vitals      every 60 min  today + the previous 3 days     -> POST /api/vitals

It is a DUMB PIPE on purpose. It does not interpret, does not derive, does not normalize: the
server's `normalizeGarminDay` is the single place a Garmin field acquires meaning, so this pushes
Garmin's responses verbatim. It never writes to Garmin, never reads from justmy.website, and never
deletes anything anywhere.

Auth: a Garmin token session created ONCE interactively (see README) and copied here. The daemon
never holds the Garmin password and never re-logs-in on a schedule — Garmin IP-rate-limits logins,
and a re-login loop is how this account gets blocked.
"""

from __future__ import annotations

import io
import json
import logging
import os
import random
import signal
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from garminconnect import Garmin

HERE = Path(__file__).resolve().parent
TOKENSTORE = str(HERE / "tokenstore")
STATE_PATH = HERE / "state.json"

BASE_URL = os.environ.get("JMW_BASE_URL", "https://justmy.website").rstrip("/")
TOKEN = os.environ.get("JMW_PUBLISHER_TOKEN", "")

ACTIVITY_INTERVAL = int(os.environ.get("JMW_ACTIVITY_INTERVAL", 15 * 60))
VITALS_INTERVAL = int(os.environ.get("JMW_VITALS_INTERVAL", 60 * 60))
VITALS_TRAILING_DAYS = int(os.environ.get("JMW_VITALS_TRAILING_DAYS", 3))
ACTIVITY_PAGE = 20

log = logging.getLogger("jmw-garmin")


class Stop(Exception):
    """Raised when the daemon must exit non-zero so systemd surfaces it."""


# -- state --------------------------------------------------------------------
# An OPTIMIZATION, not a correctness mechanism. Losing it causes re-downloads and re-pushes, never
# duplicates: the upload route dedupes on file hash and the vitals route upserts on date. The
# server is the source of truth about what exists; the daemon is allowed to be forgetful.

def load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    tmp = STATE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=1))
    tmp.replace(STATE_PATH)  # atomic: a crash mid-write cannot corrupt the file


# -- justmy.website -----------------------------------------------------------

class PushError(RuntimeError):
    """A 5xx / network failure — retry later, keep the item unseen."""


class RejectedError(RuntimeError):
    """A 4xx — the payload is wrong. Log it loudly; retrying unchanged will not help."""


def push(path: str, body: bytes, content_type: str) -> tuple[int, Any]:
    if not TOKEN:
        raise Stop("JMW_PUBLISHER_TOKEN is not set")
    req = urllib.request.Request(
        BASE_URL + path,
        data=body,
        method="POST",
        headers={"authorization": f"Bearer {TOKEN}", "content-type": content_type},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        if exc.code == 401:
            raise Stop(f"justmy.website rejected the publisher token: {detail}")
        if 400 <= exc.code < 500:
            raise RejectedError(f"{exc.code}: {detail}") from None
        raise PushError(f"{exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise PushError(str(exc.reason)) from None


# -- Garmin -------------------------------------------------------------------

def connect() -> Garmin:
    """Authenticate from the stored token session. Never with a password: see the module docstring."""
    if not Path(TOKENSTORE).exists():
        raise Stop(f"no Garmin token session at {TOKENSTORE} — run the one-time login (see README)")
    g = Garmin()
    g.login(tokenstore=TOKENSTORE)
    log.info("garmin: authenticated as %s", g.get_full_name())
    return g


def fit_bytes(raw: bytes) -> bytes:
    """download_activity(ORIGINAL) returns a ZIP holding one {activityId}_ACTIVITY.fit — verified
    against 5 real activities. The upload route wants the bare FIT, so unwrap it here."""
    if raw[:2] != b"PK":
        return raw  # already bare FIT (defensive: Garmin has changed this before)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".fit")]
        if not names:
            raise RejectedError(f"zip has no .fit member: {z.namelist()}")
        return z.read(names[0])


# -- loops --------------------------------------------------------------------

def poll_activities(g: Garmin, state: dict) -> None:
    seen = set(state.get("seenActivityIds", []))
    activities = g.get_activities(0, ACTIVITY_PAGE)
    pending = [a for a in activities if a["activityId"] not in seen]
    log.info("activities: %d listed, %d new", len(activities), len(pending))

    for a in pending:
        aid = a["activityId"]
        label = f"{aid} {a.get('activityType', {}).get('typeKey', '?')}"
        try:
            raw = g.download_activity(str(aid), dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)
            status, body = push("/api/rides/upload", fit_bytes(raw), "application/octet-stream")
        except RejectedError as exc:
            # Do NOT mark seen: a malformed file must stay visible rather than be silently skipped.
            log.error("activities: %s REJECTED — %s", label, exc)
            continue
        except PushError as exc:
            log.warning("activities: %s push failed, will retry — %s", label, exc)
            continue

        seen.add(aid)
        deduped = isinstance(body, dict) and body.get("deduped")
        log.info("activities: %s %s", label, "deduped" if deduped else f"ingested ({status})")
        state["seenActivityIds"] = sorted(seen)[-500:]  # bounded: the server dedupes regardless
        save_state(state)


def collect_day(g: Garmin, day: str) -> dict:
    """Garmin's three day responses, VERBATIM. No interpretation happens here by design — the
    server normalizes, so there is exactly one place that decides what a field means."""
    raw: dict[str, Any] = {}
    for key, fn in (("userSummary", g.get_user_summary), ("sleep", g.get_sleep_data), ("hrv", g.get_hrv_data)):
        try:
            raw[key] = fn(day)
        except Exception as exc:  # one missing section must not lose the other two
            log.warning("vitals: %s %s unavailable — %s", day, key, exc)
            raw[key] = None
    return raw


def poll_vitals(g: Garmin, state: dict) -> None:
    """Today plus the trailing window: Garmin REVISES a day after the fact (sleep finalizes in the
    morning, resting HR updates late), and the upsert makes re-pushing free."""
    today = date.today()
    for back in range(VITALS_TRAILING_DAYS + 1):
        day = (today - timedelta(days=back)).isoformat()
        try:
            body = json.dumps({"measuredOn": day, "raw": collect_day(g, day)}).encode("utf-8")
            status, _ = push("/api/vitals", body, "application/json")
            log.info("vitals: %s %s", day, "created" if status == 201 else "updated")
        except RejectedError as exc:
            log.error("vitals: %s REJECTED — %s", day, exc)
        except PushError as exc:
            log.warning("vitals: %s push failed, will retry — %s", day, exc)
        time.sleep(1.0)  # a polite citizen of an unofficial API

    state["lastVitalsPollAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save_state(state)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)

    running = True

    def stop(_sig, _frm):
        nonlocal running
        running = False
        log.info("shutting down")

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    try:
        g = connect()
    except Stop as exc:
        log.error("fatal: %s", exc)
        return 1

    state = load_state()
    backoff = 0.0
    next_activities = 0.0
    next_vitals = 0.0

    while running:
        now = time.monotonic()
        try:
            if now >= next_activities:
                poll_activities(g, state)
                next_activities = now + ACTIVITY_INTERVAL
            if now >= next_vitals:
                poll_vitals(g, state)
                next_vitals = now + VITALS_INTERVAL
            backoff = 0.0
        except Stop as exc:
            # Tokens rejected, or a missing secret. Exit non-zero rather than hammering: the daemon
            # has no password and MUST NOT try to re-authenticate its way out of this.
            log.error("fatal: %s", exc)
            return 1
        except Exception as exc:
            # Rate limit / 5xx / network. Exponential backoff with jitter, capped at an hour —
            # never retry-storm an unofficial API.
            backoff = min(max(backoff * 2, 60.0), 3600.0)
            wait = backoff * (0.5 + random.random() * 0.5)
            log.warning("poll failed (%s: %s) — backing off %.0fs", type(exc).__name__, exc, wait)
            next_activities = next_vitals = time.monotonic() + wait

        for _ in range(50):  # responsive to SIGTERM without a busy loop
            if not running:
                break
            time.sleep(0.1)

    return 0


if __name__ == "__main__":
    sys.exit(main())
