"""Thin Python client for the justmy.website rides token API.

Standalone — Python standard library only, no third-party dependencies. Network egress: talks to
https://justmy.website (the token API under /api/rides). Base URL and agent token are injected at
build time (or via JMW_BASE_URL / JMW_AGENT_TOKEN env vars for local dev).

The rides module is the LOG of Curtis's Garmin activities (rides first; runs/hikes are guests).
Every measured field is an ingested FACT from a FIT file — read-only from every surface. What this
skill writes is the HUMAN LAYER only: a ride's `name` and `note`. There is no upload here (files
arrive via the web page or the daemon) and no manual ride creation, ever.

Every stored quantity is SI: meters, seconds, m/s, watts, bpm, kcal, °C. Curtis reads IMPERIAL —
miles (1 decimal), whole feet, mph (1 decimal), h:mm:ss. Use the converters below; never surface
a raw m/s or meter value.
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


# -- display conversions (stored SI → how Curtis reads it) ---------------------

def m_to_mi(meters: Optional[float]) -> Optional[float]:
    """Meters → miles, 1 decimal ("3.8 mi"). None passes through."""
    return None if meters is None else round(meters / 1609.344, 1)


def m_to_ft(meters: Optional[float]) -> Optional[int]:
    """Meters → whole feet ("289 ft"). None passes through."""
    return None if meters is None else round(meters * 3.280839895)


def mps_to_mph(mps: Optional[float]) -> Optional[float]:
    """Meters/second → mph, 1 decimal ("5.2 mph"). None passes through."""
    return None if mps is None else round(mps * 2.2369363, 1)


def sec_to_hms(seconds: Optional[float]) -> Optional[str]:
    """Seconds → "43:41" / "2:56:01" (truncated — a ride of 43:41.5 reads 43:41). None passes."""
    if seconds is None:
        return None
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


class RidesError(RuntimeError):
    """Raised when the API returns an error envelope."""


# PATCH accepts exactly the human layer. Anything else raises HERE, loudly, before the wire —
# the API would 400 it anyway (.strict()); measured data is corrected by reprocess, not by edit.
_PATCH_FIELDS = {"name": "name", "note": "note"}


class RidesClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        if not base_url or base_url.startswith("__JMW"):
            raise RidesError("base URL not configured (build the skill or set JMW_BASE_URL)")
        if not token or token.startswith("__JMW"):
            raise RidesError("agent token not configured (build the skill or set JMW_AGENT_TOKEN)")
        self._base = f"{base_url}/api/rides"
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
            raise RidesError(f"{exc.code} {err.get('code', 'error')}: {message}") from None

    # -- reads ------------------------------------------------------------------

    def list_rides(
        self,
        *,
        sport: Optional[str] = "cycling",
        from_: Optional[str] = None,
        to: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Paginated ride summaries, newest first. `sport` defaults to "cycling" (rides-first —
        the module's reason for existing); pass sport=None for EVERY activity (runs, hikes, …).
        `from_`/`to` bound the LOCAL calendar date ('YYYY-MM-DD'); `q` matches the name OR the
        device profile name (unnamed rides are the norm — "MTB" finds them).

        Each item: name (often None — fall back to sportProfileName + localDate, e.g.
        "MTB — Jul 28"), localDate (ALWAYS the display date; never use startedAt's UTC date),
        distanceMeters/movingSeconds/totalAscentMeters/avgHeartRate/avgPowerWatts (any may be
        None — a watch ride has no power; a trainer ride no distance), and timeInHrZone."""
        return self._request(
            "GET", "", params={"sport": sport, "from": from_, "to": to, "q": q, "limit": limit, "offset": offset}
        )

    def get_ride(self, ride_id: str, *, streams: bool = False) -> dict:
        """One full ride. `streams=True` adds the downsampled per-10s arrays (heavy — you almost
        never need them; the summary + timeInHrZone answer "how was the ride"). The zone
        histogram is self-describing: `timeInHrZone.timeInHrZone` is seconds per bucket and
        `hrZoneHighBoundary` gives the bpm bounds those buckets were computed with — describe
        effort by bpm range, never by a made-up fitness score."""
        return self._request("GET", f"/{ride_id}", params={"streams": "1"} if streams else None)

    def weekly(self, *, weeks: int = 8, sport: str = "cycling") -> dict:
        """The weekly rollup, newest week first: {"weeks": [{weekStart, rides, distanceMeters,
        movingSeconds, totalAscentMeters, avgPowerWatts}]}. Weeks with no rides are omitted.
        `sport="all"` covers every activity."""
        return self._request("GET", "/weekly", params={"weeks": weeks, "sport": sport})

    # -- the human layer (the ONLY write) ---------------------------------------

    def update_ride(self, ride_id: str, **fields: Any) -> dict:
        """Write the human layer: `name` ("Big climb loop") and/or `note` ("legs felt dead, ran
        out of water"). Pass None to clear a field. ANY other field raises — measured data is
        immutable; a wrong number means the file gets reprocessed, not edited. Returns the
        updated ride for inline verification."""
        unknown = set(fields) - set(_PATCH_FIELDS)
        if unknown:
            raise RidesError(
                f"unknown field(s) {sorted(unknown)}: only 'name' and 'note' are writable — "
                "measured data is corrected by reprocessing the file, never by editing"
            )
        if not fields:
            raise RidesError("update_ride needs name and/or note")
        body = {_PATCH_FIELDS[k]: v for k, v in fields.items()}
        return self._request("PATCH", f"/{ride_id}", body=body)

    # -- lifecycle --------------------------------------------------------------

    def soft_delete(self, ride_id: str) -> None:
        """Soft-delete a ride (a bad upload). The agent token cannot hard-delete, and the raw
        file stays in storage either way."""
        self._request("DELETE", f"/{ride_id}")
