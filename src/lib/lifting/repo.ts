import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  liftingExercise,
  liftingSession,
  liftingSessionNote,
  liftingSet,
  type LiftingSession,
} from "@/lib/db/schema";
import { listWorkouts } from "./hevy";
import { hevyWorkoutSchema, normalizeWorkout, type LiftingAnnotationPatch, type LiftingFocus, type NormalizedSession } from "./schema";
import {
  exerciseE1rm,
  tonnage,
  volumeCounts,
  walkPrs,
  type PrResult,
  type WalkExercise,
  type WalkSession,
} from "./derive";
import type {
  ExerciseView,
  LiftProgression,
  LiftProgressionPoint,
  PrFlag,
  SessionAnnotation,
  SessionDerived,
  SessionDetail,
  SessionSummary,
  SetView,
} from "./types";

/**
 * Lifting module — repository. The only place the four `lifting_*` tables are touched. Reads exclude
 * soft-deleted sessions/notes. Derived stats (tonnage, e1RM, PRs, duration) are computed here on the
 * way out, never stored (docs/lifting-model.md). Unlike the health-screen modules, lifting is NOT on
 * the kitchen panel, so there is deliberately no `bump()` on writes.
 *
 * The facts (`lifting_session` + `lifting_exercise` + `lifting_set`) are ingested from Hevy and
 * rebuilt wholesale on re-pull; the annotation (`lifting_session_note`) is the only surface-writable
 * table and is never touched by a re-pull.
 */

const liveSession = isNull(liftingSession.deletedAt);
const liveNote = isNull(liftingSessionNote.deletedAt);

// -- Ingestion ----------------------------------------------------------------

/**
 * Upsert a session's FACTS from a normalized Hevy workout, rebuilding its exercise/set children in
 * one atomic `db.batch` (neon-http has no interactive transactions; batch runs as one transaction).
 * The child rebuild is a delete+reinsert, so children carry no soft-delete; the delete cascades to
 * sets. The session row is stable across re-pulls (its id and any annotation FK survive). When
 * Hevy's `updated_at` hasn't advanced, the child rebuild is skipped. Returns `{ session, changed }`.
 */
async function upsertInternal(n: NormalizedSession): Promise<{ session: LiftingSession; changed: boolean }> {
  const [existing] = await db
    .select({ id: liftingSession.id, hevyUpdatedAt: liftingSession.hevyUpdatedAt })
    .from(liftingSession)
    .where(and(eq(liftingSession.hevyId, n.hevyId), liveSession))
    .limit(1);

  const sessionId = existing?.id ?? randomUUID();
  const unchanged =
    existing != null &&
    n.hevyUpdatedAt != null &&
    existing.hevyUpdatedAt != null &&
    existing.hevyUpdatedAt.getTime() === n.hevyUpdatedAt.getTime();

  const facts = {
    hevyId: n.hevyId,
    title: n.title,
    startedAt: n.startedAt,
    endedAt: n.endedAt,
    description: n.description,
    hevyUpdatedAt: n.hevyUpdatedAt,
    rawPayload: n.rawPayload,
  };

  const [session] = existing
    ? await db.update(liftingSession).set(facts).where(eq(liftingSession.id, sessionId)).returning()
    : await db.insert(liftingSession).values({ id: sessionId, ...facts }).returning();

  if (unchanged) return { session, changed: false };

  // Rebuild children. App-generated ids let sets reference their exercise inside a single batch
  // (no dependency on DB-returned ids across statements).
  const exerciseRows: (typeof liftingExercise.$inferInsert)[] = [];
  const setRows: (typeof liftingSet.$inferInsert)[] = [];
  for (const ex of n.exercises) {
    const exId = randomUUID();
    exerciseRows.push({
      id: exId,
      sessionId,
      index: ex.index,
      exerciseTemplateId: ex.exerciseTemplateId,
      title: ex.title,
      notes: ex.notes,
      supersetGroup: ex.supersetGroup,
    });
    for (const s of ex.sets) {
      setRows.push({
        id: randomUUID(),
        exerciseId: exId,
        sessionId,
        index: s.index,
        setType: s.setType,
        weightKg: s.weightKg,
        reps: s.reps,
        rpe: s.rpe,
        distanceMeters: s.distanceMeters,
        durationSeconds: s.durationSeconds,
      });
    }
  }

  const del = db.delete(liftingExercise).where(eq(liftingExercise.sessionId, sessionId)); // cascades to sets
  if (exerciseRows.length === 0) {
    await del;
  } else if (setRows.length === 0) {
    await db.batch([del, db.insert(liftingExercise).values(exerciseRows)]);
  } else {
    await db.batch([del, db.insert(liftingExercise).values(exerciseRows), db.insert(liftingSet).values(setRows)]);
  }

  return { session, changed: true };
}

