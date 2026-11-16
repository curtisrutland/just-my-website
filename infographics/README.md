# infographics

One-off stills and animations rendered locally from the justmy.website token API. It is read-only
and never ships to Vercel. The process, the rules and the reasons are in
[`docs/infographics.md`](../docs/infographics.md); read that first.

## Setup, from a clean checkout

```bash
npm ci                 # at the repo root: the FIT decoder and the OpenAPI build live there
cd infographics
npm ci
npm run api:types      # typed API surface, generated from the site's Zod schemas
```

The first render downloads Remotion's headless browser (about 140 MB), once.

The data commands read `JMW_AGENT_TOKEN` from the repo's `.env.local` and talk to production
unless `JMW_BASE_URL` is set.

## The sample piece

```bash
npm run data -- sample-ride            # fetch, shape, freeze pieces/2026-11-sample-ride/data.json
npm run studio                         # preview at http://localhost:3123
npm run still -- sample-ride-card      # out/2026-11-sample-ride/sample-ride-card.png
npm run render -- sample-ride-wide     # out/2026-11-sample-ride/sample-ride-wide.mp4
npm run still -- sample-ride-poster    # 5400 × 7200
```

## Checks

```bash
npm run typecheck
npm test
```
