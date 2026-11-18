# Infographics — playbook

One-off pictures made from Curtis's own data: some stills, some animated. Each one is designed in
a conversation (with Claude Code or claude.ai), then built, rendered on Curtis's Mac, and left
alone. This doc is the fixed process, toolkit and data path that every piece follows, so a
one-off stays cheap and the tenth piece is built the same way as the first.

**Status: PLAYBOOK — approved 2026-11-16 (epic #124, PR #125). The scaffold (#122) is built:
`infographics/` exists with one sample piece. No real piece has been made yet.**

It is **not** an interactive visualization builder, it is not part of the website, and it never
writes data.

---

## 1. Where it lives

`infographics/` at the repo root, with its own `package.json`. It stays in this repo for the same
reason `skills/`, `daemon/` and `ios/` do: it depends on the API contract, so the two get reviewed
together.

```
infographics/
  package.json              its own install: Remotion, React, d3. Nothing here ships to Vercel.
  remotion.config.ts        entry point, public dir, PNG frames, H.264, inlined fonts
  src/
    Root.tsx                registers every piece's compositions
    kit/                    the shared kit (§6): Stage, compose, theme, fonts, formats, units, map
    data/                   the data layer (§4): client, cache, FIT; api/ is generated
  scripts/                  the commands (§7): data, render, api-types
  pieces/
    2026-11-sample-ride/    the scaffold's own piece: the smallest working example to copy
    2026-11-phantom-riders/ one folder per piece, named YYYY-MM-slug
      brief.md              what was agreed (§3). Committed.
      data.ts               fetch and shape, then freeze the snapshot. Committed.
      data.json             the frozen snapshot. Gitignored.
      Piece.tsx             the composition(s). Committed.
  .cache/                   API responses and raw FIT files. Gitignored.
  out/                      rendered stills and videos, one folder per piece. Gitignored.
```

**It is a surface, not a module** (`CONVENTIONS.md` §1, §9). It is a read-only client of the token
API, like the skills. It never opens the database, never imports a module's `repo`, and makes no
`POST`, `PATCH` or `DELETE`.

**It is walled off from the site's build.** The root `tsconfig.json` and `vitest.config.ts`
exclude `infographics/`, and `.vercelignore` keeps it out of a deploy. It has its own
`npm run typecheck` and `npm test`. A broken piece can never fail a deploy.

---

## 2. The process for a piece

Every piece goes through the same seven steps, in order.

1. **Discuss.** Settle the one question the piece answers, who will see it, and which formats it
   needs (§6). This can happen in Claude Code or in claude.ai.
2. **Look at the data first.** Before any design, count what there is: how many rides, what date
   span, whether the thing the piece wants to show is actually in the numbers. A piece about
   progression is not worth designing if the data covers six weeks. Say what was found.
3. **Write `brief.md`** from the template (§3). **Curtis approves the brief before any
   composition code is written** — the same doc-before-code rule the modules follow.
4. **Write `data.ts` and freeze the snapshot** (§4).
5. **Build the composition** from the kit, previewing in Remotion Studio.
6. **Review.** Claude renders stills at the frames that matter (first, last, each beat in the
   timeline, the busiest frame) in every format the brief names, and looks at each one: text that
   overflows, labels that collide, anything unreadable at size. Then Curtis reviews in Studio or
   from a draft render.
7. **Final render.** Record the date, the command and the snapshot's date in the brief's
   *Rendered* section, and close the piece's issue.

**Each piece gets a GitHub issue** labelled `area:infographics`, opened when the discussion starts
and closed when the final render is recorded.

**A discussion in claude.ai ends in a `brief.md`.** claude.ai can read the data through the
`manage-*` skills, so it can do steps 1 to 3, but it cannot run the renderer. Curtis brings the
brief to Claude Code, which starts at step 4.

---

## 3. The brief

`pieces/<piece>/brief.md`, always these sections, in this order:

```markdown
# <Title>

## Question
One sentence: what the piece answers.

## Who sees it
Private, or shareable. If shareable: what must not appear (see "Location" in §4).

## Formats
Which of the fixed formats (§6), and for video the length and frame rate.

## Data
Modules and endpoints, the date window, the filters, and what the look-first step found
(counts, date span, gaps).

## Derived figures
Any number the piece computes that no module provides: its name on the piece and its exact
definition (§5). "None" is a fine answer.

## Design
The layout, and what encodes what: position, colour, size, motion. Every piece of text that
appears on it.

## Timeline
Video only. The beats, with times.

## Open questions

## Rendered
Filled in at the end: date, command, snapshot date.
```

---

## 4. Data

**One path, three steps: fetch, shape, freeze.**

- **Fetch** through the data layer's client only. It is typed from the generated OpenAPI spec:
  `npm run api:types` rebuilds the site's specs from its Zod schemas and turns them into
  TypeScript, so a field that changes in a module's schema breaks the piece at compile time, not
  in a picture. The client exposes `GET` and nothing else, and the `fetch` underneath refuses any
  other method.
- **Shape** in `data.ts`: filter, join, convert, and do any heavy computation once here.
- **Freeze** the result to `data.json`. A piece's `data.ts` default-exports a function that
  returns the snapshot, and the runner writes the file, so a piece cannot forget to. **A
  composition reads only the snapshot.** It makes no network call and reads no cache. The same
  snapshot renders the same frames next month, even after the underlying data has changed.

**Credentials.** The client reads `JMW_AGENT_TOKEN` from the repo's `.env.local`, the same source
`scripts/build-skills.mjs` uses. The agent token reads everything and is structurally unable to
hard-delete. The base URL defaults to production, because that is where the data is;
`JMW_BASE_URL` overrides it.

**Cache.** Responses are cached on disk under `.cache/` so that reworking `data.ts` does not
refetch every ride. A `--refresh` flag refetches. Raw FIT files are immutable (their key is the
file's hash), so they are fetched once.

**A window never includes today,** unless the brief says why it should. A day in progress has only
part of its food logged, its steps half counted and its rides perhaps not yet uploaded, and a
picture draws that as a shortfall. `data.ts` stops at the last complete day (`todayISO()` in
`src/lib/date.ts` is today in Curtis's timezone).

**Questionable data is asked about, never quietly used and never quietly dropped.** The first
such rule: a bike ride with a top speed over 30 mph is questionable, most likely because the
watch kept recording in a car, which also inflates that ride's distance, time and ascent.
`settleQuestionableRides` in `src/data/sanity.ts` stops the data step and lists any such ride that
has no recorded answer. Curtis's answer for each (include or exclude, and why) is written into
the piece's `data.ts`, and a piece that leaves rides out says so on the picture. New sanity rules
join that file as they are found.

**Use the coarsest data that answers the question.** The API's ride stream is downsampled to
10-second buckets (`docs/rides-model.md`), which is enough to decide which rides are in an area or
to draw an hour-long chart. Only a piece that animates position needs full resolution, and then
only for the rides it will draw.

**Full-resolution GPS** comes from the ride's raw FIT file (`GET /api/rides/{id}/fit`), decoded
with the site's own decoder: `decodeFitSamples` in `src/lib/rides/fit.ts` returns every record at
its own timestamp. There is no second decoder: the channel names and unit conversions are the
ones ingestion uses. `data.ts` gets it as `fit(rideId)`.

**Location.** The ride row carries no location, so "rides in an area" is worked out in `data.ts`
from the streams. GPS traces show where Curtis rides and where rides start. A piece marked
*shareable* in its brief trims or hides anything the brief says must not appear, and that
trimming happens in `data.ts`, so the sensitive points are never in the snapshot.

**Outside data** (a trail network, terrain) is allowed when a brief asks for it. It is fetched
once in `data.ts`, frozen into the snapshot like everything else, and credited on the piece as
its licence requires. **No live map tiles**: they load asynchronously, which makes frame-exact
rendering unreliable, and they would put a network call inside a render.

---

## 5. Numbers on a piece

The site's rule is that a number is never dressed as more than it is. Pieces keep it.

1. **Use the module's number when the module has one.** A ride's distance and moving time, a
   week's totals, the weight trend: these come from the API under their own definitions. A piece
   does not recompute them its own way.
2. **A piece may derive a figure no module provides,** because a one-off picture often needs one
   (climbing rate on a single climb, speed per heartbeat). The limits:
   - it is defined in the brief's *Derived figures* section, and labelled on the piece in words a
     reader can check;
   - it is never written back, and never added to the API from here;
   - if a second piece needs it, it moves into the kit, with a test;
   - if the *site* would ever show it, it moves to `src/lib/{module}` and is served by the API,
     and the piece reads it from there.
3. **Say what the picture covers.** Every piece states its date range and its count ("41 rides,
   3 Sep to 14 Nov 2026"), and says so when something is left out.
4. **Units follow each module,** exactly as the web UI shows the same quantity: rides in miles,
   feet and mph; body weight in pounds; food in grams and kcal. The kit holds the formatters, so
   no piece formats a unit by hand.

This is the one place the infographics surface differs from the iOS app, which renders what the
API returns and derives nothing. The difference is deliberate and is recorded in
`CONVENTIONS.md` §1.

---

## 6. The shared kit

Everything a second piece would otherwise copy from the first.

**Type and colour** are the site's. The three fonts are loaded from `src/app/fonts/` (Space
Grotesk for display, IBM Plex Sans for text, JetBrains Mono for numbers), not copied. The colour
roles are copied from `src/app/globals.css` into the kit's theme, with dark as the default and
light for print.

**Formats** are fixed. A piece picks from this list instead of inventing a size.

| Name | Size | For |
|---|---|---|
| `wide` | 1920 × 1080 | landscape video, a screen |
| `tall` | 1080 × 1920 | vertical video, a phone |
| `card` | 1080 × 1350 | a still that reads well on a phone |
| `square` | 1080 × 1080 | a still or a short loop |
| `poster` | 5400 × 7200 | print at 18 × 24 in, 300 dpi; composed at 1080 × 1440, rendered at 5× |

Video is H.264 MP4 at 30 frames per second unless the brief asks for 60.

**Helpers:** the unit formatters (§5), which are the web UI's own ride formatters re-exported so
they cannot drift; fitting a map projection to a set of traces; and drawing a trace to a canvas.
Heart-rate zone colours are not in the kit yet: the web UI defines none, so the first piece that
needs them brings them in.

**`Stage` is the root of every composition.** It holds the render until the fonts and the
piece's snapshot are loaded, then hands the snapshot to the piece. `pieceCompositions` registers
a piece's compositions, one per format.

**What goes in the kit:** only what a real second piece needs. The first piece may write a helper
inline; the second piece that wants it moves it into the kit.

---

## 7. Rendering

**Remotion** renders both stills and video. A piece is one or more React compositions; each draws
frame *N*. Remotion Studio previews a piece with a scrubbable timeline, and the CLI renders a PNG
or an MP4 from the same code.

**A composition is a pure function of the snapshot and the frame number.** That is what makes
frame-by-frame rendering correct and a re-render identical. So, inside a composition:

- no network calls, and no reading of anything but the snapshot;
- no clock and no unseeded randomness (`Date.now()`, `Math.random()`);
- nothing that animates on its own timer (CSS transitions and animations): motion is computed
  from the frame number;
- work that does not depend on the frame is done once, in `data.ts` or memoised, never per frame.

**Drawing.** d3 for scales, shapes and map projection. Canvas for dense marks (thousands of GPS
points); SVG and HTML for text and sparse marks.

**Commands,** run in `infographics/`. From a clean checkout, `npm ci` at the repo root and again
in `infographics/` come first.

| Step | Command |
|---|---|
| Regenerate the typed API surface | `npm run api:types` (once, and after any API change) |
| Fetch, shape, freeze a snapshot | `npm run data -- <piece>` (`--refresh` refetches) |
| Preview | `npm run studio` (http://localhost:3123) |
| Render a still | `npm run still -- <composition> [--frame N]` |
| Render a video | `npm run render -- <composition>` |
| Check the package | `npm run typecheck` and `npm test` |

Compositions are named `<slug>-<format>`, for example `phantom-riders-wide`. Output goes to
`out/<piece>/`. Flags after the composition pass through to Remotion; `--sequence` writes a
video's frames as PNGs.

**A new piece** is a folder under `pieces/` and one line in `src/Root.tsx`. The project skill
`.claude/skills/new-infographic` walks an agent through it; `pieces/2026-11-sample-ride/` is the
example to copy.

**Licence and telemetry** (checked 2026-11-16 on remotion.dev): Remotion is free for individuals
and for companies of up to three people. A command-line render reports usage to Remotion only when
a licence key is set, and none is set here. Remotion is pinned to exactly 4.0.544.

---

## 8. What is committed

| | Committed | Why |
|---|---|---|
| `brief.md`, `data.ts`, the composition, the kit | yes | They are the piece. |
| `data.json` snapshots | no | GPS traces and body data, and often tens of megabytes. |
| `.cache/` | no | A copy of API responses. |
| `out/` renders | no | Large binaries, regenerable from the snapshot. |

The cost of not committing snapshots: a snapshot exists only on the Mac that made it. If it is
lost, `npm run data` rebuilds it from the API, and the picture changes only where the underlying
data has changed since. A render Curtis wants to keep for good should be copied somewhere he
keeps things.

---

## 9. What this doc settles, and what it leaves

**Settled on approval:**

- the folder layout, and that snapshots, cache and renders are gitignored (§1, §8);
- the seven-step process, with the brief approved before composition code (§2);
- the brief template (§3);
- fetch, shape, freeze, with the agent token against production (§4);
- the rules for numbers, including that a piece may derive a labelled one-off figure (§5);
- the five formats and the 30 fps default (§6);
- the purity rules for a composition (§7).

**Decided by the scaffold (#122), with what was measured on 2026-11-16:**

- **Snapshot loading:** a static file served from the piece's own folder (`pieces/` is Remotion's
  public directory), not a static import, so a piece with no snapshot yet breaks only itself.
  Padding the sample's snapshot to 11.6 MB, about sixty rides of full-resolution GPS, added 0.1 s
  to a still and to a 180-frame video. A changed snapshot is picked up by the next render.
- **Repeatability:** the sample video rendered twice gave 180 frames with identical hashes, and
  the still gave the same file each time.
- **Poster:** 5400 × 7200 renders in one image, and canvas marks are drawn at the full 5× density.
- **Full resolution:** `decodeFitSamples` was added to `src/lib/rides/fit.ts`. For the sample
  ride it returns 4,125 samples where the stored stream has 1,038 buckets.
- **Fonts:** imported from `src/app/fonts/` and inlined into the bundle. Emitted as files they
  rendered but Studio did not serve them.
- **Versions:** Remotion 4.0.544 pinned exactly; React, TypeScript and tsx match the site's.

**Out of scope:** an interactive builder, anything served by the website, scheduled or automatic
rendering, and writes of any kind.
