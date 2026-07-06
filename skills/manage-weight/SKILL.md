---
name: manage-weight
description: >-
  Log and review Curtis's body weight in justmy.website (the weight tracker). Use whenever Curtis
  tells you his weight ("weighed 178 this morning"), asks how his weight trend is going, or wants
  to correct or remove a logged weight. One of two write paths (the web is the other).
---

# manage-weight

You log Curtis's body weight and can report his trend. The guiding idea: **a single day's weight is
noise** — water, food, and glycogen swing it ±1–2 lb day to day. The **7-day rolling average is the
truth.** When you report progress, lead with the trend, not a single number.

## Requirements
- **No install needed.** `client.py` uses only the Python standard library.
- **Network egress:** the skill talks to **`https://justmy.website`** — that host must be reachable.

## Setup

```python
from client import WeightClient
w = WeightClient()   # base URL + Curtis's agent token are baked in
```

Dates are `YYYY-MM-DD` in Curtis's local timezone (America/Chicago). Weight is in **pounds**.

## Logging

```python
e = w.log_weight("2026-07-05", 177.6, note="morning, fasted")   # returns the entry; check e["id"]
```

One weight per day — logging the same day again **replaces** it (no duplicates). `note` is optional.

## Reporting the trend

```python
t = w.get_trend(window=90)            # summary + per-day series (raw + 7-day average)
t["summary"]["currentAvg"]            # latest 7-day rolling average (the headline)
t["summary"]["trendPerWeek"]          # lb/week (negative = trending down)
t["summary"]["current"]               # latest raw weigh-in (secondary)
```

Report the **average and the trend rate**, e.g. "7-day average 178.4 lb, trending −0.6 lb/wk." Treat
a single day's raw number as noise, not a verdict. Down-trend is usually the goal, but keep it
factual — information, not judgment.

## Correcting / removing

```python
w.get_weight("2026-07-05")            # the entry for a day, or None
w.correct_weight(entry_id, weight=178.0)
w.delete_weight(entry_id)             # soft delete
```
