#!/usr/bin/env python3
"""One-time interactive Garmin login -> writes a reusable token session to ./tokenstore.

Run this ONCE, on a machine with a terminal, then copy the `tokenstore/` directory to the Upboard.
The daemon never holds the Garmin password — only these OAuth tokens — and never logs in on a
schedule, because Garmin IP-rate-limits logins (this script itself will likely see a 429 or two on
its way to succeeding; that is normal and it falls back).

The password is read with getpass: never echoed, never stored, never in shell history.
"""

from __future__ import annotations

import sys
from getpass import getpass
from pathlib import Path

from garminconnect import Garmin

STORE = str(Path(__file__).resolve().parent / "tokenstore")


def main() -> int:
    if not sys.stdin.isatty():
        print("This needs a real terminal (it prompts for a password).", file=sys.stderr)
        return 1

    email = input("Garmin Connect email: ").strip()
    password = getpass("Garmin Connect password: ")

    g = Garmin(email=email, password=password, prompt_mfa=lambda: input("MFA code: ").strip())
    g.login(tokenstore=STORE)

    print(f"\n✓ logged in as: {g.get_full_name()}")
    print(f"✓ token session written to: {STORE}")
    print("  Copy that directory to the Upboard. The password is not needed again.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
