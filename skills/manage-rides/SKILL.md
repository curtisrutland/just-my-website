---
name: manage-rides
description: >-
  Read and discuss Curtis's Garmin rides in justmy.website (the ride log — MTB, road, any
  activity his watch captures). Use whenever Curtis asks about a ride ("how was Monday's ride"),
  his week of riding, wants a ride named or annotated, or mentions something worth noting about
  a ride. Read + annotate only: the measured numbers are the device's facts and are read-only;
  files are uploaded elsewhere (web page now, a daemon later), never by this skill.
---

# manage-rides

**The log is the value.** This module is a calm chronological record of what Curtis actually
rode — the meter's numbers, honestly presented. It deliberately computes **no fitness scores, no
training load, no freshness** — and neither do you. Describe rides in terms of what was measured
(time, distance, climbing, heart rate, power when a meter exists); never invent a score, a
streak, or a "training status".

## Requirements
- **No install needed.** `client.py` uses only the Python standard library.
- **Network egress:** the skill talks to **`https://justmy.website`** — that host must be reachable.

## Setup

```python
from client import RidesClient, m_to_mi, m_to_ft, mps_to_mph, sec_to_hms
r = RidesClient()   # base URL + Curtis's agent token are baked in
```

## Units — stored SI, spoken imperial (the rule)

Every stored quantity is SI (meters, seconds, m/s, watts, bpm, kcal). **Curtis reads imperial**:
miles at one decimal, whole feet, mph at one decimal, `h:mm:ss`. The converters do the rounding:

```python
ride = r.list_rides()["items"][0]
f'{m_to_mi(ride["distanceMeters"])} mi'        # "3.8 mi"
f'{m_to_ft(ride["totalAscentMeters"])} ft'     # "289 ft"
f'{mps_to_mph(ride["avgSpeedMps"])} mph'       # "5.2 mph"
sec_to_hms(ride["movingSeconds"])              # "43:41"
```

Never surface a raw meter/m-per-second value or an unrounded float. HR is whole bpm, calories
whole kcal, power whole watts — those come whole already.

## Reading the log

```python
r.list_rides()                                   # rides (sport="cycling"), newest first
r.list_rides(sport=None)                         # every activity — runs, hikes, whatever
r.list_rides(from_="2026-07-01", to="2026-07-31")  # a local-calendar window
r.list_rides(q="MTB")                            # name OR device profile name
r.get_ride(ride_id)                              # one ride, full summary
r.weekly()                                       # per-ISO-week rollup, newest first
```

Three honesty rules baked into the data:

1. **Names are usually None.** The display fallback is `sportProfileName` + `localDate` —
   "MTB — Jul 28". Never render a raw timestamp as a title.
2. **`localDate` is the date.** A 7:46 PM ride is stored with a UTC `startedAt` on the *next*
   day. `localDate` comes from the device's own clock; always use it for "when".
3. **Absent sensors are None, and that's normal.** A watch ride has no power/cadence; a trainer
   ride has no distance/GPS. Say what was measured; don't treat a None as a gap to apologize for.

## HR zones — a histogram, not a score

`timeInHrZone` is the device's seconds-per-zone histogram **with the bpm boundaries it was
computed against** (`hrZoneHighBoundary`). It's self-describing, so describe effort by bpm range:
"13:30 in 143–161 and 7:35 above" — never as a training-effect number or an invented intensity
score. (Garmin's training-load metrics exist in the raw file and are deliberately not in this
API.) Note the boundaries are the watch's config at ride time — a new watch auto-refines them
over its first weeks, and old rides honestly keep the boundaries they were scored with.

## The human layer — your only write

```python
r.update_ride(ride_id, name="Big climb loop")
r.update_ride(ride_id, note="Legs felt dead early. Ran out of water on the back side.")
r.update_ride(ride_id, name=None)                # clear
```

When Curtis says something about a ride worth keeping — how it felt, what broke, a route name —
write it to `note` in his words. `name` is for when a ride earns one ("that's the big climb
loop"). **Everything else is immutable**: `update_ride` raises on any other field, by design. A
wrong measured number means the file gets reprocessed server-side — flag it to Curtis, don't try
to edit around it.

## What this skill does NOT do

- **No uploads.** FIT files arrive via the web page (today) or Curtis's daemon (later). If
  Curtis hands you a FIT file in a conversation, tell him to drop it on the rides page.
- **No manual rides.** There is no create path; an unrecorded ride stays unrecorded.
- **No deletes beyond soft.** `soft_delete(ride_id)` for a bad upload; hard deletion is
  Curtis's key only.
- **No fitness commentary beyond the numbers.** The module refuses scores; so do you.
