# Garmin daemon — install & run

Polls Garmin Connect and pushes facts into justmy.website. Spec and rationale:
[`docs/garmin-daemon.md`](../docs/garmin-daemon.md).

| Loop | Cadence | What it does |
|---|---|---|
| activities | 15 min | new activities → download `ORIGINAL` → unzip → `POST /api/rides/upload` |
| vitals | 60 min | today + previous 3 days → `POST /api/vitals` |

It only ever **reads** from Garmin and only ever **pushes** to justmy.website. It holds one
credential for each side, and neither can do anything else.

---

## 1. One-time Garmin login (on a machine with a terminal)

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/python garmin_login.py
```

Prompts for email, password (hidden), and an MFA code if Garmin asks. It writes `tokenstore/`.

> A `429` or two during login is **normal** — Garmin IP-rate-limits logins and the client falls
> back. This is also exactly why the daemon never logs in on a schedule.

The password is used once, here, and is never stored. Copy `tokenstore/` to the Upboard; the daemon
runs off those tokens.

## 2. Install on the Upboard

Runs as your own login user under a **systemd user service** — the daemon needs no privileges and
owns nothing outside `$HOME`, so this avoids a service account and needs **no sudo at all**.

> **Ubuntu 26.04 ships no `pip` and no `ensurepip`**, so `python3 -m venv` fails outright. Build the
> venv `--without-pip` and bootstrap pip into it:

```bash
mkdir -p ~/jmw-garmin
python3 -m venv --without-pip ~/jmw-garmin/venv
curl -sS https://bootstrap.pypa.io/get-pip.py | ~/jmw-garmin/venv/bin/python -
```

Copy `garmin_daemon.py`, `requirements.txt` and `tokenstore/` into `~/jmw-garmin`, then:

```bash
chmod 700 ~/jmw-garmin/tokenstore && chmod 600 ~/jmw-garmin/tokenstore/*
~/jmw-garmin/venv/bin/pip install -r ~/jmw-garmin/requirements.txt
```

The publisher token goes in an environment file, **piped over stdin** — never as a command-line
argument, where `ps` would expose it to every user on the box:

```bash
printf 'JMW_PUBLISHER_TOKEN=%s\n' "$TOKEN" > ~/.config/jmw-garmin.env
chmod 600 ~/.config/jmw-garmin.env
```

```bash
mkdir -p ~/.config/systemd/user
cp systemd/jmw-garmin.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now jmw-garmin
journalctl --user -u jmw-garmin -f
```

**Enable lingering, or the daemon dies when your session ends** — without it systemd stops the
user manager at logout and the service does not come back on reboot:

```bash
loginctl enable-linger          # no sudo needed; verify with: loginctl show-user "$USER" | grep -i Linger
```

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `JMW_PUBLISHER_TOKEN` | — | **required.** Scoped to two push routes; cannot read or delete |
| `JMW_BASE_URL` | `https://justmy.website` | point at a dev server for testing |
| `JMW_ACTIVITY_INTERVAL` | `900` | seconds |
| `JMW_VITALS_INTERVAL` | `3600` | seconds |
| `JMW_VITALS_TRAILING_DAYS` | `3` | how far back to re-poll; Garmin revises days after the fact |

## Files it writes

- `state.json` — last-seen activity ids and poll timestamps. Written atomically. **Safe to delete:**
  it is an optimization, not a correctness mechanism. Losing it causes re-downloads, never
  duplicates (uploads dedupe on file hash; vitals upsert on date).
- `tokenstore/` — Garmin OAuth tokens. **Secret.** Both are gitignored.

## Operating it

| Symptom in the log | Meaning |
|---|---|
| `deduped` | Normal. The daemon re-sends files forever and the server recognises them |
| `updated` on vitals | Normal. A day is re-pushed each cycle while it sits in the trailing window |
| `backing off Ns` | Rate limit or a 5xx. Self-corrects |
| `REJECTED` | A 400 — the payload is wrong. Needs a human; it will not fix itself by retrying |
| `fatal:` + exit 1 | Tokens rejected, or the publisher token is missing. Re-run the login step |

If the daemon dies entirely, nothing is lost: FIT files can still be dragged into the rides page by
hand, and a restart re-polls the trailing window.
