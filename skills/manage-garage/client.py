"""Thin Python client for the justmy.website garage token API.

Standalone — Python standard library only, no third-party dependencies. Network egress: talks to
https://justmy.website (the token API under /api/garage, and /api/rides for reads). Base URL and
agent token are injected at build time (or via JMW_BASE_URL / JMW_AGENT_TOKEN env vars for local dev).

The garage holds Curtis's bikes, the device-profile rules that auto-tag rides ("GRAVEL" → the
Checkpoint), and which bike each ride was on. A tag copies in the ride facts it needs (date,
profile, moving time, distance); the garage never reads the rides module. This client is the one
place that reads both: it reads a ride from /api/rides and hands its facts to the garage, which is
what CONVENTIONS §9 allows a module's own skill to do. It never writes to rides.

Every stored quantity is SI (meters, seconds). Curtis reads miles (1 decimal) and h:mm.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Optional

try:
    import jmw_transport
except ImportError:  # running from the source tree — the skill build copies it next to this file
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_shared"))
    import jmw_transport
from jmw_transport import TransportError, WriteOutcomeUnknown  # noqa: F401 — re-exported for callers

BASE_URL = (os.environ.get("JMW_BASE_URL") or "__JMW_BASE_URL__").rstrip("/")
TOKEN = os.environ.get("JMW_AGENT_TOKEN") or "__JMW_AGENT_TOKEN__"

PAGE = 100  # the API's maximum page size


# -- display conversions (stored SI → how Curtis reads it) ---------------------

def m_to_mi(meters: Optional[float]) -> Optional[float]:
    """Meters → miles, 1 decimal ("214.8 mi"). None passes through."""
    return None if meters is None else round(meters / 1609.344, 1)


def sec_to_hm(seconds: Optional[float]) -> Optional[str]:
    """Seconds → "31:24" (hours:minutes, truncated). None passes through."""
    if seconds is None:
        return None
    total_minutes = int(seconds) // 60
    return f"{total_minutes // 60}:{total_minutes % 60:02d}"


class GarageError(RuntimeError):
    """Raised when the API returns an error envelope, or a bike name doesn't resolve."""


def _facts(ride: dict) -> dict:
    """The ride facts a garage tag copies in, from a rides-API ride."""
    return {
        "activityId": ride["id"],
        "localDate": ride["localDate"],
        "startedAt": ride["startedAt"],
        "sportProfileName": ride.get("sportProfileName"),
        "movingSeconds": ride["movingSeconds"],
        "distanceMeters": ride.get("distanceMeters"),
    }


class GarageClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        if not base_url or base_url.startswith("__JMW"):
            raise GarageError("base URL not configured (build the skill or set JMW_BASE_URL)")
        if not token or token.startswith("__JMW"):
            raise GarageError("agent token not configured (build the skill or set JMW_AGENT_TOKEN)")
        self._base = f"{base_url}/api"
        self._headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}

    def _request(
        self, method: str, path: str, *, body: Any = None, params: Any = None, idempotent: Optional[bool] = None
    ) -> Any:
        return jmw_transport.request(
            method,
            self._base + path,
            self._headers,
            error_cls=GarageError,
            body=body,
            params=params,
            idempotent=idempotent,
        )

    # -- bikes -------------------------------------------------------------------

    def list_bikes(self, *, from_: Optional[str] = None, to: Optional[str] = None, include_retired: bool = False) -> list[dict]:
        """Every bike: name (the nickname), brand/model/modelYear, profiles (its auto-tag rules),
        retiredOn, and its totals from TAGGED rides — rides, movingSeconds, distanceMeters,
        lastRiddenOn. With `from_`/`to` ('YYYY-MM-DD', local dates, inclusive) the totals cover only
        that window; without, all time. Untagged rides are in no bike's totals — see `untagged_rides`."""
        params = {"from": from_, "to": to, "includeRetired": "true" if include_retired else None}
        return self._request("GET", "/garage/bikes", params=params)["items"]

    def find_bike(self, name: str) -> dict:
        """Resolve a bike by nickname or model, case-insensitively, retired bikes included ("checkpoint"
        finds "Checkpoint ALR4"). Raises if nothing or more than one bike matches."""
        bikes = self.list_bikes(include_retired=True)
        needle = name.strip().lower()
        exact = [b for b in bikes if needle in (b["name"].lower(), b["model"].lower())]
        matches = exact or [b for b in bikes if needle in b["name"].lower() or needle in b["model"].lower()]
        if len(matches) != 1:
            names = ", ".join(b["name"] for b in (matches or bikes))
            raise GarageError(f"'{name}' matches {'no bike' if not matches else 'several bikes'} ({names})")
        return matches[0]

    def get_bike(self, bike: str, *, from_: Optional[str] = None, to: Optional[str] = None) -> dict:
        """One bike (by nickname, model or id) with its totals, all time or for the window."""
        bike_id = self._bike_id(bike)
        return self._request("GET", f"/garage/bikes/{bike_id}", params={"from": from_, "to": to})

    def create_bike(self, brand: str, model: str, model_year: int, *, name: Optional[str] = None,
                    profiles: Optional[list[str]] = None, note: Optional[str] = None) -> dict:
        """Add a bike. `name` (the nickname) defaults to the model. `profiles` are the device
        activity profiles that mean this bike (a profile names at most one bike). Not retried on a
        dropped connection: if it raises WriteOutcomeUnknown, `list_bikes()` before trying again."""
        body = {"brand": brand, "model": model, "modelYear": model_year, "name": name, "profiles": profiles, "note": note}
        return self._request("POST", "/garage/bikes", body={k: v for k, v in body.items() if v is not None})

    def update_bike(self, bike: str, **fields: Any) -> dict:
        """Edit a bike: name, brand, model, modelYear, note, profiles (REPLACES the set — removing a
        profile also removes the rule tags it made), retiredOn ('YYYY-MM-DD' retires it: its rules go,
        its rides stay; None un-retires)."""
        allowed = {"name", "brand", "model", "modelYear", "note", "profiles", "retiredOn"}
        unknown = set(fields) - allowed
        if unknown:
            raise GarageError(f"unknown field(s) {sorted(unknown)}; writable: {sorted(allowed)}")
        return self._request("PATCH", f"/garage/bikes/{self._bike_id(bike)}", body=fields)

    def _bike_id(self, bike: str) -> str:
        if len(bike) == 36 and bike.count("-") == 4:
            return bike
        return self.find_bike(bike)["id"]

    # -- ride tags ---------------------------------------------------------------

    def ride_tags(self, *, bike: Optional[str] = None, from_: Optional[str] = None, to: Optional[str] = None) -> list[dict]:
        """Every ride tag (all pages), newest ride first: activityId (the ride's id), bikeId,
        assignedBy ('rule' | 'manual' | 'backfill'), reason, and the copied localDate,
        sportProfileName, movingSeconds, distanceMeters."""
        params = {"bikeId": self._bike_id(bike) if bike else None, "from": from_, "to": to}
        return self._all("/garage/rides", params)

    def tag_of(self, ride_id: str) -> Optional[dict]:
        """The ride's tag, or None when it's on no bike."""
        items = self._request("GET", "/garage/rides", params={"activityId": ride_id})["items"]
        return items[0] if items else None

    def tag_ride(self, ride_id: str, bike: str) -> dict:
        """Put a ride on a bike — only when Curtis says which. Reads the ride from the rides API and
        copies its facts in. Already on that bike: returned unchanged. On another bike: moved (a move
        makes it a manual tag). Safe to retry."""
        bike_id = self._bike_id(bike)
        existing = self.tag_of(ride_id)
        if existing:
            if existing["bikeId"] == bike_id:
                return existing
            return self._request("PATCH", f"/garage/rides/{existing['id']}", body={"bikeId": bike_id})
        ride = self._request("GET", f"/rides/{ride_id}")
        # Idempotent per ride: a repeat lands on the same tag (200), never a duplicate.
        return self._request("POST", "/garage/rides", body={**_facts(ride), "bikeId": bike_id}, idempotent=True)

    def untag_ride(self, ride_id: str) -> None:
        """Take a ride off its bike (a soft delete). No-op when it has no tag."""
        existing = self.tag_of(ride_id)
        if existing:
            self._request("DELETE", f"/garage/rides/{existing['id']}")

    # -- the rides the garage can't see on its own --------------------------------

    def untagged_rides(self, *, from_: Optional[str] = None, to: Optional[str] = None) -> list[dict]:
        """Cycling rides (from the rides API) that are on no bike, newest first, optionally within a
        local-date window. These are in no bike's totals; mention them whenever you quote a total."""
        rides = self._all("/rides", {"sport": "cycling", "from": from_, "to": to})
        tagged = {t["activityId"] for t in self._all("/garage/rides", {"from": from_, "to": to})}
        return [r for r in rides if r["id"] not in tagged]

    def apply_rules(self, *, from_: Optional[str] = None, to: Optional[str] = None) -> dict:
        """Run rides through the profile rules (e.g. after adding a profile to a bike). Creates or
        re-points rule tags only; tags Curtis or the backfill made are never touched. Returns
        {tagged, unchanged, unmatched}. Safe to retry."""
        rides = self._all("/rides", {"sport": None, "from": from_, "to": to})
        result: dict = {"tagged": [], "unchanged": [], "unmatched": []}
        for i in range(0, len(rides), 500):
            chunk = [_facts(r) for r in rides[i:i + 500]]
            part = self._request("POST", "/garage/rides/attribute", body={"rides": chunk}, idempotent=True)
            for key in result:
                result[key].extend(part[key])
        return result

    def mileage(self, *, from_: Optional[str] = None, to: Optional[str] = None) -> dict:
        """Miles and hours per bike over a window (default all time), in Curtis's units, PLUS the
        untagged rides in the same window — the honest answer to "how many miles on each bike".
        Returns {"bikes": [{name, rides, miles, hours, lastRiddenOn}], "untagged": {rides, miles}}."""
        bikes = self.list_bikes(from_=from_, to=to, include_retired=True)
        loose = self.untagged_rides(from_=from_, to=to)
        return {
            "bikes": [
                {
                    "name": b["name"],
                    "rides": b["rides"],
                    "miles": m_to_mi(b["distanceMeters"]),
                    "hours": sec_to_hm(b["movingSeconds"]),
                    "lastRiddenOn": b["lastRiddenOn"],
                }
                for b in bikes
                if b["rides"] or not b["retiredOn"]
            ],
            "untagged": {"rides": len(loose), "miles": m_to_mi(sum(r.get("distanceMeters") or 0 for r in loose))},
        }

    # -- paging -------------------------------------------------------------------

    def _all(self, path: str, params: dict) -> list[dict]:
        items: list[dict] = []
        offset = 0
        while True:
            page = self._request("GET", path, params={**params, "limit": PAGE, "offset": offset})
            items.extend(page["items"])
            offset += PAGE
            if offset >= page["count"] or not page["items"]:
                return items
