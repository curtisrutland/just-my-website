"""Thin Python client for the justmy.website vitals token API.

Standalone — Python standard library only, no third-party dependencies. Network egress: talks to
https://justmy.website (the token API under /api/vitals). Base URL and agent token are injected at
build time (or via JMW_BASE_URL / JMW_AGENT_TOKEN env vars for local dev).

The vitals module is Curtis's DAILY MEASUREMENTS off his Garmin watch — sleep, resting heart rate,
HRV, blood oxygen, respiration, steps. Its principle is **measurements, not verdicts**: Garmin's
scores (training readiness, Body Battery, stress, VO2max, FTP, race predictions, sleep score) are
deliberately not modelled and are not available here. Do not reconstruct them, and do not invent
your own.

This client is READ-ONLY, and that is structural, not an oversight. The only writer is the Garmin
daemon on Curtis's own hardware; there is no create/update method here because a hand-entered HRV
would be a fiction.

Units are stored as measured: seconds for durations, milliseconds for HRV, bpm, %, breaths/min.
Curtis reads durations as "6h 16m" — use `hm()`.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

BASE_URL = (os.environ.get("JMW_BASE_URL") or "__JMW_BASE_URL__").rstrip("/")
TOKEN = os.environ.get("JMW_AGENT_TOKEN") or "__JMW_AGENT_TOKEN__"


def hm(seconds: Optional[float]) -> Optional[str]:
    """Seconds → "6h 16m" / "48m". None passes through (NOT MEASURED — never render it as 0)."""
    if seconds is None:
        return None
    total = int(seconds)
    h, m = divmod(total // 60, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


class VitalsError(RuntimeError):
    """Raised when the API returns an error envelope."""


class VitalsClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        if not base_url or base_url.startswith("__JMW"):
            raise VitalsError("base URL not configured (build the skill or set JMW_BASE_URL)")
        if not token or token.startswith("__JMW"):
            raise VitalsError("agent token not configured (build the skill or set JMW_AGENT_TOKEN)")
        self._base = f"{base_url}/api/vitals"
        self._headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}

    def _request(self, method: str, path: str, *, body: Any = None, params: Any = None) -> Any:
        url = self._base + path
        if params:
            query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            if query:
                url = f"{url}?{query}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=self._headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 204:
                    return None
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
            details = err.get("details") if isinstance(err, dict) else None
            if details:
                message = f"{message} ({details})"
            raise VitalsError(f"{exc.code} {err.get('code', 'error')}: {message}") from None

    # -- reads ------------------------------------------------------------------

    def list_days(
        self,
        *,
        from_: Optional[str] = None,
        to: Optional[str] = None,
        limit: int = 30,
        offset: int = 0,
    ) -> dict:
        """Paginated days, newest first: {"items": [...], "limit", "offset", "count"}.

        Each item carries every measurement, and ANY of them may be None — that means NOT MEASURED
        (watch off the wrist, no sleep recorded, never synced). Say "not measured"; never print 0.

        Fields: sleepTotalSeconds, sleepDeepSeconds, sleepLightSeconds, sleepRemSeconds,
        sleepAwakeSeconds, napSeconds, sleepStartAt, sleepEndAt, sleepSpo2Avg, sleepSpo2Low,
        sleepRespirationAvg, hrvLastNightMs, hrvLastNight5MinHighMs, restingHeartRate,
        minHeartRate, maxHeartRate, spo2Avg, spo2Low, respirationWakingAvg, respirationLow,
        respirationHigh, steps, floorsAscended, intensityMinutesModerate, intensityMinutesVigorous.
        """
        return self._request("GET", "", params={"from": from_, "to": to, "limit": limit, "offset": offset})

    def get_day(self, date: str) -> dict:
        """One day ('YYYY-MM-DD'). Same field set as the list — no detail-only extras (#40)."""
        return self._request("GET", f"/{date}")

    def summary(self, *, window: int = 30, end: Optional[str] = None) -> dict:
        """The derived rollup — the read to open with when Curtis asks how he's doing.

        Returns {"window", "from", "to", "restingHeartRate", "hrvLastNightMs", "sleepTotalSeconds",
        "gaps"}. Each of the three metrics is {"current", "currentAvg", "deltaPerWeek", "series"}.

        Lead with `currentAvg` (the 7-day trailing average) and `deltaPerWeek`, NOT `current`: one
        night's HRV or one morning's resting HR is noise, exactly as one day's body weight is.

        `gaps` lists days with no data ("no_row") or a record with nothing measured
        ("no_measurements"). Report gaps as plain facts — never as a lapse, a streak broken, or a
        compliance figure.
        """
        return self._request("GET", "/summary", params={"window": window, "end": end})

    # -- corrections (rare) -----------------------------------------------------

    def reprocess(self, date: str) -> dict:
        """Re-derive a day's fields from the stored raw Garmin payload. The ONLY correction lever —
        there is no patch, because measurements are not editable. Use when the parser has been
        fixed, not to change a number you dislike."""
        return self._request("POST", f"/{date}/reprocess")

    def soft_delete(self, date: str) -> None:
        """Soft-delete a junk day (e.g. the watch recorded nonsense). The daemon's next poll can
        re-create it. The agent token cannot hard-delete."""
        self._request("DELETE", f"/{date}")
