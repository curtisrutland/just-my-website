"""Tests for skills/_shared/jmw_transport.py and its wiring into every skill client.

Run: npm run skills:test   (or: python3 -m unittest discover -s skills/tests)
Standard library only, like the skills themselves. `urlopen` is faked; nothing touches the network.
"""

from __future__ import annotations

import http.client
import importlib.util
import io
import json
import os
import socket
import ssl
import sys
import unittest
import urllib.error
from contextlib import redirect_stderr
from pathlib import Path
from typing import Any, Callable
from unittest import mock

SKILLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILLS / "_shared"))

import jmw_transport  # noqa: E402
from jmw_transport import TransportError, WriteOutcomeUnknown  # noqa: E402

URL = "https://jmw.test/api/x"
HEADERS = {"authorization": "Bearer t"}


class ApiError(RuntimeError):
    pass


class FakeResponse:
    def __init__(self, body: Any = None, status: int = 200):
        self.status = status
        self._raw = b"" if body is None else json.dumps(body).encode()

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *exc: Any) -> None:
        return None


def http_error(code: int, body: Any = None) -> urllib.error.HTTPError:
    raw = json.dumps(body).encode() if body is not None else b""
    return urllib.error.HTTPError(URL, code, "err", {}, io.BytesIO(raw))  # type: ignore[arg-type]


def reset() -> urllib.error.URLError:
    return urllib.error.URLError(ConnectionResetError(104, "Connection reset by peer"))


class FakeUrlopen:
    """Plays a script of outcomes (an exception to raise, or a FakeResponse), then succeeds."""

    def __init__(self, *script: Any, default: Any = None):
        self.script = list(script)
        self.default = default if default is not None else {"ok": True}
        self.calls: list[tuple[str, str]] = []

    def __call__(self, req: Any, timeout: float | None = None) -> FakeResponse:
        assert timeout == jmw_transport.TIMEOUT_SECONDS, "every attempt must carry the timeout"
        self.calls.append((req.get_method(), req.full_url))
        if self.script:
            outcome = self.script.pop(0)
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome
        return FakeResponse(self.default)


class TransportCase(unittest.TestCase):
    def setUp(self) -> None:
        self.sleeps: list[float] = []
        patcher = mock.patch.object(jmw_transport, "_sleep", self.sleeps.append)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.stderr = io.StringIO()
        redirect = redirect_stderr(self.stderr)
        redirect.__enter__()
        self.addCleanup(redirect.__exit__, None, None, None)

    def run_with(self, fake: FakeUrlopen, method: str, **kwargs: Any) -> Any:
        with mock.patch("urllib.request.urlopen", fake):
            return jmw_transport.request(method, URL, HEADERS, error_cls=ApiError, **kwargs)


class RetryTests(TransportCase):
    def test_safe_methods_succeed_on_third_attempt_after_two_resets(self) -> None:
        for method in ("GET", "PATCH", "DELETE", "PUT"):
            with self.subTest(method=method):
                self.sleeps.clear()
                fake = FakeUrlopen(reset(), reset(), FakeResponse({"v": 1}))
                self.assertEqual(self.run_with(fake, method), {"v": 1})
                self.assertEqual(len(fake.calls), 3)
                self.assertEqual(len(self.sleeps), 2)
                self.assertTrue(0.5 <= self.sleeps[0] <= 0.75 and 1.5 <= self.sleeps[1] <= 1.75, self.sleeps)

    def test_each_transient_error_kind_is_retried(self) -> None:
        kinds = {
            "reset": reset(),
            "ssl-eof": urllib.error.URLError(ssl.SSLEOFError(8, "UNEXPECTED_EOF_WHILE_READING")),
            "ssl-generic": urllib.error.URLError(ssl.SSLError(1, "handshake")),
            "timeout-wrapped": urllib.error.URLError(socket.timeout("timed out")),
            "timeout-bare": TimeoutError("read timed out"),
            "remote-disconnected": http.client.RemoteDisconnected("closed"),
            "bare-reset": ConnectionResetError(104, "reset"),
            "incomplete-read": http.client.IncompleteRead(b"par"),
            "http-502": http_error(502),
            "http-503": http_error(503),
            "http-504": http_error(504),
        }
        for name, exc in kinds.items():
            with self.subTest(kind=name):
                fake = FakeUrlopen(exc, FakeResponse({"v": 1}))
                self.assertEqual(self.run_with(fake, "GET"), {"v": 1})
                self.assertEqual(len(fake.calls), 2)

    def test_gives_up_after_three_attempts(self) -> None:
        fake = FakeUrlopen(reset(), reset(), reset())
        with self.assertRaises(TransportError) as ctx:
            self.run_with(fake, "GET")
        self.assertNotIsInstance(ctx.exception, WriteOutcomeUnknown)
        self.assertEqual(len(fake.calls), 3)
        self.assertIn("after 3 attempts", str(ctx.exception))

    def test_retries_are_logged_to_stderr(self) -> None:
        self.run_with(FakeUrlopen(urllib.error.URLError(ssl.SSLEOFError(8, "eof")), reset()), "GET")
        log = self.stderr.getvalue()
        self.assertIn("retry 1/2 after SSLEOFError", log)
        self.assertIn("retry 2/2 after ConnectionResetError", log)

    def test_not_transient_errors_are_not_retried(self) -> None:
        cert = urllib.error.URLError(ssl.SSLCertVerificationError(1, "certificate verify failed"))
        dns = urllib.error.URLError(socket.gaierror(8, "nodename nor servname provided"))
        for exc in (cert, dns, ValueError("boom")):
            with self.subTest(exc=exc):
                fake = FakeUrlopen(exc)
                with self.assertRaises(type(exc)):
                    self.run_with(fake, "GET")
                self.assertEqual(len(fake.calls), 1)