/** Public ingestion entry point — upsert one normalized workout, returning the persisted session. */
export async function upsertSessionFromHevy(n: NormalizedSession): Promise<LiftingSession> {
  const { session } = await upsertInternal(n);
  return session;
}

/**
 * Page `GET /v1/workouts` and ingest each workout (idempotent — the upsert dedupes by `hevyId` and
 * skips unchanged children). Serves BOTH the one-time initial backfill (pass enough pages to reach
 * the start) and the ongoing catch-up recovery lever (recent pages). Stops at Hevy's last page.
 */
export async function catchUp(opts: { pages?: number } = {}): Promise<{ scanned: number; ingested: number; pages: number }> {
  const maxPages = Math.max(1, opts.pages ?? 1);
  let scanned = 0;
  let ingested = 0;
  let pagesRead = 0;

  for (let page = 1; page <= maxPages; page++) {
    const { workouts, pageCount } = await listWorkouts({ page });
    pagesRead = page;
    for (const raw of workouts) {
      scanned += 1;
      const parsed = hevyWorkoutSchema.parse(raw);
      const { changed } = await upsertInternal(normalizeWorkout(parsed, raw));
      if (changed) ingested += 1;
    }
    if (page >= pageCount) break;
  }

  return { scanned, ingested, pages: pagesRead };
}

// -- PR index (full-history walk) --------------------------------------------

/**
 * Walk ALL live sessions oldest → newest to compute PR flags. This is a full-history scan on every
 * read that needs PRs — acceptable for a single-user history; the natural optimization (a stored PR
 * cache) is deferred. Returns per-session flags + the set ids that achieved a PR.
 */
async function loadPrIndex(): Promise<PrResult> {
  const rows = await db
    .select({
      sessionId: liftingSession.id,
      exId: liftingExercise.id,
      exIndex: liftingExercise.index,
      templateId: liftingExercise.exerciseTemplateId,
      exTitle: liftingExercise.title,
      setId: liftingSet.id,
      setIndex: liftingSet.index,
      setType: liftingSet.setType,
      weightKg: liftingSet.weightKg,
      reps: liftingSet.reps,
    })
    .from(liftingSession)
    .innerJoin(liftingExercise, eq(liftingExercise.sessionId, liftingSession.id))
    .innerJoin(liftingSet, eq(liftingSet.exerciseId, liftingExercise.id))
    .where(liveSession)
    .orderBy(asc(liftingSession.startedAt), asc(liftingExercise.index), asc(liftingSet.index));

  const sessions: WalkSession[] = [];
  const bySession = new Map<string, WalkSession>();
  const byExercise = new Map<string, WalkExercise>();
  for (const r of rows) {
    let s = bySession.get(r.sessionId);
    if (!s) {
      s = { sessionId: r.sessionId, exercises: [] };
      bySession.set(r.sessionId, s);
      sessions.push(s);
    }
    let e = byExercise.get(r.exId);
    if (!e) {
      e = { templateId: r.templateId, title: r.exTitle, sets: [] };
      byExercise.set(r.exId, e);
      s.exercises.push(e);
    }
    e.sets.push({ setId: r.setId, setType: r.setType, weightKg: r.weightKg, reps: r.reps });
  }

  return walkPrs(sessions);
}

// -- View builders ------------------------------------------------------------

function toAnnotation(note: typeof liftingSessionNote.$inferSelect | undefined): SessionAnnotation {
  if (!note) {
    return { sessionNotes: null, quality: null, focus: null, interpretation: null, interpreted: false };
  }
  return {
    sessionNotes: note.sessionNotes,
    quality: note.quality,
    focus: (note.focus as LiftingFocus | null) ?? null,
    interpretation: note.interpretation,
    interpreted: note.interpretedAt != null,
  };
}

/** Load the exercise → set tree for a set of sessions and project to `ExerciseView[]` per session. */
async function buildExercisesBySession(sessionIds: string[], prSetIds: Set<string>): Promise<Map<string, ExerciseView[]>> {
  const out = new Map<string, ExerciseView[]>();
  if (sessionIds.length === 0) return out;

  const exRows = await db
    .select()
    .from(liftingExercise)
    .where(inArray(liftingExercise.sessionId, sessionIds))
    .orderBy(asc(liftingExercise.sessionId), asc(liftingExercise.index));
  const setRows = await db
    .select()
    .from(liftingSet)
    .where(inArray(liftingSet.sessionId, sessionIds))
    .orderBy(asc(liftingSet.exerciseId), asc(liftingSet.index));

  const setsByExercise = new Map<string, SetView[]>();
  for (const s of setRows) {
    const view: SetView = {
      index: s.index,
      setType: s.setType,
      weightKg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe,
      distanceMeters: s.distanceMeters,
      durationSeconds: s.durationSeconds,
      pr: prSetIds.has(s.id),
    };
    const list = setsByExercise.get(s.exerciseId);
    if (list) list.push(view);
    else setsByExercise.set(s.exerciseId, [view]);
  }

  for (const ex of exRows) {
    const sets = setsByExercise.get(ex.id) ?? [];
    const { e1rmKg, unreliable } = exerciseE1rm(sets);
    const view: ExerciseView = {
      index: ex.index,
      title: ex.title,
      exerciseTemplateId: ex.exerciseTemplateId,
      notes: ex.notes,
      supersetGroup: ex.supersetGroup,
      e1rmKg,
      e1rmUnreliable: unreliable,
      sets,
    };
    const list = out.get(ex.sessionId);
    if (list) list.push(view);
    else out.set(ex.sessionId, [view]);
  }
  return out;
}

