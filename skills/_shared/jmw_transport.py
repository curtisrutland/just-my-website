"""Shared HTTP transport for the justmy.website skill clients.

Standalone — Python standard library only. The ONE copy lives in `skills/_shared/`; the skill build
(`scripts/build-skills.mjs`) copies it next to every skill's `client.py`, so each skill imports it as
a sibling module. Edit it here, never in a built skill.

Why it exists: from Claude's cloud sandbox, a few percent of calls die in the TLS handshake
(connection reset, SSL EOF, hangs) at the sandbox's outbound proxy — before the request reaches the
server. So every call goes through `request()`, which retries transient failures when a repeat
cannot double-apply the write:

- GET, PUT, PATCH (every patch body sets absolute values) and DELETE (a soft delete; a 404 on a
  *retry* means the first attempt landed) are always retried.
- A POST is retried only when its caller passes `idempotent=True` — the endpoint upserts or dedupes,
  so a repeat lands on the same row.
- Any other POST is NOT retried: a failure raises `WriteOutcomeUnknown`, because the write may or
  may not have landed. The agent reads the data back before deciding to write again. (Exception: a
  refused connection never sent anything, so that one is retried for every method.)
"""

from __future__ import annotations

import http.client
import json
import random
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

ATTEMPTS = 3
BACKOFF_SECONDS = (0.5, 1.5)  # sleep before attempt 2, then before attempt 3 (+ jitter)
TIMEOUT_SECONDS = 30  # per attempt
RETRY_STATUSES = frozenset({502, 503, 504})
SAFE_METHODS = frozenset({"GET", "PUT", "PATCH", "DELETE"})

_sleep = time.sleep  # swapped out by the tests


class TransportError(RuntimeError):
    """The request could not be completed: the connection kept failing across every attempt, or a
    gateway error (502/503/504) persisted. Nothing about the server's data is implied."""


class WriteOutcomeUnknown(TransportError):
    """A non-idempotent write failed in transit, so it may or may not have landed. Do NOT simply
    repeat it — read the data back first, then write only what is missing."""


def _is_transient(exc: BaseException) -> bool:
    if isinstance(exc, urllib.error.URLError) and not isinstance(exc, urllib.error.HTTPError):
        exc = exc.reason if isinstance(exc.reason, BaseException) else exc
    if isinstance(exc, ssl.SSLCertVerificationError):
        return False  # a bad certificate won't fix itself on a retry
    # ConnectionError covers reset/refused/aborted and http.client.RemoteDisconnected;
    # socket.timeout is TimeoutError on 3.10+, listed for older interpreters.
    return isinstance(
        exc, (ConnectionError, ssl.SSLError, TimeoutError, socket.timeout, http.client.IncompleteRead)
    )


def _never_sent(exc: BaseException) -> bool:
    """True only when the request provably never left: the connection was refused outright."""
    reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    return isinstance(reason, ConnectionRefusedError)


def _describe(exc: BaseException) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        return f"HTTP {exc.code}"
    reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    return type(reason).__name__ if isinstance(reason, BaseException) else str(reason)


def _raise_api_error(exc: urllib.error.HTTPError, error_cls: type[Exception]) -> None:
    """Turn the API's `{"error": {"code", "message", "details"}}` envelope into `error_cls`, with the
    message shaped `"<status> <code>: <message> (<details>)"` — callers match on the status prefix."""
    with exc:  # closes the error response's socket
        raw = exc.read()
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        parsed = {}
    err = parsed.get("error", {}) if isinstance(parsed, dict) else {}
    if not isinstance(err, dict):
        err = {}
    message = err.get("message") or raw.decode("utf-8", "replace")
    details = err.get("details")
    if details:
        # Carry field-path details through (e.g. which batch index / field failed validation).
        message = f"{message} ({details})"
    raise error_cls(f"{exc.code} {err.get('code', 'error')}: {message}") from None


def request(
    method: str,
    url: str,
    headers: dict[str, str],
    *,
    error_cls: type[Exception],
    body: Any = None,
    params: Optional[dict[str, Any]] = None,
    idempotent: Optional[bool] = None,
) -> Any:
    """Send one API call and return the parsed JSON body (None for an empty body or 204).

    Raises `error_cls` for an API error response, `WriteOutcomeUnknown` when a non-idempotent write
    failed in transit, and `TransportError` when the connection kept failing across every attempt.
    `idempotent` defaults to True for GET/PUT/PATCH/DELETE and False for POST."""
    method = method.upper()
    if idempotent is None:
        idempotent = method in SAFE_METHODS
    if params:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        if query:
            url = f"{url}?{query}"
    data = json.dumps(body).encode("utf-8") if body is not None else None

    for attempt in range(1, ATTEMPTS + 1):
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                if resp.status == 204:
                    return None
                payload = resp.read()
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as exc:
            if method == "DELETE" and exc.code == 404 and attempt > 1:
                exc.close()
                return None  # the earlier attempt's delete landed; its response was what got lost
            if exc.code not in RETRY_STATUSES:
                _raise_api_error(exc, error_cls)
            exc.close()
            failure: BaseException = exc
        except Exception as exc:  # noqa: BLE001 — classified just below; anything else re-raises
            if not _is_transient(exc):
                raise
            failure = exc

        name = _describe(failure)
        if not idempotent and not _never_sent(failure):
            raise WriteOutcomeUnknown(
                f"{method} {url} failed in transit ({name}: {failure}); the write may or may not have "
                "landed. Read the data back before retrying — do not repeat it blind."
            ) from None
        if attempt == ATTEMPTS:
            raise TransportError(f"{method} {url} failed after {ATTEMPTS} attempts ({name}: {failure})") from None
        delay = BACKOFF_SECONDS[attempt - 1] + random.uniform(0, 0.25)
        print(f"jmw: retry {attempt}/{ATTEMPTS - 1} after {name} ({method} {url}); waiting {delay:.1f}s", file=sys.stderr)
        _sleep(delay)
    raise AssertionError("unreachable")
