"""Thin Python client for the justmy.website macro token API.

This is Claude's sole write path into the macro tracker. It is STANDALONE — Python standard library
only, no third-party dependencies — so it runs in any sandbox without an install step.

Network egress: this skill talks to https://justmy.website (the token API under /api/macros). That
host must be reachable from the sandbox.

The base URL and agent token are injected at build time by scripts/build-skills.mjs (replacing the
__JMW_*__ placeholders); both can also be overridden via the JMW_BASE_URL / JMW_AGENT_TOKEN
environment variables for local development.

Nutrition contract: macros are plain numbers — grams for mass macros, kcal for energy. The client
exposes friendly names (protein/fat/carbs/...) and maps them to the API's schema.org field names.
Every write returns the created/updated object, so you can verify a write inline (check the `id`).
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

CONFIDENCE = ("measured", "estimated", "logged_serving")
KIND = ("training", "rest")

# friendly name -> schema.org NutritionInformation field
_MACROS = {
    "calories": "calories",
    "protein": "proteinContent",
    "fat": "fatContent",
    "carbs": "carbohydrateContent",
    "fiber": "fiberContent",
    "sugar": "sugarContent",
    "sodium": "sodiumContent",
    "satfat": "saturatedFatContent",
}


class MacrosError(RuntimeError):
    """Raised when the API returns an error envelope."""


def _macros_payload(values: dict[str, Optional[float]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for friendly, field in _MACROS.items():
        v = values.get(friendly)
        if v is not None:
            out[field] = v
    return out


class MacrosClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        if not base_url or base_url.startswith("__JMW"):
            raise MacrosError("base URL not configured (build the skill or set JMW_BASE_URL)")
        if not token or token.startswith("__JMW"):
            raise MacrosError("agent token not configured (build the skill or set JMW_AGENT_TOKEN)")
        self._base = f"{base_url}/api/macros"
        self._headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}

    # -- low level (stdlib urllib) ----------------------------------------------
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
            raise MacrosError(f"{exc.code} {err.get('code', 'error')}: {message}") from None

    # -- day view ---------------------------------------------------------------
    def get_day(self, date: str) -> dict:
        """The day-rollup: totals, estimation, resolved target(s), and entries."""
        return self._request("GET", f"/days/{date}")

    def list_entries(self, on: Optional[str] = None, limit: int = 50, offset: int = 0) -> dict:
        return self._request("GET", "/entries", params={"on": on, "limit": limit, "offset": offset})

    # -- logging (the main write path) ------------------------------------------
    def log_entry(
        self,
        consumed_on: str,
        quantity_grams: float,
        confidence: str,
        *,
        name: Optional[str] = None,
        note: Optional[str] = None,
        food_id: Optional[str] = None,
        calories: Optional[float] = None,
        protein: Optional[float] = None,
        fat: Optional[float] = None,
        carbs: Optional[float] = None,
        fiber: Optional[float] = None,
        sugar: Optional[float] = None,
        sodium: Optional[float] = None,
        satfat: Optional[float] = None,
    ) -> dict:
        """Log a consumed food on `consumed_on` (YYYY-MM-DD). ALWAYS pass a concise `name` (e.g.
        "grilled chicken breast", "3 large eggs") — it's the entry's display label. Provide absolute
        macros for the whole entry (quantity already applied). Use confidence 'estimated' + a `note`
        capturing the fuzziness / how you estimated. Returns the created entry (check its `id`)."""
        if confidence not in CONFIDENCE:
            raise MacrosError(f"confidence must be one of {CONFIDENCE}")
        payload: dict[str, Any] = {"consumedOn": consumed_on, "quantityGrams": quantity_grams, "confidence": confidence}
        if name is not None:
            payload["name"] = name
        if note is not None:
            payload["note"] = note
        if food_id is not None:
            payload["foodId"] = food_id
        payload.update(_macros_payload(dict(calories=calories, protein=protein, fat=fat, carbs=carbs, fiber=fiber, sugar=sugar, sodium=sodium, satfat=satfat)))
        return self._request("POST", "/entries", body=payload)

    def correct_entry(self, entry_id: str, **fields: Any) -> dict:
        """Correct an entry. Accepts name, quantity_grams, confidence, note, and any macro
        (calories/protein/fat/carbs/...). Only supplied fields change. Returns the updated entry."""
        patch: dict[str, Any] = {}
        for key in ("name", "confidence", "note"):
            if key in fields:
                patch[key] = fields.pop(key)
        if "quantity_grams" in fields:
            patch["quantityGrams"] = fields.pop("quantity_grams")
        patch.update(_macros_payload(fields))
        return self._request("PATCH", f"/entries/{entry_id}", body=patch)

    def delete_entry(self, entry_id: str) -> None:
        """Soft-delete an entry (the agent token cannot hard-delete)."""
        self._request("DELETE", f"/entries/{entry_id}")

    # -- day kind ---------------------------------------------------------------
    def set_day_kind(self, day: str, kind: str) -> dict:
        if kind not in KIND:
            raise MacrosError(f"kind must be one of {KIND} (omit the day to leave it unspecified)")
        return self._request("POST", "/day-tags", body={"day": day, "kind": kind})

    def clear_day_kind(self, day: str) -> None:
        """Remove a day's tag → back to unspecified."""
        self._request("DELETE", f"/day-tags/{day}")

    # -- foods ------------------------------------------------------------------
    def search_usda(self, query: str) -> dict:
        """Search USDA FoodData Central (no write)."""
        return self._request("GET", "/usda/search", params={"q": query})

    def resolve_usda(self, fdc_id: int) -> dict:
        """Resolve + cache a USDA food by fdcId (cache-on-first-resolve). Returns the cached food."""
        return self._request("POST", "/usda/resolve", body={"fdcId": fdc_id})

    def create_food(self, name: str, *, source: str = "custom", fdc_id: Optional[int] = None, serving_label: Optional[str] = None, serving_grams: Optional[float] = None, **macros: Any) -> dict:
        """Create a catalog food (per-100g macros). Use for reusable custom foods (a specific bar,
        unflavored whey) — not one-off estimates; those just get a `name` on the entry."""
        payload: dict[str, Any] = {"name": name, "source": source}
        if fdc_id is not None:
            payload["fdcId"] = fdc_id
        if serving_label is not None:
            payload["servingLabel"] = serving_label
        if serving_grams is not None:
            payload["servingGrams"] = serving_grams
        payload.update(_macros_payload(macros))
        return self._request("POST", "/foods", body=payload)

    def list_foods(self, q: Optional[str] = None, limit: int = 50, offset: int = 0) -> dict:
        return self._request("GET", "/foods", params={"q": q, "limit": limit, "offset": offset})

    # -- targets ----------------------------------------------------------------
    def set_target(self, kind: str, effective_from: str, *, calories: Optional[float] = None, protein: Optional[float] = None, fat: Optional[float] = None, carbs: Optional[float] = None) -> dict:
        """Create a dated target profile for a kind (training/rest), effective from a date."""
        if kind not in KIND:
            raise MacrosError(f"kind must be one of {KIND}")
        payload: dict[str, Any] = {"kind": kind, "effectiveFrom": effective_from}
        payload.update(_macros_payload(dict(calories=calories, protein=protein, fat=fat, carbs=carbs)))
        return self._request("POST", "/target-profiles", body=payload)
