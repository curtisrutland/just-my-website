---
name: manage-garage
description: >-
  Curtis's bikes in justmy.website (the garage) and which bike each ride was on. Use whenever
  Curtis asks how many miles or hours are on a bike ("how many miles on the Checkpoint this
  month", "which bike did I ride most in October"), says which bike a ride was on ("Tuesday was
  the Roscoe"), asks what's untagged, or mentions a new, sold or renamed bike. Reads rides to tag
  them; never writes to the ride log.
---

# manage-garage

**Every ride on the right bike, and you can see why.** Each tag says how it was made: a profile
rule (`rule`, reason "GRAVEL"), Curtis (`manual`), or the initial load (`backfill`, with its
reason). A ride no rule matches is **untagged** — never guessed, by the server or by you.

## Requirements
- **No install needed.** `client.py` uses only the Python standard library.
- **Network egress:** the skill talks to **`https://justmy.website`** — that host must be reachable.
- **Dropped connections are retried for you.** A `jmw: retry …` line on stderr is that working. If
  a call still fails after three tries it raises `TransportError`: tell Curtis it didn't go through.

## Setup

```python
from client import GarageClient, m_to_mi, sec_to_hm
g = GarageClient()   # base URL + Curtis's agent token are baked in
```

## Units

Stored SI (meters, seconds). Curtis reads **miles at one decimal** and **hours as h:mm**. Use
`m_to_mi` and `sec_to_hm`; never quote raw meters or seconds.

## Mileage — the main question

```python
g.mileage()                                        # all time, every bike
g.mileage(from_="2026-10-01", to="2026-10-31")     # a window of local dates, inclusive
g.get_bike("checkpoint", from_="2026-11-01")       # one bike's raw totals ("checkpoint" resolves)
```

`mileage` returns `{"bikes": [{name, rides, miles, hours, lastRiddenOn}], "untagged": {rides, miles}}`.

**The honesty rule: totals count tagged rides only.** If the window has untagged rides, say so in
the same breath — "Neuron: 41.2 mi in October, plus 3 untagged rides (24.5 mi) that could be the
Neuron or the Roscoe." Never fold untagged miles into a bike, and never quote a bike's total as if
it were complete when rides in that window are untagged.

## Tagging rides

```python
g.untagged_rides()                                  # cycling rides on no bike, newest first
g.untagged_rides(from_="2026-10-01")
g.tag_ride(ride_id, "roscoe")                       # put it on a bike (moves it if tagged elsewhere)
g.untag_ride(ride_id)
g.tag_of(ride_id)                                   # its tag, or None
```

- **Tag only on Curtis's word.** "Tuesday's ride was the Roscoe" → find the ride (manage-rides'
  `list_rides` with a date window gives the id) and `tag_ride`. If a ride's name or note names a
  bike, you may *propose* it ("this one says 'on the Checkpoint' — tag it?"), but ask first.
- Working through untagged rides with Curtis: list them with date, profile, distance and any name or
  note, then tag the ones he identifies. Rides are identified by `id` (the rides module's id).
- A tag Curtis makes is `manual`, and rules never override it.

## Bikes and their rules

```python
g.list_bikes()                                      # active bikes; include_retired=True for all
g.create_bike("Santa Cruz", "Hightower", 2027, profiles=["ENDURO"])   # nickname defaults to the model
g.update_bike("neuron", name="The Neuron")
g.update_bike("neuron", profiles=["NEURON"])        # replaces the set; a profile names at most one bike
g.apply_rules()                                     # after a profile change: re-run every ride through the rules
g.update_bike("model c", retiredOn="2027-03-01")    # sold: its rules go, its rides stay
```

**Profile rules** match a ride's device profile (`sportProfileName`, e.g. `GRAVEL`, `BMX`, `Bike`)
case-insensitively. When Curtis sets up a new per-bike profile on his watch or Edge, add it to the
bike and run `apply_rules()` so older rides on that profile get tagged. Removing a profile removes
the rule tags it made; `manual` and `backfill` tags are never touched.

`create_bike` isn't retried on a dropped connection: if it raises `WriteOutcomeUnknown`, call
`list_bikes()` to see whether it landed before trying again.

## What this skill does NOT do

- **No ride edits.** Names, notes and the measured numbers belong to manage-rides.
- **No parts or service intervals yet.** Those are the garage's roadmap (`docs/garage-model.md`).
- **No guessing.** An untagged ride stays untagged until Curtis says which bike it was.

## Related skills

- **manage-rides** — the ride log itself: finding a ride by date, its name, note and numbers.
