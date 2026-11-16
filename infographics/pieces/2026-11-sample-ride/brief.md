# Sample ride

The scaffold's own piece (#122). It exists to prove the pipeline end to end, and as the smallest
working example to copy from. It is not a finished infographic.

## Question

Does the pipeline work: can one ride's full-resolution GPS be fetched, frozen, drawn, and rendered
as a still and as a video that come out the same every time?

## Who sees it

Private. The whole trace is drawn, including where the ride starts.

## Formats

- `wide`, video, 6 s at 30 fps: the trace draws itself.
- `card`, still: the finished trace.
- `poster`, still: the same layout at print size, to prove the 5× render.

## Data

- **Module:** rides.
- **Endpoints:** `GET /api/rides` (cycling, newest first), `GET /api/rides/{id}?streams=1` to find
  the newest ride with GPS, then `GET /api/rides/{id}/fit` for that one ride.
- **Window and filters:** the single newest cycling ride that has a position.
- **Shaping:** samples without a position are dropped; distance is carried forward over gaps.

## Derived figures

- **Elapsed** (video only): the time since the ride started at the moment shown, pauses included.
  It is each sample's own timestamp, read off the file.

Distance, moving time and ascent are the ride's own numbers from the API.

## Design

- **Header:** "SAMPLE PIECE", the ride's title as the site shows it, and its date.
- **Map:** the trace alone, no basemap, north up, fitted to the frame. In the video the ridden
  part is the accent colour over a dim full trace, with a dot at the rider.
- **Footer:** distance (mi), moving time, ascent (ft), and a line saying what the picture covers:
  one ride, and how many GPS points.

## Timeline

- 0:00 to 0:06: the dot travels the whole ride at a constant multiple of real time, so stops show
  as pauses.

## Open questions

None.

## Rendered

Not kept. Re-rendered whenever the scaffold is checked.
