---
name: manage-vitals
description: >-
  Read Curtis's daily body measurements in justmy.website (sleep, resting heart rate, HRV, blood
  oxygen, respiration, steps — collected off his Garmin watch). Use whenever Curtis asks how he
  slept, how his resting heart rate or HRV is trending, whether he's recovering, or wants daily
  health context alongside training or eating. Read-only: these numbers come off a wrist, and this
  skill deliberately cannot write them.
---

# manage-vitals

Curtis's daily measurements, pushed in by a Garmin daemon on his own hardware. The signature:
**measurements, not verdicts.**

## The one thing to understand first

Garmin's watch produces two very different kinds of number, and this module keeps only one of them.

**Measurements** — what a sensor actually recorded: sleep duration, resting heart rate, HRV in
milliseconds, blood oxygen, respiration rate, steps, floors. These are here.

**Verdicts** — what Garmin's models *decided*: training readiness, Body Battery, stress level,
VO2max, FTP, race predictions, fitness age, sleep score. **These are not here, and that is
deliberate.** On Curtis's account they were also demonstrably junk: VO2max never populates (it needs
running or road cycling; he rides MTB), and the API returned two contradictory FTP figures — 352 W
and 565 W — one of them openly derived from his body weight, for a bike with no power meter.

So: **never reconstruct a readiness score, a recovery grade, or a "you should train hard today"
verdict from these numbers.** Report what was measured and how it's trending. If Curtis wants a
judgment, he'll make it — and he has more context than the numbers do.

## Setup

```python
from client import VitalsClient, hm
v = VitalsClient()   # base URL + Curtis's agent token are baked in
```

## The main read

```python
s = v.summary(window=30)     # open with this when asked "how am I doing"
s["restingHeartRate"]        # {"current", "currentAvg", "deltaPerWeek", "series"}
s["hrvLastNightMs"]
s["sleepTotalSeconds"]
s["gaps"]
```

**Lead with `currentAvg` and `deltaPerWeek`, not `current`.** A single night's HRV or a single
morning's resting HR is noise — the same lesson the weight module encodes by leading with the
rolling average. A one-day move is not a trend and should not be reported as one.

`deltaPerWeek` compares this week's 7-day average to last week's. State it plainly and without a
verdict: "resting HR is averaging 46, down about a beat from last week" — **not** "your recovery is
improving."

## Reading days

```python
days = v.list_days(limit=14)["items"]
day = v.get_day("2026-08-24")
```

**`None` means NOT MEASURED — never render it as 0.** The watch comes off, a night goes
unrecorded, a device doesn't sync. "No sleep data for Tuesday" is the honest sentence; "0 hours of
sleep" is a lie the data never told.

Durations are **seconds** (`hm()` renders "6h 16m"), HRV is **milliseconds**, SpO₂ is a percent,
respiration is breaths/min.

### Sleep stages need a caveat when you cite them

`sleepDeepSeconds` / `sleepRemSeconds` / `sleepLightSeconds` / `sleepAwakeSeconds` are **Garmin's
classification** of the night from movement and heart rate — not a direct measurement, and worth
naming as such when you quote them ("Garmin scored it as 54 min of deep"). They're kept because
they're self-describing durations; Garmin's *grading* of the night is not stored at all. The stages
may not sum exactly to `sleepTotalSeconds` — that's Garmin's inconsistency, preserved rather than
smoothed over, so don't "fix" it in prose.

## Gaps are facts, not failures

`summary()["gaps"]` distinguishes `"no_row"` (nothing was ever pushed for that day) from
`"no_measurements"` (a record exists but nothing was recorded). Report either as a plain observation.
Never frame a gap as a lapse, a broken streak, or a compliance percentage — Curtis is not being
graded on wearing a watch.

## Corrections

There is **no way to edit a measurement**, on purpose. If a day looks wrong:

```python
v.reprocess("2026-08-24")   # re-derive the day from the stored raw Garmin payload
v.soft_delete("2026-08-24") # a genuinely junk day; the daemon can re-push it
```

`reprocess` is for when the parser has been fixed — not for changing a number you don't like.

## The other health skills

A day's measurements don't mean much alone. Context usually lives in the siblings:

- **manage-lifting / manage-rides** — training load. A hard ride or a heavy session is the obvious
  reason last night's HRV dropped or resting HR sat high; check before reading anything into it.
- **manage-macros / manage-weight** — fuelling and body weight. A sustained deficit shows up in
  resting HR and sleep.
- **manage-health** — the unified daily/weekly view; the fastest way to see training, eating,
  weight and vitals for a week at once.
