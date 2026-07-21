"""Thin Python client for the justmy.website lifting token API.

Standalone — Python standard library only, no third-party dependencies. Network egress: talks to
https://justmy.website (the token API under /api/lifting). Base URL and agent token are injected at
build time (or via JMW_BASE_URL / JMW_AGENT_TOKEN env vars for local dev).

The lifting module is a training JOURNAL over Hevy: the sets/reps/weights are Hevy's facts, ingested
and READ-ONLY. What this skill writes is the ANNOTATION — Claude's `interpretation` + `focus`. Curtis
owns `session_notes` + `quality` (he edits those in the web); this client does not touch them.

Weights everywhere are canonical KILOGRAMS (`weightKg`, `e1rmKg`, `tonnageKg`, PR `value`). Curtis
logs and thinks in POUNDS — reason and write in whole lb (use `kg_to_lb`), never raw kg.
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

# The closed focus vocabulary (Zod-enforced server-side; validated here too for a loud early error).
FOCUSES = ("push", "pull", "upper", "lower", "full", "accessory", "other")


def kg_to_lb(kg: Optional[float]) -> Optional[int]:
    """Canonical kg → whole pounds (how Curtis reads weight). None passes through."""
    return None if kg is None else round(kg * 2.2046226)


class LiftingError(RuntimeError):
    """Raised when the API returns an error envelope."""


class LiftingClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        if not base_url or base_url.startswith("__JMW"):
            raise LiftingError("base URL not configured (build the skill or set JMW_BASE_URL)")
        if not token or token.startswith("__JMW"):
            raise LiftingError("agent token not configured (build the skill or set JMW_AGENT_TOKEN)")
        self._base = f"{base_url}/api/lifting"
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
            raise LiftingError(f"{exc.code} {err.get('code', 'error')}: {message}") from None

    # -- reads ------------------------------------------------------------------
    def list_sessions(
        self,
        *,
        interpreted: Optional[bool] = None,
        focus: Optional[str] = None,
        from_: Optional[str] = None,
        to: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Paginated session summaries, newest first. Filter by `interpreted` (the read queue),
        `focus`, and a startedAt range (`from_`/`to`, ISO date or datetime)."""
        params: dict[str, Any] = {"limit": limit, "offset": offset, "focus": focus, "from": from_, "to": to}
        if interpreted is not None:
            params["interpreted"] = "true" if interpreted else "false"
        return self._request("GET", "/sessions", params=params)

    def list_uninterpreted(self, limit: int = 50) -> dict:
        """The work queue: sessions that have no Claude read yet (interpreted=false)."""
        return self.list_sessions(interpreted=False, limit=limit)

    def get_session(self, session_id: str) -> dict:
        """A full session: exercises → sets, derived stats (tonnage/e1RM/PRs), and the annotation.
        READ `annotation.sessionNotes` first — Curtis records context there (e.g. a machine change),
        so you never misread a load drop as a regression."""
        return self._request("GET", f"/sessions/{session_id}")

    def get_lift(self, template_id: str) -> dict:
        """Progression for one lift identity (`exerciseTemplateId`), oldest → newest. Returns the
        object DIRECTLY (not an `items`-wrapped list like the list_* calls):
            {"templateId", "title", "points": [{"sessionId", "startedAt", "e1rmKg", "topSetKg"}]}
        Read `["points"]`. Weights are kg; `e1rmKg` is null for bodyweight lifts. Use to ground
        trajectory claims in the interpretation."""
        return self._request("GET", f"/lifts/{template_id}")

    # -- writes (the annotation — Claude's fields only) -------------------------
    def interpret(self, session_id: str, *, interpretation: Optional[str] = None, focus: Optional[str] = None) -> dict:
        """Write the read: `interpretation` (prose) and/or `focus` (a FOCUSES tag). Latest-wins. Does
        NOT touch Curtis's `session_notes`/`quality`. Raises on an invalid focus (loud, not silent).
        Returns the full updated session."""
        if focus is not None and focus not in FOCUSES:
            raise LiftingError(f"unknown focus {focus!r}; allowed: {list(FOCUSES)}")
        patch: dict[str, Any] = {}
        if interpretation is not None:
            patch["interpretation"] = interpretation
        if focus is not None:
            patch["focus"] = focus
        if not patch:
            raise LiftingError("interpret needs interpretation and/or focus")
        return self._request("PATCH", f"/sessions/{session_id}", body=patch)

    # -- ingestion + lifecycle --------------------------------------------------
    def pull(self, pages: int = 1) -> dict:
        """Catch-up pull from Hevy (recover a missed webhook). Idempotent. `pages` bounds the sweep;
        the one-time backfill passes a large number. Returns { scanned, ingested, pages }."""
        return self._request("POST", "/pull", params={"pages": pages})

    def soft_delete(self, session_id: str) -> None:
        """Soft-delete a session (the agent token cannot hard-delete)."""
        self._request("DELETE", f"/sessions/{session_id}")
