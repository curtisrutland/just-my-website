"""Thin READ-ONLY Python client assembling the unified health view over justmy.website.

Standalone — Python standard library only, no third-party dependencies. Network egress: talks to
https://justmy.website. Base URL and agent token are injected at build time (or via JMW_BASE_URL /
JMW_AGENT_TOKEN env vars for local dev).

This client is deliberately a READER. It calls the same per-module read endpoints the dedicated
skills use (macros, weight, lifting, rides) and assembles their answers into one daily or weekly
view — it computes NO new metrics, renames NO fields, and has NO write methods. Every number in
the assembled view is a module's own number, under the module's own field names. The only thing
added is `gaps`: a list of factual absences (nothing logged, nothing interpreted) — observations,
not judgments. All writes belong to the per-module skills.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date as _date, datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

BASE_URL = (os.environ.get("JMW_BASE_URL") or "__JMW_BASE_URL__").rstrip("/")
TOKEN = os.environ.get("JMW_AGENT_TOKEN") or "__JMW_AGENT_TOKEN__"

# Curtis's timezone — every "day" here is his LOCAL calendar day, not UTC, not the sandbox's.
APP_TZ = ZoneInfo(os.environ.get("JMW_TZ", "America/Chicago"))


class HealthError(RuntimeError):
    """Raised when the API returns an error envelope."""


class HealthClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        if not base_url or base_url.startswith("__JMW"):
            raise HealthError("base URL not configured (build the skill or set JMW_BASE_URL)")
        if not token or token.startswith("__JMW"):
            raise HealthError("agent token not configured (build the skill or set JMW_AGENT_TOKEN)")
        self._base = base_url
        self._headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}

    def _get(self, path: str, params: Any = None) -> Any:
        url = self._base + path
        if params:
            query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            if query:
                url = f"{url}?{query}"
        req = urllib.request.Request(url, method="GET", headers=self._headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = resp.read()
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {}
            err = parsed.get("error", {}) if isinstance(parsed, dict) else {}
            message = err.get("message") or raw.decode("utf-8", "replace")
            raise HealthError(f"{exc.code} {err.get('code', 'error')}: {message}") from None

    def _get_or_none(self, path: str) -> Optional[dict]:
        try:
            return self._get(path)
        except HealthError as exc:
            if str(exc).startswith("404"):
                return None
            raise

    # -- dates ------------------------------------------------------------------
    @staticmethod
    def today() -> str:
        """Curtis's CURRENT local calendar date ('YYYY-MM-DD', America/Chicago). Anchor every view
        on this — never infer the date from the conversation."""
        return datetime.now(APP_TZ).date().isoformat()

    @staticmethod
    def _local_date_of(iso_ts: str) -> str:
        """The LOCAL calendar date a UTC timestamp falls on (an evening lift is 'tomorrow' in UTC)."""
        return datetime.fromisoformat(iso_ts.replace("Z", "+00:00")).astimezone(APP_TZ).date().isoformat()

    # -- module reads (each is one module's own endpoint, verbatim) -------------
    def _lifting_recent(self, limit: int) -> dict:
        return self._get("/api/lifting/sessions", {"limit": limit})

    def _lifting_uninterpreted_count(self) -> int:
        resp = self._get("/api/lifting/sessions", {"interpreted": "false", "limit": 50})
        items = resp.get("items", [])
        return resp.get("count", len(items))

    # -- the views --------------------------------------------------------------
    def daily(self, date: Optional[str] = None) -> dict:
        """The one-day health snapshot for `date` (default: today, America/Chicago).

        Returns (module field names verbatim; `entries` deliberately omitted from macros —
        drill in with manage-macros when the food list itself matters):
            {"date": ...,
             "macros":  {day-rollup sans entries: day{date}, totals, estimation, target},
             "weight":  {"entry": the day's weigh-in or None, "trend": rollup summary
                         {currentAvg, current, trendPerWeek, range, window}},
             "lifting": {"sessions": sessions STARTED on this local date, "goal": current goal
                         statement or None, "uninterpretedCount": pending reads across ALL days},
             "rides":   activities on this local date (ALL sports, not just cycling),
             "gaps":    factual absences — see SKILL.md}
        """
        day = date or self.today()

        macros = self._get(f"/api/macros/days/{day}")
        macros.pop("entries", None)

        weight_entry = self._get_or_none(f"/api/weight/days/{day}")
        weight_trend = self._get("/api/weight/rollup", {"window": 30, "end": day}).get("summary")

        lifting = self._lifting_recent(limit=10)
        sessions = [s for s in lifting.get("items", []) if self._local_date_of(s["startedAt"]) == day]
        uninterpreted = self._lifting_uninterpreted_count()

        rides = self._get("/api/rides", {"from": day, "to": day, "limit": 20}).get("items", [])

        gaps: list[str] = []
        entry_count = macros.get("estimation", {}).get("entryCount", 0)
        if entry_count == 0:
            gaps.append(f"no food logged for {day}")
        if weight_entry is None:
            gaps.append(f"no weight logged for {day}")
        if uninterpreted > 0:
            gaps.append(f"{uninterpreted} lifting session(s) awaiting interpretation")

        return {
            "date": day,
            "macros": macros,
            "weight": {"entry": weight_entry, "trend": weight_trend},
            "lifting": {"sessions": sessions, "goal": lifting.get("goal"), "uninterpretedCount": uninterpreted},
            "rides": rides,
            "gaps": gaps,
        }

    def weekly(self, end: Optional[str] = None) -> dict:
        """The week-at-a-glance: the Monday-start calendar week containing `end` (default: today).
        Monday-start matches the rides weekly rollup, so "this week" means the same thing in both.

        Returns (module field names verbatim):
            {"weekStart": Monday, "weekEnd": Sunday,
             "macros":  per-day {date, totals, target} — empty days ZEROED, never missing,
             "weight":  {"days": the week's series points {date, weight, avg} — one per ELAPSED
                         day, weight null when unweighed, "trend": rollup summary over the 30
                         days ending at the week's end (clamped to today)},
             "lifting": {"sessions": sessions started this local week, "goal", "uninterpretedCount"},
             "rides":   activities this week (ALL sports),
             "gaps":    factual absences over the ELAPSED days only — see SKILL.md}
        """
        anchor = _date.fromisoformat(end or self.today())
        week_start = anchor - timedelta(days=anchor.weekday())
        week_end = week_start + timedelta(days=6)
        start_s, end_s = week_start.isoformat(), week_end.isoformat()
        today_s = self.today()

        macros_days = self._get("/api/macros/range", {"start": start_s, "end": end_s})

        # Window anchored to the week's end so a historical week still has its series covered —
        # clamped to today so the CURRENT week's trend matches daily()'s (a future Sunday anchor
        # would compute the trailing average over days that don't exist yet).
        rollup = self._get("/api/weight/rollup", {"window": 30, "end": min(end_s, today_s)})
        weight_days = [p for p in rollup.get("series", []) if start_s <= p.get("date", "") <= end_s]

        lifting = self._lifting_recent(limit=20)
        sessions = [s for s in lifting.get("items", []) if start_s <= self._local_date_of(s["startedAt"]) <= end_s]
        uninterpreted = self._lifting_uninterpreted_count()

        rides = self._get("/api/rides", {"from": start_s, "to": end_s, "limit": 50}).get("items", [])

        # Gaps only over days that have actually happened — a week isn't missing its Friday on Tuesday.
        elapsed = [d for d in (day.get("date") for day in macros_days) if d and d <= today_s]
        unlogged_food = [d for d in macros_days if d.get("date") in elapsed and not d.get("totals", {}).get("calories")]
        # A series point exists for EVERY day in the window (weight null when unweighed).
        weighed = {p.get("date") for p in weight_days if p.get("weight") is not None}
        unweighed = [d for d in elapsed if d not in weighed]

        gaps: list[str] = []
        if unlogged_food:
            gaps.append("no food logged: " + ", ".join(d["date"] for d in unlogged_food))
        if unweighed:
            gaps.append("no weight logged: " + ", ".join(unweighed))
        if uninterpreted > 0:
            gaps.append(f"{uninterpreted} lifting session(s) awaiting interpretation")

        return {
            "weekStart": start_s,
            "weekEnd": end_s,
            "macros": macros_days,
            "weight": {"days": weight_days, "trend": rollup.get("summary")},
            "lifting": {"sessions": sessions, "goal": lifting.get("goal"), "uninterpretedCount": uninterpreted},
            "rides": rides,
            "gaps": gaps,
        }
