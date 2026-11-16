# The descent

**Status: RENDERED 2026-11-16 — the private version. Approved by Curtis.**

## Question

What did the last 135 days look like: the weight coming down, and the daily work that went with it?

## Who sees it

**Private.** Curtis shares it himself with people he is comfortable seeing the real numbers, so
absolute pounds are shown. A redacted version (the change alone) may follow as its own variant;
it is not part of this one.

## Formats

- `wide`, video, 26 s at 30 fps.
- `card`, still: the finished picture.

## Data

- **Modules:** weight, macros, rides, garage.
- **Endpoints:** `GET /api/weight/rollup` (the per-day series: raw weigh-in and the module's
  7-day average, plus its trend per week), `GET /api/macros/range` (each day's totals and
  target), `GET /api/rides` (cycling), `GET /api/garage/rides` and `GET /api/garage/bikes` (the
  bike on each ride).
- **Window:** 5 Jul to 16 Nov 2026, the first weigh-in to the day the snapshot is frozen.

**What the look-first step found (2026-11-16):**

- **135 days, 135 weigh-ins, 135 days of food logged.** No day is missing from either.
- **Weight.** The module's 7-day average is 285.1 lb on 11 Jul (its first full week) and 238.8 lb
  on 16 Nov: **down 46.3 lb**. The first weigh-in was 288.0 lb. The module's own trend figure is
  −2.5 lb a week.
- **It is steady.** The average rose on only 14 of 134 days. The longest stretch without a new
  low is 7 days (26 Aug to 1 Sep). Week by week the average fell in 18 of 19 weeks.
- **Food.** Median 2,300 kcal a day (range 1,146 to 3,204). At or under the day's calorie target
  on 89 of 135 days. Protein at or over the 160 g target on 123 of 135 days. The calorie target
  itself varies by day (2,300, 2,600 or 2,800).
- **Rides.** 63 rides on 55 of the 135 days, starting 28 Jul: 519 mi on four bikes.
- **Lifting.** 15 sessions inside the window, the last on 28 Sep. Left off the piece: a row that
  stops in September would read as a statement the log can't back.

## Derived figures

- **Pounds down:** the weight module's 7-day average on 16 Nov minus its 7-day average on 11 Jul,
  the first day that average covers a full week. Labelled "7-day average, 11 Jul to 16 Nov".
- **Days on target:** a count of days whose logged calories were at or under that day's target,
  and the same for protein at or over. Both sides of each comparison are the macros module's own.

Nothing else is computed. The 7-day average and the trend per week are the weight module's.

## Design

Three bands share one time axis, Jul 5 on the left and Nov 16 on the right, with a dotted guide at
each month's start.

**The header.** Left: the date range, the day count and the title. Right (under the title on the
card): the headline. In the video it counts pounds down since Jul 11, with the date and that day's
7-day average above it; it is blank for the first six days, before a full-week average exists.

**1. Weight (top, the tallest band).** The 7-day average drawn the way the site draws a ride's
elevation: an accent line with the area beneath it filled, falling left to right. Each raw
weigh-in is a faint dot around it. Gridlines every 10 lb. The first weigh-in is named once
("288.0 first weigh-in"). In the video a rider's dot travels down the line; at the end the line's
last value is labelled ("238.8 lb") and the module's trend per week joins the band's label.

**2. Food (middle band).** One thin bar per day, measured from that day's calorie target: below
the line when under, above when over. Under is grey and over is bright; position carries the
meaning, so no status colour is used. Beneath, one square per day: full when protein met its
target, a small dot when it did not.

**3. Rides (bottom band).** One cell per day. A day with a ride is filled in that bike's colour;
a day with two rides is split. Four bikes, four colours, with a legend that gives each bike's
ride count. Days before Jul 28 are empty, which is true.

**The totals (end of the video, and on the still):** 135 days · 135 weigh-ins · 135 days of food
logged · at or under the calorie target on 89 · protein target met on 123 · 63 rides · 519.0 mi.

**Text on the piece:** the title, the date range, the lb and kcal axis labels, the headline and
its label ("7-day average, Jul 11 → Nov 16"), the band labels, the bike legend, the totals, and
"justmy.website". Dates read as the site writes them ("Jul 11").

## Timeline

- 0:00–0:02: title and empty axes.
- 0:02–0:20: the three bands draw together, left to right, at 7.5 days a second.
- 0:20–0:26: the totals and the headline fade in over 0.8 s and hold.

## Decisions

Settled when the brief was approved:

1. **Who sees it:** private, absolute pounds shown.
2. **The headline:** −46.3 lb, between two 7-day averages. Not −48.2 lb from the first weigh-in
   to the latest, which compares two single weigh-ins.
3. **The title:** "The descent".
4. **Lifting:** left off.

## Rendered

**2026-11-16**, from the snapshot frozen that day (2026-11-16T21:33:42.128Z, read from
https://justmy.website), covering Jul 5 to Nov 16, 2026.

```bash
npm run data -- the-descent
npm run render -- the-descent-wide     # out/2026-11-the-descent/the-descent-wide.mp4, 26 s
npm run still -- the-descent-card      # out/2026-11-the-descent/the-descent-card.png
```

Curtis reviewed both and approved them the same day.

The window ends at the latest weigh-in, so `npm run data -- the-descent --refresh` followed by the
two render commands brings the piece up to date. The headline, the totals and the axes follow the
data; a much longer window would want the layout looked at again.

A redacted variant (the change alone, no absolute pounds) is not built.
