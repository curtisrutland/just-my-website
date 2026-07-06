# Module runbook — how we add a module to justmy.website

The repeatable process for creating a new module, and the **interview Claude runs with Curtis**
before any code. We've built three modules (macros, weight, shopping); the shape below is the
distilled process. This is module-*agnostic* — the per-module specifics live in
`docs/{module}-model.md`. The binding rules are in `docs/CONVENTIONS.md`; this doc is the *workflow*
around them.

**Golden rule:** no schema, no table, no route until the **model doc** exists and Curtis has
approved it. We scope on paper first. Code is downstream of the model doc, which is downstream of the
interview.

---

## Phase 0 — The scoping interview (Claude asks, Curtis decides)

Every module we've built came down to the same handful of forks. Run these as an interview — a few
at a time, with a recommendation attached, not an open-ended survey. Each question is grounded in how
the three existing modules actually differ, so use them as the worked examples.

1. **The one honest idea (the signature).** Every module embodies a single principle its UI makes you
   *feel*. Macros: *honest about estimation fuzziness* (never shows an estimate as measured). Weight:
   *a day is noise, the trend is truth* (leads with the rolling average). Shopping: *a calm working
   utility, not a dashboard* (no hero, no score). **Ask: what's the one idea this module must make
   you feel — and does it even have a hero, or is it a plain utility?**

2. **Data shape — and the anti-scope.** What entities and fields? Just as important: **what do we
   deliberately NOT model?** Shopping's scope was defined as much by its noes (no quantity column, no
   item normalization, no spend/trend, no nesting) as its yeses. Pin the noes down explicitly — they
   prevent scope creep and shape the schema (e.g. "don't normalize" → no second table, no unique
   index).

3. **Stored vs derived.** What is computed in the repo and *never stored* (weight's 7-day rolling
   average; the macro day-rollup)? Default to deriving anything reproducible so it can't drift.

4. **Entry lifecycle & uniqueness.** Which pattern?
   - *Append-heavy immutable log* (macro entries — the source of truth for what happened).
   - *One-live-per-day upsert* (weight — a partial-unique index on the date; re-logging replaces).
   - *Status transitions* (shopping — `needed → bought`, plus a recency window on history).
   And: soft-delete semantics, and how much history the view retains (shopping filters bought items
   to the last 7 days; nothing is purged).

5. **Write path / surface interactivity — the biggest fork.** Which surfaces write? The module
   pattern *allows a different level per module*:
   - *Claude-adds / web-corrects* ("Option A" — macros: adding is Claude's skill; the web only
     corrects/deletes).
   - *Both surfaces write* (weight — one number, so the web has an entry form too).
   - *Web-primary full editor* (shopping — add/check/edit/delete are all web actions; Claude also
     manages via skill).
   Always the same rule underneath: every write, either surface, goes `schema.parse() → repo`.

6. **Does Claude manage it via a skill?** If yes, what are the marquee actions (macros: log/correct;
   shopping: batch-add "ingredients for X")? The skill is Python-stdlib over the token API, token
   injected at build. Can land after the web + API (see the backlog for `manage-*` skills).

7. **Deferred / out-of-scope.** Capture everything punted, with the reason, so it lands in the model
   doc's "Open / deferred" section and the backlog — not lost.

**Deliverable of Phase 0:** enough answers to write the model doc. Confirm the deliverable with
Curtis (model doc only? + design brief? just talk it through first?).

---

## Phase 1 — Write the model doc (`docs/{module}-model.md`)

The single approved spec. Use `docs/weight-model.md` or `docs/shopping-model.md` as the template.
Sections: intro (which conventions apply, how this module differs), the table(s) + indexes (+ the
*why* for each non-obvious decision), the view/derived model, surfaces (web / token API / skill),
API route layout, the Zod schema, the repo surface, a UI component inventory, mock data, and
**Open / deferred**. End with the **build checklist** (copy the definition of done from
`CONVENTIONS §8`, made concrete for this module).

**Curtis approves the model doc before any code.** If Claude thinks a decision is wrong, flag it —
don't silently change an approved spec.

---

## Phase 2 — (Optional) design brief (`docs/{module}-design-brief.md`)

Only if the module has UI worth a Claude Design handoff. Template: `docs/weight-design-brief.md` or
`docs/shopping-design-brief.md`. Reuse the existing design system — same tokens, mono numbers,
`AppShell` chrome; don't invent a new aesthetic. State the one signature idea and where to spend
boldness (or, for a plain utility, where to spend restraint).

---

## Phase 3 — Build, in order

Following the module anatomy (`CONVENTIONS §8`) and the macro build order in `HANDOFF-CODE.md`:

1. `src/lib/{module}/schema.ts` — Zod + normalization (single source of truth).
2. Tables in `src/lib/db/schema.ts` + a Drizzle **migration**.
3. `src/lib/{module}/repo.ts` — the only place the tables are touched; reads exclude soft-deleted.
   Includes any rollup/derived query.
4. `src/lib/{module}/types.ts` — domain + response-contract types (shared by repo AND UI).
5. `src/app/api/{module}/**` — thin token routes: authenticate → `schema.parse` → repo. Hard DELETE
   requires the primary key.
6. `src/app/(app)/{module}/**` + `src/components/{module}/**` — Clerk-gated UI. Server components
   read via repo; server actions write via `schema.parse → repo`. **The UI never calls the API.**
7. Flip the nav chip (`AppShell.tsx`) + landing card (`Landing.tsx`) from `SOON` to LIVE.

---

## Phase 4 — Definition of done (the easily-skipped wiring)

Per `CONVENTIONS §8` — **nothing auto-generates these, so they must be explicit tasks:**

- **OpenAPI:** register in `scripts/build-openapi.ts` (import the Zod schemas → build `{module}Spec`
  → add `["{module}", {module}Spec]` to `fragments`), run `npm run openapi:build`, confirm
  `openapi/{module}.json` appears. (The weight fragment was missed exactly here once.)
- **Docs:** model doc committed, README module list updated, the live-modules table in
  `docs/ARCHITECTURE.md` updated, `docs/BACKLOG.md` updated.

---

## Phase 5 — Verify, deploy, record

- Verify end-to-end (drive the real flow — API smoke checks + the web UI), not just typecheck.
- Deploy (Vercel), confirm against the live domain if it touches the API.
- Update `docs/BACKLOG.md`: move the module to the done roadmap; log any new deferred items.
</content>