function durationMin(session: LiftingSession): number | null {
  if (!session.endedAt) return null;
  return Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60000);
}

function deriveSession(session: LiftingSession, exercises: ExerciseView[], prs: PrFlag[]): SessionDerived {
  const flatSets = exercises.flatMap((e) => e.sets);
  const { workingSets, totalReps } = volumeCounts(flatSets);
  const e1rms = exercises.map((e) => e.e1rmKg).filter((v): v is number => v != null);
  return {
    tonnageKg: Math.round(tonnage(flatSets)),
    workingSets,
    totalReps,
    exerciseCount: exercises.length,
    topE1rmKg: e1rms.length ? Math.max(...e1rms) : null,
    durationMin: durationMin(session),
    prs,
  };
}

function toSummary(session: LiftingSession, exercises: ExerciseView[], note: typeof liftingSessionNote.$inferSelect | undefined, prs: PrFlag[]): SessionSummary {
  return {
    id: session.id,
    hevyId: session.hevyId,
    title: session.title,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    description: session.description,
    derived: deriveSession(session, exercises, prs),
    annotation: toAnnotation(note),
  };
}

// -- Reads --------------------------------------------------------------------

export type ListSessionsOpts = {
  limit?: number;
  offset?: number;
  interpreted?: boolean;
  focus?: LiftingFocus;
  from?: string; // ISO instant/date, inclusive lower bound on startedAt
  to?: string; // ISO instant/date, inclusive upper bound on startedAt
};

/** The journal list: session summaries (derived headline + annotation + PR flags), newest first. */
export async function listSessions(opts: ListSessionsOpts = {}): Promise<{ items: SessionSummary[]; count: number }> {
  const { limit = 50, offset = 0 } = opts;

  // Note-based filters apply against the left-joined (live) note; a null note fails `interpreted:true`
  // and passes `interpreted:false` (an un-annotated session has never been read).
  const filters: SQL[] = [liveSession];
  if (opts.interpreted === true) filters.push(isNotNull(liftingSessionNote.interpretedAt));
  if (opts.interpreted === false) filters.push(isNull(liftingSessionNote.interpretedAt));
  if (opts.focus) filters.push(eq(liftingSessionNote.focus, opts.focus));
  if (opts.from) filters.push(gte(liftingSession.startedAt, new Date(opts.from)));
  if (opts.to) filters.push(lte(liftingSession.startedAt, new Date(opts.to)));

  const where = and(...filters);
  const noteJoin = and(eq(liftingSessionNote.sessionId, liftingSession.id), liveNote);

  const rows = await db
    .select({ session: liftingSession, note: liftingSessionNote })
    .from(liftingSession)
    .leftJoin(liftingSessionNote, noteJoin)
    .where(where)
    .orderBy(desc(liftingSession.startedAt))
    .limit(limit)
    .offset(offset);

  const [{ c }] = await db
    .select({ c: count() })
    .from(liftingSession)
    .leftJoin(liftingSessionNote, noteJoin)
    .where(where);

  const sessionIds = rows.map((r) => r.session.id);
  const prIndex = await loadPrIndex();
  const exercisesBySession = await buildExercisesBySession(sessionIds, prIndex.prSetIds);

  const items = rows.map((r) =>
    toSummary(r.session, exercisesBySession.get(r.session.id) ?? [], r.note ?? undefined, prIndex.prsBySession.get(r.session.id) ?? [])
  );
  return { items, count: c };
}

/** A full session: the exercise → set tree, derived stats, PR flags, and the annotation. */
export async function getSession(id: string): Promise<SessionDetail | null> {
  const [row] = await db
    .select({ session: liftingSession, note: liftingSessionNote })
    .from(liftingSession)
    .leftJoin(liftingSessionNote, and(eq(liftingSessionNote.sessionId, liftingSession.id), liveNote))
    .where(and(eq(liftingSession.id, id), liveSession))
    .limit(1);
  if (!row) return null;

  const prIndex = await loadPrIndex();
  const exercises = (await buildExercisesBySession([id], prIndex.prSetIds)).get(id) ?? [];
  const summary = toSummary(row.session, exercises, row.note ?? undefined, prIndex.prsBySession.get(id) ?? []);
  return { ...summary, exercises };
}

