"""Thin Python client for the justmy.website shopping token API.

Standalone — Python standard library only, no third-party dependencies. Network egress: talks to
https://justmy.website (the token API under /api/shopping). Base URL and agent token are injected at
build time (or via JMW_BASE_URL / JMW_AGENT_TOKEN env vars for local dev).

The shopping list is one flat list, one grouping level deep (a freeform `category` string -> item).
There is no quantity field — the item `text` carries it ("2 dozen eggs"). Items are `needed` until
checked off (`bought`); removal is a soft-delete. Nothing is normalized.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterable, Optional

BASE_URL = (os.environ.get("JMW_BASE_URL") or "__JMW_BASE_URL__").rstrip("/")
TOKEN = os.environ.get("JMW_AGENT_TOKEN") or "__JMW_AGENT_TOKEN__"


class ShoppingError(RuntimeError):
    """Raised when the API returns an error envelope."""


class ShoppingClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        if not base_url or base_url.startswith("__JMW"):
            raise ShoppingError("base URL not configured (build the skill or set JMW_BASE_URL)")
        if not token or token.startswith("__JMW"):
            raise ShoppingError("agent token not configured (build the skill or set JMW_AGENT_TOKEN)")
        self._base = f"{base_url}/api/shopping"
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
            raise ShoppingError(f"{exc.code} {err.get('code', 'error')}: {message}") from None

    # -- writes -----------------------------------------------------------------
    def add_item(self, category: str, text: str) -> dict:
        """Add one item to `category` ("Produce"). `text` is freeform and carries any quantity
        ("2 dozen eggs"). Starts `needed`. Returns the created item (check its `id`)."""
        return self._request("POST", "/items", body={"category": category, "text": text})

    def add_items(self, items: Iterable[Any]) -> list:
        """Add several items in one call (the common case — "add the ingredients for X"). `items` is
        an iterable of (category, text) pairs OR {"category","text"} dicts. Returns the created list."""
        created = []
        for it in items:
            category, text = (it["category"], it["text"]) if isinstance(it, dict) else it
            created.append(self.add_item(category, text))
        return created

    def edit_item(self, item_id: str, **fields: Any) -> dict:
        """Correct an item's `category` and/or `text`. Only supplied fields change."""
        patch = {k: fields[k] for k in ("category", "text") if k in fields}
        return self._request("PATCH", f"/items/{item_id}", body=patch)

    def check_item(self, item_id: str) -> dict:
        """Check an item off (needed -> bought). Returns the updated item."""
        return self._request("PATCH", f"/items/{item_id}", body={"status": "bought"})

    def uncheck_item(self, item_id: str) -> dict:
        """Put a checked item back on the list (bought -> needed)."""
        return self._request("PATCH", f"/items/{item_id}", body={"status": "needed"})

    def delete_item(self, item_id: str) -> None:
        """Soft-delete an item ("added by mistake" — the agent token cannot hard-delete)."""
        self._request("DELETE", f"/items/{item_id}")

    # -- reads ------------------------------------------------------------------
    def get_list(self, *, bought_within_days: Optional[int] = None) -> dict:
        """The list as the UI sees it: `active` (items grouped by category), `recentlyBought`
        (checked off within the window, newest first), and `activeCount`. Use this to find an
        item's `id` before checking/editing/deleting it."""
        return self._request("GET", "/list", params={"boughtWithinDays": bought_within_days})

    def list_items(self, limit: int = 50, offset: int = 0) -> dict:
        """A flat paginated list of all live items (rarely needed — prefer `get_list`)."""
        return self._request("GET", "/items", params={"limit": limit, "offset": offset})

    def get_item(self, item_id: str) -> Optional[dict]:
        """One item by id, or None if not found."""
        try:
            return self._request("GET", f"/items/{item_id}")
        except ShoppingError as exc:
            if str(exc).startswith("404"):
                return None
            raise
