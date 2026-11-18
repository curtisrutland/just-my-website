# On the bike

**Status: RENDERED 2026-11-16. Approved by Curtis.**

## Question

How much have I ridden since the first logged ride, on what kind of bike, and how hard was it?

## Who sees it

Not decided. It shows heart rates, distances and dates. It shows no location and no body weight,
so nothing would need redacting to share it.

## Formats

- `poster`, still: portrait, print-ready at 18 × 24 in (5400 × 7200). Built.
- `wide`, still, for a screen: proposed as optional, not built.

No animation.

## Data

- **Modules:** rides, garage.
- **Endpoints:** `GET /api/rides` (cycling) for each ride's facts and its time-in-heart-rate-zone
  histogram, `GET /api/garage/rides` and `GET /api/garage/bikes` for the bike on each ride.
- **Window:** the first ride to the last complete day, never today. As rendered, 28 Jul to
  15 Nov 2026: 16 Monday-to-Sunday weeks.
- **Ride type** comes from the bike: Neuron 6 and Roscoe 8 are MTB, Checkpoint ALR4 is
  Gravel/Road, Model C is BMX. The garage has no "type" field, so this mapping lives in `data.ts`.

**Two rides are left out.** The sanity rule (playbook §4) flags any ride with a top speed over
30 mph, and two were flagged: 26 Sep on the Roscoe 8 (51.3 mph) and 7 Nov on the Model C
(45.4 mph). Curtis confirmed that on both he drove away from the park with the watch still
recording, and chose to leave both out of this piece. His answer is recorded in `data.ts`, and the
piece says so in its small print. The next fastest ride is 26.6 mph, on the Checkpoint.

**As rendered: 61 rides on 54 days,** 76.3 h riding, 508.7 mi, 24,931 ft climbed, 30.0 h at zone 4
or above. Every ride has a bike, a heart rate and a zone histogram.

| Type | Rides | Hours | Miles | Ascent | At zone 4 or above |
|---|---|---|---|---|---|
| MTB | 38 | 53.2 | 316.2 | 17,694 ft | 27.2 h, 51% |
| Gravel/Road | 22 | 20.2 | 183.1 | 6,575 ft | 2.3 h, 11% |
| BMX | 1 | 2.9 | 9.4 | 663 ft | 0.5 h, 16% |

- **The zones tell the story the miles don't.** Gravel and road are 36% of the miles but 8% of
  the hard time. Half of every MTB hour was at zone 4 or above.
- **Rhythm:** every one of the 16 weeks has riding, from 2.7 h to 8.4 h. The biggest week began
  12 Oct: 5 rides, 8.4 h, 73.3 mi.
- **Records:** longest ride 27.3 mi (Checkpoint, 18 Oct); longest time riding 3:52:12 (Neuron,
  1 Aug); most climbing 866 ft (Neuron, 15 Sep).
- **BMX is one ride** once the 7 Nov ride is out. The piece draws it at its true size, which is
  small.

**What the data cannot support, and is not shown:**

- **Top speed.** With the two drives out it would be 26.6 mph, a road descent, which says little
  about the riding this piece is about.
- **Calories.** Every ride has a figure, but it is the device's estimate, not a measurement.
- **Power and cadence.** No ride has either.
- **Temperature.** Only the rides recorded on the Edge have it.

## Derived figures

- **Ride type:** the bike-to-type mapping above.
- **Time at zone 4 or above:** the sum of each ride's time in zone 4, zone 5 and above its max
  setting, as that ride's own histogram defines them. The watch sets zones as a share of max heart
  rate, and its max setting moved between 176 and 180 over the window, so zone 4 began at 141 to
  144 bpm depending on the ride. The piece says this in its small print.
- **Zone 5** on the piece includes the time above the max setting (a few minutes in all).
- **Totals by type, by bike and by week:** sums of the rides' own distance, moving time and
  ascent. Hours read to one decimal, as the garage page shows a bike's hours.
- **Records:** the single largest of each fact.

Zone times are the device's measurement of time, kept by the rides module because they are a
histogram and not a score. The piece adds no effort or fitness score.

## Design

One page, read top to bottom. Colour means ride type throughout: MTB blue, Gravel/Road yellow, BMX
magenta, each the colour its bike has in "The descent".

1. **Title and range:** the dates, "16 weeks", "On the bike", "61 rides on 54 days".
2. **Four headline numbers:** hours riding, miles, feet climbed, hours at zone 4+.
3. **By kind of bike.** One row per type. On the left: the type, its rides, miles and ascent, and
   its bikes with their ride counts. On the right: its hours, the share of them at zone 4 or
   above, and one bar. The bar's length is hours, on a scale the three rows share, so BMX is a
   stub. The bar is cut into six heart-rate zones in steps of the type's own colour, dim for easy
   and bright for hard: one hue, as the site draws its zone bar, never a green-to-red gauge. A
   legend names the six steps.
4. **Sixteen weeks.** One bar per week of hours ridden, stacked by type. The biggest week is
   named ("BIGGEST WEEK 8.4 h · 5 rides · 73.3 mi") and tied to its bar by a short line. Curtis
   caught the first draft's label floating with nothing to say what it was.
5. **Every ride, in order.** 61 marks, coloured by type, each as tall as that ride's share of time
   at zone 4 or above, against lines at half and all.
6. **Records,** three of them.
7. **The small print:** the two rides left out and why, that top speed and calories are not
   shown, how the zones are defined, and "justmy.website".

## Decisions

1. **The two rides with a drive in them:** left out of this piece (Curtis, 2026-11-16). The weight
   piece keeps them: it shows no speed, and he judged the few driven miles harmless there.

Built as proposed and approved with the render:

2. **Calories:** left off.
3. **Title:** "On the bike".
4. **Formats:** the `poster` alone. A `wide` version for a screen is not built.

## Rendered

**2026-11-16**, from the snapshot frozen that day (2026-11-16T22:14:08.202Z, read from
https://justmy.website), covering Jul 28 to Nov 15, 2026.

```bash
npm run data -- on-the-bike --refresh
npm run still -- on-the-bike-poster    # out/2026-11-on-the-bike/on-the-bike-poster.png, 5400 × 7200
```

Curtis reviewed the draft, asked for the biggest-week label to be made clear, and approved the
result the same day.

The same two commands bring the piece up to date on a later day. A new ride over 30 mph will stop
the data step until Curtis has been asked about it and his answer is added to `data.ts`.
