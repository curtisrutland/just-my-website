"""Thin Python client for the justmy.website lifting token API.

Standalone — Python standard library only, no third-party dependencies. Network egress: talks to
https://justmy.website (the token API under /api/lifting). Base URL and agent token are injected at
build time (or via JMW_BASE_URL / JMW_AGENT_TOKEN env vars for local dev).

The lifting module is a training JOURNAL over Hevy: the sets/reps/weights are Hevy's facts, ingested
and READ-ONLY. What this skill writes is the ANNOTATION — Claude's `interpretation` + `focus`. Curtis
owns `session_notes` + `quality` (he edits those in the web); this client does not touch them.

Above the sessions sits the GOAL STATEMENT — prose describing what the training is for right now.
It is the frame a session is read against, and it rides along on every session read (`get_session`
returns `["goal"]`; the list calls return it on the envelope), so a read is never written goal-blind.
Both surfaces write it: Curtis in the web, you via `set_goal`.

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
        `focus`, and a startedAt range (`from_`/`to`, ISO date or datetime). The envelope also
        carries `["goal"]` — the CURRENT goal statement (or None) — beside `["items"]`."""
        params: dict[str, Any] = {"limit": limit, "offset": offset, "focus": focus, "from": from_, "to": to}
        if interpreted is not None:
            params["interpreted"] = "true" if interpreted else "false"
        return self._request("GET", "/sessions", params=params)

    def list_uninterpreted(self, limit: int = 50) -> dict:
        """The work queue: sessions that have no Claude read yet (interpreted=false)."""
        return self.list_sessions(interpreted=False, limit=limit)

    def get_session(self, session_id: str) -> dict:
        """A full session: exercises → sets, derived stats (tonnage/e1RM/PRs), the annotation, and
        `["goal"]` — the goal in force ON THIS SESSION'S DATE (not necessarily today's), or None.
        READ `annotation.sessionNotes` first — Curtis records context there (e.g. a machine change),
        so you never misread a load drop as a regression — and read `goal` before you interpret:
        the same numbers mean different things under 'build the pull' vs 'hold through a deload'."""
        return self._request("GET", f"/sessions/{session_id}")

    def get_lift(self, template_id: str) -> dict:
        """Progression for one lift identity (`exerciseTemplateId`), oldest → newest. Returns the
        object DIRECTLY (not an `items`-wrapped list like the list_* calls):
            {"templateId", "title", "points": [{"sessionId", "startedAt", "e1rmKg", "topSetKg"}]}
        Read `["points"]`. Weights are kg; `e1rmKg` is null for bodyweight lifts. Use to ground
        trajectory claims in the interpretation."""
        return self._request("GET", f"/lifts/{template_id}")

    # -- the goal statement (module-level; both surfaces write it) --------------
    def get_goal(self, on: Optional[str] = None) -> Optional[dict]:
        """The goal statement in force today, or on the calendar date `on` ('YYYY-MM-DD'). Returns
        `{"id", "effectiveFrom", "statement"}`, or None if no goal has ever been set. Bring this into
        context BEFORE discussing or interpreting any training data."""
        return self._request("GET", "/goal", params={"on": on})

    def list_goals(self, limit: int = 50) -> dict:
        """Goal history, newest first (`["items"]`). Superseded goals are kept — use this to see how
        the intent has moved across blocks, or to read an old session against the goal of its era."""
        return self._request("GET", "/goals", params={"limit": limit})

    def set_goal(self, statement: str, *, effective_from: Optional[str] = None) -> dict:
        """Set the goal — freeform prose, in CURTIS'S words. One live goal per `effective_from` date
        (default today), so this UPSERTS on that date: restating today's goal rewords it, a new date
        supersedes and keeps the old one in history.

        This is Curtis's statement of intent, not your read. Write it when he tells you the goal has
        changed ("I'm shifting to a strength block through the fall") — capture what he said, don't
        author a goal for him or fold your own interpretation into it."""
        if not statement.strip():
            raise LiftingError("goal statement cannot be empty")
        body: dict[str, Any] = {"statement": statement}
        if effective_from is not None:
            body["effectiveFrom"] = effective_from
        return self._request("POST", "/goal", body=body)

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
