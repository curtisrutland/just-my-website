"""Thin Python client for the justmy.website macro token API.

This is Claude's sole write path into the macro tracker. It is standalone (stdlib + httpx) so it
runs in a sandbox from claude.ai. The base URL and agent token are injected at build time by
scripts/build-skills.mjs (replacing the __JMW_*__ placeholders); both can also be overridden via
the JMW_BASE_URL / JMW_AGENT_TOKEN environment variables for local development.

Nutrition contract: macros are plain numbers — grams for mass macros, kcal for energy. The client
exposes friendly names (protein/fat/carbs/...) and maps them to the API's schema.org field names.
"""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx

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
        self._client = httpx.Client(
            base_url=f"{base_url}/api/macros",
            headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
            timeout=30.0,
        )

    # -- low level --------------------------------------------------------------
    def _request(self, method: str, path: str, *, json: Any = None, params: Any = None) -> Any:
        resp = self._client.request(method, path, json=json, params=params)
        if resp.status_code == 204:
            return None
        body = resp.json() if resp.content else None
        if resp.status_code >= 400:
            err = (body or {}).get("error", {}) if isinstance(body, dict) else {}
            raise MacrosError(f"{resp.status_code} {err.get('code', 'error')}: {err.get('message', resp.text)}")
        return body

    # -- day view ---------------------------------------------------------------
    def get_day(self, date: str) -> dict:
        """The day-rollup: totals, estimation, resolved target(s), and entries."""
        return self._request("GET", f"/days/{date}")

    def list_entries(self, on: Optional[str] = None, limit: int = 50, offset: int = 0) -> dict:
        params = {"limit": limit, "offset": offset}
        if on:
            params["on"] = on
        return self._request("GET", "/entries", params=params)

    # -- logging (the main write path) ------------------------------------------
    def log_entry(
        self,
        consumed_on: str,
        quantity_grams: float,
        confidence: str,
        *,
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
        """Log a consumed food on `consumed_on` (YYYY-MM-DD). Provide absolute macros for the whole
        entry (quantity already applied). Use confidence 'estimated' + a `note` capturing what Curtis
        actually said when you inferred the numbers."""
        if confidence not in CONFIDENCE:
            raise MacrosError(f"confidence must be one of {CONFIDENCE}")
        payload: dict[str, Any] = {"consumedOn": consumed_on, "quantityGrams": quantity_grams, "confidence": confidence}
        if note is not None:
            payload["note"] = note
        if food_id is not None:
            payload["foodId"] = food_id
        payload.update(_macros_payload(dict(calories=calories, protein=protein, fat=fat, carbs=carbs, fiber=fiber, sugar=sugar, sodium=sodium, satfat=satfat)))
        return self._request("POST", "/entries", json=payload)

    def correct_entry(self, entry_id: str, **fields: Any) -> dict:
        """Correct an entry. Accepts quantity_grams, confidence, note, and any macro (calories/
        protein/fat/carbs/...). Only supplied fields change."""
        patch: dict[str, Any] = {}
        if "quantity_grams" in fields:
            patch["quantityGrams"] = fields.pop("quantity_grams")
        if "confidence" in fields:
            patch["confidence"] = fields.pop("confidence")
        if "note" in fields:
            patch["note"] = fields.pop("note")
        patch.update(_macros_payload(fields))
        return self._request("PATCH", f"/entries/{entry_id}", json=patch)

    def delete_entry(self, entry_id: str) -> None:
        """Soft-delete an entry (the agent token cannot hard-delete)."""
        self._request("DELETE", f"/entries/{entry_id}")

    # -- day kind ---------------------------------------------------------------
    def set_day_kind(self, day: str, kind: str) -> dict:
        if kind not in KIND:
            raise MacrosError(f"kind must be one of {KIND} (omit the day to leave it unspecified)")
        return self._request("POST", "/day-tags", json={"day": day, "kind": kind})

    def clear_day_kind(self, day: str) -> None:
        """Remove a day's tag → back to unspecified."""
        self._request("DELETE", f"/day-tags/{day}")

    # -- foods ------------------------------------------------------------------
    def search_usda(self, query: str) -> dict:
        """Search USDA FoodData Central (no write)."""
        return self._request("GET", "/usda/search", params={"q": query})

    def resolve_usda(self, fdc_id: int) -> dict:
        """Resolve + cache a USDA food by fdcId (cache-on-first-resolve). Returns the cached food."""
        return self._request("POST", "/usda/resolve", json={"fdcId": fdc_id})

    def create_food(self, name: str, *, source: str = "custom", fdc_id: Optional[int] = None, serving_label: Optional[str] = None, serving_grams: Optional[float] = None, **macros: Any) -> dict:
        """Create a catalog food (per-100g macros). Use for custom foods (a specific bar, whey, ...)."""
        payload: dict[str, Any] = {"name": name, "source": source}
        if fdc_id is not None:
            payload["fdcId"] = fdc_id
        if serving_label is not None:
            payload["servingLabel"] = serving_label
        if serving_grams is not None:
            payload["servingGrams"] = serving_grams
        payload.update(_macros_payload(macros))
        return self._request("POST", "/foods", json=payload)

    def list_foods(self, q: Optional[str] = None, limit: int = 50, offset: int = 0) -> dict:
        params = {"limit": limit, "offset": offset}
        if q:
            params["q"] = q
        return self._request("GET", "/foods", params=params)

    # -- targets ----------------------------------------------------------------
    def set_target(self, kind: str, effective_from: str, *, calories: Optional[float] = None, protein: Optional[float] = None, fat: Optional[float] = None, carbs: Optional[float] = None) -> dict:
        """Create a dated target profile for a kind (training/rest), effective from a date."""
        if kind not in KIND:
            raise MacrosError(f"kind must be one of {KIND}")
        payload: dict[str, Any] = {"kind": kind, "effectiveFrom": effective_from}
        payload.update(_macros_payload(dict(calories=calories, protein=protein, fat=fat, carbs=carbs)))
        return self._request("POST", "/target-profiles", json=payload)