class ClientErrorTests(TransportCase):
    def test_4xx_is_not_retried_and_maps_the_error_envelope(self) -> None:
        body = {"error": {"code": "validation_error", "message": "bad", "details": {"path": "x"}}}
        for method in ("GET", "PATCH", "DELETE", "POST"):
            for code in (400, 401, 404, 409, 422):
                with self.subTest(method=method, code=code):
                    fake = FakeUrlopen(http_error(code, body))
                    with self.assertRaises(ApiError) as ctx:
                        self.run_with(fake, method)
                    self.assertEqual(str(ctx.exception), f"{code} validation_error: bad ({{'path': 'x'}})")
                    self.assertEqual(len(fake.calls), 1)

    def test_error_without_envelope_falls_back_to_raw_body(self) -> None:
        exc = urllib.error.HTTPError(URL, 500, "err", {}, io.BytesIO(b"Internal Server Error"))  # type: ignore[arg-type]
        with self.assertRaises(ApiError) as ctx:
            self.run_with(FakeUrlopen(exc), "GET")
        self.assertEqual(str(ctx.exception), "500 error: Internal Server Error")

    def test_delete_404_on_a_retry_is_success(self) -> None:
        fake = FakeUrlopen(reset(), http_error(404))
        self.assertIsNone(self.run_with(fake, "DELETE"))
        self.assertEqual(len(fake.calls), 2)

    def test_delete_404_on_first_attempt_is_an_error(self) -> None:
        with self.assertRaises(ApiError):
            self.run_with(FakeUrlopen(http_error(404)), "DELETE")

    def test_get_404_on_a_retry_is_still_an_error(self) -> None:
        with self.assertRaises(ApiError):
            self.run_with(FakeUrlopen(reset(), http_error(404)), "GET")


class PostTests(TransportCase):
    def test_non_idempotent_post_raises_write_outcome_unknown_without_retrying(self) -> None:
        for exc in (reset(), urllib.error.URLError(ssl.SSLEOFError(8, "eof")), TimeoutError(), http_error(504)):
            with self.subTest(exc=exc):
                fake = FakeUrlopen(exc)
                with self.assertRaises(WriteOutcomeUnknown) as ctx:
                    self.run_with(fake, "POST", body={"a": 1})
                self.assertEqual(len(fake.calls), 1)
                self.assertIn("Read the data back", str(ctx.exception))
        self.assertEqual(self.sleeps, [])

    def test_refused_connection_is_retried_even_for_a_non_idempotent_post(self) -> None:
        refused = urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))
        fake = FakeUrlopen(refused, FakeResponse({"id": "1"}, status=201))
        self.assertEqual(self.run_with(fake, "POST", body={"a": 1}), {"id": "1"})
        self.assertEqual(len(fake.calls), 2)

    def test_idempotent_post_is_retried(self) -> None:
        fake = FakeUrlopen(reset(), reset(), FakeResponse({"id": "1"}))
        self.assertEqual(self.run_with(fake, "POST", body={"a": 1}, idempotent=True), {"id": "1"})
        self.assertEqual(len(fake.calls), 3)

    def test_write_outcome_unknown_is_a_transport_error(self) -> None:
        self.assertTrue(issubclass(WriteOutcomeUnknown, TransportError))


class RequestShapeTests(TransportCase):
    def test_params_drop_none_and_204_returns_none(self) -> None:
        fake = FakeUrlopen(FakeResponse(status=204))
        self.assertIsNone(self.run_with(fake, "GET", params={"a": 1, "b": None}))
        self.assertEqual(fake.calls, [("GET", f"{URL}?a=1")])

    def test_empty_body_returns_none(self) -> None:
        self.assertIsNone(self.run_with(FakeUrlopen(FakeResponse()), "GET"))


# -- every client is wired to the transport, with the right retry class per write ------------------

def load_client(skill: str) -> Any:
    spec = importlib.util.spec_from_file_location(f"client_{skill.replace('-', '_')}", SKILLS / skill / "client.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CLIENTS = {
    "manage-health": "HealthClient",
    "manage-lifting": "LiftingClient",
    "manage-macros": "MacrosClient",
    "manage-rides": "RidesClient",
    "manage-shopping": "ShoppingClient",
    "manage-vitals": "VitalsClient",
    "manage-weight": "WeightClient",
}

