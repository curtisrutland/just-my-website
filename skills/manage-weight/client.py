"""Thin Python client for the justmy.website weight token API.

Standalone — Python standard library only, no third-party dependencies. Network egress: talks to
https://justmy.website (the token API under /api/weight). Base URL and agent token are injected at
build time (or via JMW_BASE_URL / JMW_AGENT_TOKEN env vars for local dev).

Weight is a plain number in POUNDS ("lb" is display-only). One weight per day (re-logging replaces
it). Every write returns the created/updated entry.
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


class WeightError(RuntimeError):
    """Raised when the API returns an error envelope."""


class WeightClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        if not base_url or base_url.startswith("__JMW"):
            raise WeightError("base URL not configured (build the skill or set JMW_BASE_URL)")
        if not token or token.startswith("__JMW"):
            raise WeightError("agent token not configured (build the skill or set JMW_AGENT_TOKEN)")
        self._base = f"{base_url}/api/weight"
        self._headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}

    def _request(
        self, method: str, path: str, *, body: Any = None, params: Any = None, idempotent: Optional[bool] = None
    ) -> Any:
        return jmw_transport.request(
            method,
            self._base + path,
            self._headers,
            error_cls=WeightError,
            body=body,
            params=params,
            idempotent=idempotent,
        )

    # -- writes -----------------------------------------------------------------
    def log_weight(self, measured_on: str, weight: float, *, note: Optional[str] = None) -> dict:
        """Log/replace the body weight (lb) for `measured_on` (YYYY-MM-DD). Returns the entry."""
        body: dict[str, Any] = {"measuredOn": measured_on, "weight": weight}
        if note is not None:
            body["note"] = note
        # Safe to retry: an upsert (one weight per day).
        return self._request("POST", "/entries", body=body, idempotent=True)

    def correct_weight(self, entry_id: str, **fields: Any) -> dict:
        """Correct a weigh-in's `weight` and/or `note`. Only supplied fields change. Weigh-ins are
        keyed one-per-day, so `measured_on` is NOT correctable here — to move one to another date,
        log_weight() on the correct day and delete this entry. Raises on any unrecognised field, so a
        typo is a loud error, not a silent no-op that returns success without changing anything."""
        allowed = ("weight", "note")
        patch: dict[str, Any] = {}
        unknown: list[str] = []
        for key, value in fields.items():
            if key in allowed:
                patch[key] = value
            elif key == "measured_on":
                raise WeightError(
                    "measured_on is not correctable (weigh-ins are one-per-day); to move one, "
                    "log_weight() on the correct day and delete this entry"
                )
            else:
                unknown.append(key)
        if unknown:
            raise WeightError(f"correct_weight got unrecognised field(s) {unknown}; correctable: {list(allowed)}")
        if not patch:
            raise WeightError("correct_weight called with nothing to change")
        return self._request("PATCH", f"/entries/{entry_id}", body=patch)

    def delete_weight(self, entry_id: str) -> None:
        """Soft-delete an entry (the agent token cannot hard-delete)."""
        self._request("DELETE", f"/entries/{entry_id}")

    # -- reads ------------------------------------------------------------------
    def get_trend(self, *, window: int = 90, end: Optional[str] = None) -> dict:
        """The trend rollup: `summary` (current 7-day avg, trend lb/wk, range) + `series`
        (per-day raw weight + 7-day rolling average). This is the honest signal — a day is noise."""
        return self._request("GET", "/rollup", params={"window": window, "end": end})

    def get_weight(self, date: str) -> Optional[dict]:
        """The weight logged on a day, or None if none."""
        try:
            return self._request("GET", f"/days/{date}")
        except WeightError as exc:
            if str(exc).startswith("404"):
                return None
            raise

    def list_weights(self, limit: int = 50, offset: int = 0) -> dict:
        return self._request("GET", "/entries", params={"limit": limit, "offset": offset})
