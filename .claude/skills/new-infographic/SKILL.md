---
name: new-infographic
description: >-
  Build a one-off infographic (a still or an animation) from Curtis's justmy.website data, in
  infographics/. Use when Curtis wants to make, design, change or re-render an infographic or a
  "piece", or brings a brief.md written in claude.ai. Follows docs/infographics.md.
---

# new-infographic

`docs/infographics.md` is the playbook and it is binding. Read it before the first piece of a
session. This skill is the short form: the order of work and the files to touch.

`infographics/pieces/2026-11-sample-ride/` is the smallest working piece. Copy its shape.

## The order of work

Do these in order. Do not write composition code before step 3 is approved.

1. **Discuss.** Settle the one question the piece answers, who sees it (private or shareable),
   and which formats it needs.
2. **Look at the data first.** Count what there is before designing: how many rides, what date
   span, whether the thing the piece wants to show is in the numbers. Tell Curtis what you found,
   including when the data cannot show what he hoped.
3. **Write `brief.md`** from the template in the playbook (§3), in a new folder
   `infographics/pieces/YYYY-MM-<slug>/`. **Curtis approves it before any composition code.**
   Open a GitHub issue for the piece, labelled `area:infographics`.
4. **Write `data.ts`** and freeze the snapshot: `npm run data -- <slug>`.
5. **Build `Piece.tsx`** and register it in `src/Root.tsx`. Preview with `npm run studio`.
6. **Review your own frames.** Render stills at the first frame, the last, each beat in the
   timeline and the busiest frame, in every format the brief names, and look at each: text that
   overflows, labels that collide, anything unreadable at size. Then hand it to Curtis.
7. **Final render.** Fill in the brief's *Rendered* section and close the issue.

## The three files

**`data.ts`** runs in Node. It default-exports a `PieceData<Snapshot>` and exports the `Snapshot`
type. It receives `{ api, fit, log }`:

- `api.<module>.GET(path, { params })` is typed from the OpenAPI spec; wrap it in `unwrap(...)`,
  and use `all(...)` for a paginated list. It can only read.
- `fit(rideId)` returns a ride's full-resolution samples. Use it only for rides the piece will
  draw at full resolution. The 10 s stream on the ride detail (`?streams=1`) answers most
  questions, including which rides are in an area.
- Do the heavy work here, once. Trim anything the brief says must not appear (ride starts near
  home on a shareable piece) here, so it never reaches the snapshot.
- A piece that totals or ranks rides passes them through `settleQuestionableRides`
  (`src/data/sanity.ts`). It stops on any ride with a top speed over 30 mph that has no recorded
  answer. Ask Curtis about each one; record his answer and the reason in `data.ts`. Never decide
  for him, and never drop a ride silently.

**`Piece.tsx`** runs in the browser. Its root is `<Stage<Snapshot> piece="YYYY-MM-<slug>">`, which
loads the fonts and the snapshot and then calls its child with the data. Export the result of
`pieceCompositions({ slug, component, variants })`: a variant with `seconds` is a video, without
is a still. Import only from `src/kit/`, never from `src/data/` (import the `Snapshot` type with
`import type`).

**`brief.md`** is what was agreed. Keep it true: if the design changes, change the brief.

## Rules a composition must keep

A composition is a pure function of the snapshot and the frame number.

- No network calls; nothing read but the snapshot.
- No `Date.now()` and no `Math.random()`.
- No CSS transitions or animations. Compute motion from `useCurrentFrame()`.
- Work that does not depend on the frame goes in `data.ts` or a `useMemo`, never in the per-frame path.
- Draw dense marks on a canvas scaled by `window.devicePixelRatio` (a poster renders at 5×).

## Numbers and units

- Use the module's number when the module has one. Do not recompute a distance, a weekly total
  or the weight trend your own way.
- A figure no module provides is allowed for one piece: define it in the brief's *Derived
  figures* and label it on the piece. Never write it back.
- Format every quantity with `src/kit/units.ts`. If a module's formatter is missing, re-export
  it from that module's own UI code; do not write a new one.
- Every piece states its date range and its count.

## Commands (in `infographics/`)

```bash
npm run api:types                      # once, and after any API change
npm run data -- <slug> [--refresh]     # fetch, shape, freeze pieces/<piece>/data.json
npm run studio                         # preview at http://localhost:3123
npm run still -- <slug>-<format> [--frame N]
npm run render -- <slug>-<format>
npm run typecheck && npm test
```

Formats: `wide`, `tall`, `card`, `square`, `poster`. Renders land in `out/<piece>/`. Snapshots,
the cache and renders are gitignored; commit the brief, `data.ts`, `Piece.tsx` and any kit change.

The API base URL is production unless `JMW_BASE_URL` is set (for example
`JMW_BASE_URL=http://localhost:3000` while a new route is only local).

## The kit

Add to `src/kit/` only what a second piece needs. The first piece that wants a helper writes it
inline; the second moves it into the kit, with a test if it is logic.
