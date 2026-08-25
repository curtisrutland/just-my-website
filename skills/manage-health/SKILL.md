---
name: manage-health
description: >-
  The unified view of Curtis's health data in justmy.website — macros, body weight, lifting, and
  rides in one daily or weekly snapshot. Use for check-ins and cross-domain questions: "how am I
  doing", "how's the week going", a morning/evening review, "am I eating enough for how much I'm
  training", or to see what's unlogged or pending. Read-only: it assembles what the per-module
  skills manage; every write belongs to manage-macros / manage-weight / manage-lifting /
  manage-rides.
---

# manage-health

One skill, the whole picture. The health modules are deliberately separate — food, weight,
lifting, rides each with its own skill — but Curtis's actual question is often about the person,
not a module: *how am I doing?* This skill answers that with one call instead of four.

The signature: **assemble, never invent.** Every number in the view is a module's own number under
the module's own field name. This skill computes no scores, no "readiness", no cross-module
metrics — the modules don't, so their aggregation doesn't either. The one thing it adds is
`gaps`: factual absences (nothing logged, nothing interpreted). A gap is an observation, never a
judgment.

## Requirements
- **No install needed.** `client.py` uses only the Python standard library.
- **Network egress:** the skill talks to **`https://justmy.website`** — that host must be reachable.

## Setup

```python
from client import HealthClient
h = HealthClient()   # base URL + Curtis's agent token are baked in
```

Dates are `YYYY-MM-DD` in Curtis's local timezone (America/Chicago). `h.today()` is the anchor —
never infer the date from the conversation. Lifting sessions and rides are matched to a day by
Curtis's **local** date (an evening lift is "tomorrow" in UTC; the client handles this).

## The daily view

```python
view = h.daily()             # today
view = h.daily("2026-07-28") # any day
```

Returns one dict: `macros` (the day rollup — totals, estimation, the resolved target —
without the entry list), `weight` (`entry` for the day or None, plus `trend` — the rollup summary
as of that day), `lifting` (`sessions` started that local day, the current `goal`, and
`uninterpretedCount` across all days), `rides` (that day's activities, **all sports**, not just
cycling), and `gaps`.

How to speak it:
- **Lead with what happened**, not with what's missing. Gaps come last, gently.
- **Weight: the 7-day average (`trend.currentAvg`) is the truth** — a single day's weight is
  noise. Lead with the trend, mention the day's number second if at all.
- **Macros: totals against the day's resolved target.** One target applies to every day; macros
  no longer records whether a day was training or rest.
- Mention training (a lift, a ride) as part of the day's story — it's context for the eating,
  and vice versa, and since the day-type field was retired, `lifting`/`rides` are the only record
  that training happened at all.

## The weekly view

```python
view = h.weekly()             # the current Mon–Sun week
view = h.weekly("2026-07-21") # the week containing that date
```

Weeks are **Monday-start**, matching the rides weekly rollup — "this week" means the same thing
everywhere. Returns `weekStart`/`weekEnd`, `macros` (one `{date, totals, target}` per day —
empty days come back **zeroed, never missing**), `weight` (`days`: one series point per **elapsed** day with
`weight` null when unweighed, plus `trend`), `lifting`, `rides`, and `gaps` (computed over
**elapsed days only** — a week isn't missing its Friday on Tuesday).

Aggregate in plain terms as the question needs (days on/off target, total riding time, sessions
lifted). Don't manufacture a composite "week score".

## Units — how Curtis speaks

Stored units are each module's canon; Curtis speaks imperial. Convert on presentation:

| Data | Stored | Spoken |
|---|---|---|
| Macros | grams / kcal | as-is |
| Body weight | lb | as-is (trend in lb/week) |
| Lifting weights | **kg** | lb — `kg × 2.2046`, round to whole lb |
| Ride distance / climb / speed | m / m / m/s | mi (`m ÷ 1609.344`, 1 dp) / ft (`m × 3.2808`, whole) / mph (`× 2.2369`, 1 dp) |
| Durations | seconds | `h:mm:ss`, **truncated** not rounded |

## Going deeper — the sibling skills

This skill is the overview; the module skills are the depth and the **only write paths**. Reach
for them the moment the conversation narrows:

| When the conversation turns to… | Use |
|---|---|
| what he ate, logging food, correcting an entry, batches | **manage-macros** |
| logging a weigh-in, correcting one, the long trend | **manage-weight** |
| reading/interpreting a workout, a lift's progression, the goal | **manage-lifting** |
| a specific ride, naming/annotating one, the riding block | **manage-rides** |

If a gap prompts action ("want me to log it?"), the write happens through the sibling skill —
this client has no write methods at all.