/** Best-e1RM (and top-set weight) per session for one lift identity, oldest → newest. */
export async function getLiftProgression(templateId: string): Promise<LiftProgression> {
  const rows = await db
    .select({
      sessionId: liftingSession.id,
      startedAt: liftingSession.startedAt,
      exTitle: liftingExercise.title,
      setType: liftingSet.setType,
      weightKg: liftingSet.weightKg,
      reps: liftingSet.reps,
    })
    .from(liftingSession)
    .innerJoin(liftingExercise, eq(liftingExercise.sessionId, liftingSession.id))
    .innerJoin(liftingSet, eq(liftingSet.exerciseId, liftingExercise.id))
    .where(and(liveSession, eq(liftingExercise.exerciseTemplateId, templateId)))
    .orderBy(asc(liftingSession.startedAt));

  const bySession = new Map<string, { startedAt: Date; sets: { setType: string; weightKg: number | null; reps: number | null }[] }>();
  const order: string[] = [];
  let title: string | null = null;
  for (const r of rows) {
    title = r.exTitle; // rows are oldest→newest, so the last assignment is the most recent title
    let g = bySession.get(r.sessionId);
    if (!g) {
      g = { startedAt: r.startedAt, sets: [] };
      bySession.set(r.sessionId, g);
      order.push(r.sessionId);
    }
    g.sets.push({ setType: r.setType, weightKg: r.weightKg, reps: r.reps });
  }

  const points: LiftProgressionPoint[] = order.map((sid) => {
    const g = bySession.get(sid)!;
    const { e1rmKg } = exerciseE1rm(g.sets);
    let topSetKg: number | null = null;
    for (const s of g.sets) {
      if (s.setType === "normal" && s.weightKg != null && (topSetKg == null || s.weightKg > topSetKg)) topSetKg = s.weightKg;
    }
    return { sessionId: sid, startedAt: g.startedAt.toISOString(), e1rmKg, topSetKg };
  });

  return { templateId, title, points };
}

// -- Annotation + lifecycle ---------------------------------------------------

/**
 * Upsert the annotation for a session (the only surface write). `interpretedAt` tracks the presence
 * of interpretation TEXT: writing non-null interpretation stamps it `now()`; explicitly clearing it
 * to null clears the stamp (so the un-interpreted queue stays honest). Returns the full session
 * (get-after-write) or null if the session doesn't exist.
 */
export async function patchAnnotation(sessionId: string, patch: LiftingAnnotationPatch): Promise<SessionDetail | null> {
  const [session] = await db
    .select({ id: liftingSession.id })
    .from(liftingSession)
    .where(and(eq(liftingSession.id, sessionId), liveSession))
    .limit(1);
  if (!session) return null;

  const [existing] = await db
    .select()
    .from(liftingSessionNote)
    .where(and(eq(liftingSessionNote.sessionId, sessionId), liveNote))
    .limit(1);

  // Only stamp/clear interpretedAt when `interpretation` is part of this patch.
  const interpretedAt =
    "interpretation" in patch ? (patch.interpretation == null ? null : new Date()) : undefined;

  const fields = {
    ...("sessionNotes" in patch ? { sessionNotes: patch.sessionNotes } : {}),
    ...("interpretation" in patch ? { interpretation: patch.interpretation } : {}),
    ...("focus" in patch ? { focus: patch.focus } : {}),
    ...("quality" in patch ? { quality: patch.quality } : {}),
    ...(interpretedAt !== undefined ? { interpretedAt } : {}),
  };

  if (existing) {
    if (Object.keys(fields).length > 0) {
      await db.update(liftingSessionNote).set(fields).where(eq(liftingSessionNote.id, existing.id));
    }
  } else {
    await db.insert(liftingSessionNote).values({ sessionId, ...fields });
  }

  return getSession(sessionId);
}

export async function softDeleteSession(id: string): Promise<boolean> {
  const [row] = await db
    .update(liftingSession)
    .set({ deletedAt: new Date() })
    .where(and(eq(liftingSession.id, id), liveSession))
    .returning({ id: liftingSession.id });
  return !!row;
}

export async function hardDeleteSession(id: string): Promise<boolean> {
  // Cascades to exercises, sets, and the annotation note.
  const [row] = await db.delete(liftingSession).where(eq(liftingSession.id, id)).returning({ id: liftingSession.id });
  return !!row;
}
