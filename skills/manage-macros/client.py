"""Thin Python client for the justmy.website macro token API.

This is Claude's sole write path into the macro tracker. It is STANDALONE — Python standard library
only, no third-party dependencies — so it runs in any sandbox without an install step.

Network egress: this skill talks to https://justmy.website (the token API under /api/macros). That
host must be reachable from the sandbox.

The base URL and agent token are injected at build time by scripts/build-skills.mjs (replacing the
__JMW_*__ placeholders); both can also be overridden via the JMW_BASE_URL / JMW_AGENT_TOKEN
environment variables for local development.

Nutrition contract: macros are plain numbers — grams for mass macros, kcal for energy. Field names
are the SAME everywhere — the schema.org NutritionInformation names (proteinContent, fatContent,
carbohydrateContent, ...) — on the fields you WRITE and the fields you READ BACK. The name you pass
to log_entry is the name you get from get_day / list_entries. No short aliases, no per-endpoint
renaming. Every write returns the created/updated object, so you can verify a write inline (check
the `id`).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

BASE_URL = (os.environ.get("JMW_BASE_URL") or "__JMW_BASE_URL__").rstrip("/")
TOKEN = os.environ.get("JMW_AGENT_TOKEN") or "__JMW_AGENT_TOKEN__"

# Curtis's timezone — the calendar day a meal belongs to is his LOCAL day, not UTC, not the sandbox's.
APP_TZ = ZoneInfo(os.environ.get("JMW_TZ", "America/Chicago"))

CONFIDENCE = ("measured", "estimated", "logged_serving")
KIND = ("training", "rest")

# A catalog food's PROVENANCE / trust, one axis (ingredient registry). 'usda' carries an fdcId;
# the other three are non-usda and MUST carry a category. 'scanned' = a real label (highest trust),
# 'proxy' = a deliberate stand-in (visibly a guess, upgradeable), 'estimated' = memory, no label.
SOURCE = ("usda", "scanned", "proxy", "estimated")

# The closed category vocabulary — narrows matching so "yogurt" doesn't collide across brands.
# 'other' is the escape hatch so a write is never blocked on category modeling.
CATEGORY = (
    "plant-milk",
    "dairy-milk",
    "yogurt",
    "protein-powder",
    "fruit",
    "vegetable",
    "nut-butter",
    "oil-fat",
    "grain",
    "meat",
    "seafood",
    "condiment",
    "sweetener",
    "egg",
    "legume",
    "beverage",
    "cheese",
    "other",
)

# The macro field names — schema.org NutritionInformation, used verbatim on read AND write.
_MACRO_FIELDS = (
    "calories",
    "proteinContent",
    "fatContent",
    "carbohydrateContent",
    "fiberContent",
    "sugarContent",
    "sodiumContent",
    "saturatedFatContent",
)

# Structural (non-macro) fields correct_entry may change -> the API field name it maps to.
# `consumed_on` is here on purpose: an entry CAN be moved to another day (no delete-and-recreate).
_CORRECTABLE = {
    "name": "name",
    "consumed_on": "consumedOn",
    "quantity_grams": "quantityGrams",
    "confidence": "confidence",
    "note": "note",
}


# Structural (non-macro) food fields register/update accept -> the API field name. Macros are
# handled separately via _MACRO_FIELDS (per-100g on a food).
_FOOD_STRUCTURAL = {
    "name": "name",
    "source": "source",
    "brand": "brand",
    "category": "category",
    "tags": "tags",
    "label_basis": "labelBasis",
    "serving_label": "servingLabel",
    "serving_grams": "servingGrams",
    "fdc_id": "fdcId",
}

# The four macros a registered ingredient must carry (per-100g) — the whole point is a pinned value,
# so a macro-less row is rejected. Everything else (fiber/sugar/sodium/satfat) is optional.
_CORE_MACROS = ("calories", "proteinContent", "fatContent", "carbohydrateContent")


class MacrosError(RuntimeError):
    """Raised when the API returns an error envelope."""


def _macros_payload(values: dict[str, Optional[float]]) -> dict[str, float]:
    """Keep the supplied (non-None) macros. Reject any key that isn't a real macro field, rather
    than silently dropping it — a mistyped field name is a bug, not a no-op."""
    unknown = [k for k in values if k not in _MACRO_FIELDS]
    if unknown:
        raise MacrosError(f"unknown macro field(s) {unknown}; valid macros are {list(_MACRO_FIELDS)}")
    return {k: v for k, v in values.items() if v is not None}


# Friendly (snake_case) structural field -> API field. Macros are handled via _MACRO_FIELDS.
_LOG_STRUCTURAL = {
    "consumed_on": "consumedOn",
    "quantity_grams": "quantityGrams",
    "confidence": "confidence",
    "name": "name",
    "note": "note",
    "food_id": "foodId",
}
_LOG_REQUIRED = ("consumed_on", "quantity_grams", "confidence")


def _entry_payload(fields: dict[str, Any], *, where: str = "entry") -> dict[str, Any]:
    """Build one entry's API payload from the friendly field names `log_entry` accepts. Raises
    MacrosError — naming `where` — on a missing required field, an unrecognised field, or a bad
    confidence, so a malformed item (e.g. one row of a batch) is rejected loudly, with its position,
    before anything is written."""
    missing = [k for k in _LOG_REQUIRED if fields.get(k) is None]
    if missing:
        raise MacrosError(f"{where}: missing required field(s) {missing}")
    payload: dict[str, Any] = {}
    macros: dict[str, Any] = {}
    unknown: list[str] = []
    for key, value in fields.items():
        if key in _LOG_STRUCTURAL:
            if value is not None:
                payload[_LOG_STRUCTURAL[key]] = value
        elif key in _MACRO_FIELDS:
            macros[key] = value
        else:
            unknown.append(key)
    if unknown:
        raise MacrosError(f"{where}: unrecognised field(s) {unknown}")
    if fields["confidence"] not in CONFIDENCE:
        raise MacrosError(f"{where}: confidence must be one of {CONFIDENCE}")
    payload.update(_macros_payload(macros))
    return payload


class MacrosClient:
    def __init__(self, base_url: str = BASE_URL, token: str = TOKEN):
        if not base_url or base_url.startswith("__JMW"):
            raise MacrosError("base URL not configured (build the skill or set JMW_BASE_URL)")
        if not token or token.startswith("__JMW"):
            raise MacrosError("agent token not configured (build the skill or set JMW_AGENT_TOKEN)")
        self._base = f"{base_url}/api/macros"
        self._headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}
        # Session cache-on-resolve for ingredients (mirrors USDA's cache-on-first-resolve): repeated
        # logging of the same ingredient in one session is a dict hit, not a re-fetch. Keyed by id.
        self._ingredient_cache: dict[str, dict] = {}

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
            details = err.get("details") if isinstance(err, dict) else None
            if details:
                # Carry field-path details through (e.g. which batch index / field failed validation).
                message = f"{message} ({details})"
            raise MacrosError(f"{exc.code} {err.get('code', 'error')}: {message}") from None

    # -- dates ------------------------------------------------------------------
    @staticmethod
    def today() -> str:
        """Curtis's CURRENT local calendar date ('YYYY-MM-DD', America/Chicago). Call this to anchor
        what day a meal is logged against — never infer the date from the conversation."""
        return datetime.now(APP_TZ).date().isoformat()

    # -- day view ---------------------------------------------------------------
    def get_day(self, date: str) -> dict:
        """The day-rollup: totals, estimation, resolved target(s), and entries."""
        return self._request("GET", f"/days/{date}")

    def list_entries(self, on: Optional[str] = None, limit: int = 50, offset: int = 0) -> dict:
        return self._request("GET", "/entries", params={"on": on, "limit": limit, "offset": offset})

    def get_range(self, start: str, end: str) -> list:
        """Per-day four-macro totals across the inclusive span [start, end] (YYYY-MM-DD) — for any
        multi-day / trend question ("fat trend this week", "under calories on rest days"). Returns
        ONE object per day, chronological: {date, kind, totals, targets}. Empty days come back ZEROED,
        never missing, so a gap can't be mistaken for an unlogged day. `totals` is the four tracked
        macros; aggregate (average / trend / over-under counts) yourself as the question needs."""
        return self._request("GET", "/range", params={"start": start, "end": end})

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
        proteinContent: Optional[float] = None,
        fatContent: Optional[float] = None,
        carbohydrateContent: Optional[float] = None,
        fiberContent: Optional[float] = None,
        sugarContent: Optional[float] = None,
        sodiumContent: Optional[float] = None,
        saturatedFatContent: Optional[float] = None,
    ) -> dict:
        """Log a consumed food on `consumed_on` (YYYY-MM-DD). ALWAYS pass a concise `name` (e.g.
        "grilled chicken breast", "3 large eggs") — it's the entry's display label. Provide absolute
        macros for the whole entry (quantity already applied), using the schema.org field names
        (proteinContent, fatContent, carbohydrateContent, ...) — the SAME names you read back. Use
        confidence 'estimated' + a `note` capturing the fuzziness / how you estimated. Returns the
        created entry (check its `id`)."""
        payload = _entry_payload(
            {
                "consumed_on": consumed_on,
                "quantity_grams": quantity_grams,
                "confidence": confidence,
                "name": name,
                "note": note,
                "food_id": food_id,
                "calories": calories,
                "proteinContent": proteinContent,
                "fatContent": fatContent,
                "carbohydrateContent": carbohydrateContent,
                "fiberContent": fiberContent,
                "sugarContent": sugarContent,
                "sodiumContent": sodiumContent,
                "saturatedFatContent": saturatedFatContent,
            }
        )
        return self._request("POST", "/entries", body=payload)

    def log_entries(self, entries: list[dict[str, Any]]) -> list[dict]:
        """Log several entries in ONE ATOMIC call — all succeed or none do. Use this for a composite
        meal (a restaurant plate broken into components, a smoothie's constituents): the meal is a
        unit, so "the plate logged or it didn't" is the only state worth having.

        Each item is a dict with the SAME field names `log_entry` takes — `consumed_on`,
        `quantity_grams`, `confidence` (required), plus `name`/`note`/`food_id` and macros by their
        schema.org names. Returns the created entries in read (`EntryView`) shape, in input order, so
        you can read-after-write without a follow-up call. If ANY item is malformed or the write
        fails, NOTHING is logged and this raises (identifying the offending index)."""
        if not entries:
            raise MacrosError("log_entries needs at least one entry")
        payload = [_entry_payload(dict(e), where=f"entries[{i}]") for i, e in enumerate(entries)]
        return self._request("POST", "/entries/batch", body=payload)

    def correct_entry(self, entry_id: str, **fields: Any) -> dict:
        """Correct an entry. Structural fields: `name`, `consumed_on` (move it to another day),
        `quantity_grams`, `confidence`, `note`. Plus any macro by its schema.org name
        (calories / proteinContent / carbohydrateContent / ...). Only the fields you pass change.

        Passing a field this method doesn't recognise is an ERROR, not a silent no-op — so a typo,
        or an attempt to change something that isn't correctable, surfaces immediately instead of
        returning success while quietly doing nothing. Returns the updated entry."""
        patch: dict[str, Any] = {}
        macros: dict[str, Any] = {}
        unknown: list[str] = []
        for key, value in fields.items():
            if key in _CORRECTABLE:
                patch[_CORRECTABLE[key]] = value
            elif key in _MACRO_FIELDS:
                macros[key] = value
            else:
                unknown.append(key)
        if unknown:
            raise MacrosError(
                f"correct_entry got unrecognised field(s) {unknown}; correctable fields are "
                f"{list(_CORRECTABLE)} plus macros {list(_MACRO_FIELDS)}"
            )
        if "confidence" in patch and patch["confidence"] not in CONFIDENCE:
            raise MacrosError(f"confidence must be one of {CONFIDENCE}")
        patch.update(_macros_payload(macros))
        if not patch:
            raise MacrosError("correct_entry called with nothing to change")
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

    def create_food(
        self,
        name: str,
        *,
        source: str = "estimated",
        category: Optional[str] = None,
        brand: Optional[str] = None,
        tags: Optional[list[str]] = None,
        label_basis: Optional[dict[str, Any]] = None,
        fdc_id: Optional[int] = None,
        serving_label: Optional[str] = None,
        serving_grams: Optional[float] = None,
        **macros: Any,
    ) -> dict:
        """LOW-LEVEL catalog write (per-100g macros). Prefer `register_ingredient`, which dedupe-checks
        first; reach for this only when you deliberately want a raw insert with no dedupe. A non-usda
        food needs a `category` (the API rejects it otherwise). Returns the created food."""
        payload: dict[str, Any] = {"name": name, "source": source}
        if category is not None:
            payload["category"] = category
        if brand is not None:
            payload["brand"] = brand
        if tags is not None:
            payload["tags"] = tags
        if label_basis is not None:
            payload["labelBasis"] = label_basis
        if fdc_id is not None:
            payload["fdcId"] = fdc_id
        if serving_label is not None:
            payload["servingLabel"] = serving_label
        if serving_grams is not None:
            payload["servingGrams"] = serving_grams
        payload.update(_macros_payload(macros))
        return self._request("POST", "/foods", body=payload)

    def list_foods(
        self,
        q: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        *,
        category: Optional[str] = None,
        brand: Optional[str] = None,
    ) -> dict:
        """LOW-LEVEL catalog read (paginated). `search_ingredient` is the friendlier front door."""
        return self._request(
            "GET", "/foods", params={"q": q, "category": category, "brand": brand, "limit": limit, "offset": offset}
        )

    # -- ingredient registry ----------------------------------------------------
    # A pinned catalog of branded/label foods (per-100g) so a smoothie's macros come from a fixed
    # row, not re-estimated from memory each time. Method shape mirrors the USDA search->resolve path.
    def search_ingredient(
        self, query: Optional[str] = None, *, category: Optional[str] = None, brand: Optional[str] = None, limit: int = 10
    ) -> dict:
        """Find candidate ingredients by fuzzy name, optionally narrowed by category and/or brand.
        Returns {items, ...} with each candidate's per-100g macros + source (source carries the trust
        signal). NEVER auto-pick — surface the candidates and CONFIRM which row, exactly as with the
        USDA search->resolve discipline (that is how a sweetened-vs-unsweetened mix-up slips in)."""
        if category is not None and category not in CATEGORY:
            raise MacrosError(f"category must be one of {CATEGORY}")
        return self.list_foods(query, limit=limit, category=category, brand=brand)

    def resolve_ingredient(self, ingredient_id: str) -> dict:
        """Return the full ingredient row by id, caching it for the session (cache-on-resolve) so
        repeated logging of the same ingredient doesn't re-fetch. `register`/`update` refresh the cache."""
        cached = self._ingredient_cache.get(ingredient_id)
        if cached is not None:
            return cached
        row = self._request("GET", f"/foods/{ingredient_id}")
        self._ingredient_cache[ingredient_id] = row
        return row

    def register_ingredient(
        self,
        name: str,
        category: str,
        *,
        source: str,
        brand: Optional[str] = None,
        tags: Optional[list[str]] = None,
        serving_label: Optional[str] = None,
        serving_grams: Optional[float] = None,
        label_basis: Optional[dict[str, Any]] = None,
        confirm: bool = False,
        **per100g: Any,
    ) -> dict:
        """Register a branded / label-scanned ingredient (per-100g macros, by schema.org name).

        REQUIRED: `name`, `category`, `source`, and per-100g `calories`/`proteinContent`/`fatContent`/
        `carbohydrateContent` (the pinned value is the whole point). `source` carries trust — use
        'scanned' for a real label, 'proxy' for a deliberate stand-in, 'estimated' for memory (there
        is NO separate confidence arg). When registering from a scan, pass `label_basis` = the printed
        serving + printed macros VERBATIM, so the per-100g values stay auditable.

        DEDUPE IS MANDATORY and happens here: before inserting, this searches the brand+category
        cohort (or fuzzy name within the category when no brand). If likely matches exist and you did
        NOT pass confirm=True, it does NOT insert — it returns
        {"created": None, "duplicate_candidates": [...]} so you can decide update-#id vs. new (this is
        the single most important guard against registry rot — e.g. "Ripple" vs "Ripple Unsweetened"
        a month apart). Pass confirm=True to insert anyway (a genuine new variant). On insert it
        returns {"created": <row>, "duplicate_candidates": []}."""
        if source not in SOURCE:
            raise MacrosError(f"source must be one of {SOURCE}")
        if category not in CATEGORY:
            raise MacrosError(f"category must be one of {CATEGORY}")
        missing = [m for m in _CORE_MACROS if per100g.get(m) is None]
        if missing:
            raise MacrosError(f"register_ingredient needs per-100g macro(s) {missing} (the pinned value is the point)")

        if not confirm:
            probe = self.search_ingredient(None if brand else name, category=category, brand=brand)
            candidates = probe.get("items", []) if isinstance(probe, dict) else []
            if candidates:
                return {"created": None, "duplicate_candidates": candidates}

        created = self.create_food(
            name,
            source=source,
            category=category,
            brand=brand,
            tags=tags,
            label_basis=label_basis,
            serving_label=serving_label,
            serving_grams=serving_grams,
            **per100g,
        )
        self._ingredient_cache[created["id"]] = created
        return {"created": created, "duplicate_candidates": []}

    def update_ingredient(self, ingredient_id: str, **fields: Any) -> dict:
        """Update an ingredient in place (SAME id, so entry history that snapshotted from it stays
        intact). The canonical use is UPGRADING a proxy/estimated row to 'scanned' once the real label
        appears — pass source='scanned' plus the corrected per-100g macros and a `label_basis`. Also
        for fixing a value or adding brand/tags. Structural fields (snake_case): `name`, `source`,
        `brand`, `category`, `tags`, `label_basis`, `serving_label`, `serving_grams`, `fdc_id`; plus
        any per-100g macro by its schema.org name. Passing an unrecognised field is an ERROR, not a
        silent no-op. Returns the updated row."""
        patch: dict[str, Any] = {}
        macros: dict[str, Any] = {}
        unknown: list[str] = []
        for key, value in fields.items():
            if key in _FOOD_STRUCTURAL:
                patch[_FOOD_STRUCTURAL[key]] = value
            elif key in _MACRO_FIELDS:
                macros[key] = value
            else:
                unknown.append(key)
        if unknown:
            raise MacrosError(
                f"update_ingredient got unrecognised field(s) {unknown}; updatable fields are "
                f"{list(_FOOD_STRUCTURAL)} plus macros {list(_MACRO_FIELDS)}"
            )
        if "source" in patch and patch["source"] not in SOURCE:
            raise MacrosError(f"source must be one of {SOURCE}")
        if "category" in patch and patch["category"] not in CATEGORY:
            raise MacrosError(f"category must be one of {CATEGORY}")
        patch.update(_macros_payload(macros))
        if not patch:
            raise MacrosError("update_ingredient called with nothing to change")
        row = self._request("PATCH", f"/foods/{ingredient_id}", body=patch)
        self._ingredient_cache[ingredient_id] = row  # refresh the session cache
        return row

    # -- targets ----------------------------------------------------------------
    def set_target(
        self,
        kind: str,
        effective_from: str,
        *,
        calories: Optional[float] = None,
        proteinContent: Optional[float] = None,
        fatContent: Optional[float] = None,
        carbohydrateContent: Optional[float] = None,
    ) -> dict:
        """Create a dated target profile for a kind (training/rest), effective from a date. Macros
        use the schema.org names (proteinContent, ...) — the same ones every read returns."""
        if kind not in KIND:
            raise MacrosError(f"kind must be one of {KIND}")
        payload: dict[str, Any] = {"kind": kind, "effectiveFrom": effective_from}
        payload.update(
            _macros_payload(
                dict(calories=calories, proteinContent=proteinContent, fatContent=fatContent, carbohydrateContent=carbohydrateContent)
            )
        )
        return self._request("POST", "/target-profiles", body=payload)