MACROS = dict(calories=100, proteinContent=10, fatContent=5, carbohydrateContent=8)
DAY = "2026-09-29"

# (skill, call) pairs that must retry transparently: reads, PATCH, soft DELETE, server-idempotent POSTs.
RETRIED: list[tuple[str, Callable[[Any], Any]]] = [
    ("manage-health", lambda c: c._get("/x")),
    ("manage-lifting", lambda c: c.set_goal("Get stronger")),
    ("manage-lifting", lambda c: c.pull()),
    ("manage-lifting", lambda c: c.soft_delete("s1")),
    ("manage-macros", lambda c: c.resolve_usda(12345)),
    ("manage-macros", lambda c: c.finish_batch("b1", DAY)),
    ("manage-macros", lambda c: c.delete_entry("e1")),
    ("manage-rides", lambda c: c.soft_delete("r1")),
    ("manage-shopping", lambda c: c.check_item("i1")),
    ("manage-shopping", lambda c: c.delete_item("i1")),
    ("manage-vitals", lambda c: c.reprocess(DAY)),
    ("manage-vitals", lambda c: c.soft_delete(DAY)),
    ("manage-weight", lambda c: c.log_weight(DAY, 180.0)),
    ("manage-weight", lambda c: c.correct_weight("w1", weight=181.0)),
    ("manage-weight", lambda c: c.delete_weight("w1")),
]

# Create POSTs that would duplicate a row if repeated — they must surface WriteOutcomeUnknown (#57).
NOT_RETRIED: list[tuple[str, Callable[[Any], Any]]] = [
    ("manage-macros", lambda c: c.log_entry(DAY, 100, "estimated", name="Oats", **MACROS)),
    ("manage-macros", lambda c: c.log_entries([dict(consumed_on=DAY, quantity_grams=100, confidence="estimated",
                                                    name="Oats", **MACROS)])),
    ("manage-macros", lambda c: c.create_food("Oats", **MACROS)),
    ("manage-macros", lambda c: c.register_batch("Chili", DAY, **MACROS)),
    ("manage-macros", lambda c: c.set_target(DAY, calories=2000)),
    ("manage-shopping", lambda c: c.add_item("produce", "apples")),
]


class ClientWiringTests(TransportCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.modules = {skill: load_client(skill) for skill in CLIENTS}
        cls.clients = {
            skill: getattr(cls.modules[skill], name)(base_url="https://jmw.test", token="t")
            for skill, name in CLIENTS.items()
        }

    def test_every_client_uses_the_shared_transport(self) -> None:
        for skill in CLIENTS:
            with self.subTest(skill=skill):
                source = (SKILLS / skill / "client.py").read_text()
                self.assertIn("jmw_transport.request(", source)
                self.assertNotIn("urlopen", source)
                self.assertFalse((SKILLS / skill / "jmw_transport.py").exists(), "no per-skill copies")

    def test_safe_calls_retry_through_two_resets(self) -> None:
        for skill, call in RETRIED:
            with self.subTest(skill=skill, line=call.__code__.co_firstlineno):
                fake = FakeUrlopen(reset(), reset())
                with mock.patch("urllib.request.urlopen", fake):
                    call(self.clients[skill])
                self.assertEqual(len(fake.calls), 3, fake.calls)

    def test_create_posts_raise_write_outcome_unknown_after_one_attempt(self) -> None:
        for skill, call in NOT_RETRIED:
            with self.subTest(skill=skill):
                fake = FakeUrlopen(reset())
                with mock.patch("urllib.request.urlopen", fake):
                    with self.assertRaises(WriteOutcomeUnknown):
                        call(self.clients[skill])
                self.assertEqual([m for m, _ in fake.calls].count("POST"), 1, fake.calls)
                self.assertEqual(fake.calls[-1][0], "POST")

    def test_api_errors_keep_each_clients_own_error_class(self) -> None:
        for skill, name in CLIENTS.items():
            with self.subTest(skill=skill):
                client = self.clients[skill]
                error_cls = getattr(self.modules[skill], name.replace("Client", "Error"))
                send = client._get if skill == "manage-health" else lambda p: client._request("GET", p)
                with mock.patch("urllib.request.urlopen", FakeUrlopen(http_error(404))):
                    with self.assertRaises(error_cls) as ctx:
                        send("/missing")
                self.assertTrue(str(ctx.exception).startswith("404"))

    def test_clients_re_export_the_transport_errors(self) -> None:
        for skill in CLIENTS:
            module = self.modules[skill]
            self.assertIs(module.WriteOutcomeUnknown, WriteOutcomeUnknown)
            self.assertIs(module.TransportError, TransportError)


if __name__ == "__main__":
    os.environ.pop("JMW_BASE_URL", None)
    unittest.main()
