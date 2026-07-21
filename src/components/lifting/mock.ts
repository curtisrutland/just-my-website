import type { SessionDetail, SessionSummary } from "@/lib/lifting/types";

/**
 * Lifting UI mock data for the dev `/preview` harness (read-only, no server actions). Deliberately
 * mirrors the REAL data shapes the mock in the design brief hid: weights are canonical kg (via the
 * `lb` helper so they render to whole pounds), sets include bodyweight (null weight), cardio
 * (duration only), and a high-rep unreliable-e1RM case; the history is a mix of read + needs-read.
 */

/** whole-lb → canonical kg (so display rounds cleanly back to the pound value). */
const lb = (n: number) => n * 0.45359237;

const INTERP =
  "First B day at the new gym, and one number needs context: triceps pushdown reads 60 lb, down from 80 — but that's the machine, not strength. The old gym's pushdown was a double-pulley; the new one is harder. The real signal is up — pallof and curls both PR'd.";

export const mockSummaries: SessionSummary[] = [
  {
    id: "m1",
    hevyId: "h1",
    title: "Session B — Injury Adjusted",
    startedAt: "2026-07-16T22:46:30.000Z",
    endedAt: "2026-07-17T00:09:38.000Z",
    description: "",
    derived: { tonnageKg: lb(11290), workingSets: 25, totalReps: 235, exerciseCount: 10, topE1rmKg: lb(293), durationMin: 83, prs: [] },
    annotation: { sessionNotes: null, quality: null, focus: null, interpretation: null, interpreted: false },
  },
  {
    id: "m2",
    hevyId: "h2",
    title: "Session B",
    startedAt: "2026-07-09T22:04:20.000Z",
    endedAt: "2026-07-09T22:59:04.000Z",
    description: "",
    derived: {
      tonnageKg: lb(4709),
      workingSets: 20,
      totalReps: 198,
      exerciseCount: 8,
      topE1rmKg: lb(80),
      durationMin: 55,
      prs: [
        { lift: "Cable Core Pallof Press", templateId: "pallof", kind: "weight", value: lb(40) },
        { lift: "Cable Core Pallof Press", templateId: "pallof", kind: "e1rm", value: lb(53) },
        { lift: "Bicep Curl (Dumbbell)", templateId: "curl", kind: "weight", value: lb(45) },
        { lift: "Bicep Curl (Dumbbell)", templateId: "curl", kind: "e1rm", value: lb(60) },
      ],
    },
    annotation: { sessionNotes: null, quality: 3, focus: "upper", interpretation: INTERP, interpreted: true },
  },
  {
    id: "m3",
    hevyId: "h3",
    title: "Session A",
    startedAt: "2026-06-17T20:30:00.000Z",
    endedAt: "2026-06-17T21:01:00.000Z",
    description: "",
    derived: {
      tonnageKg: lb(3781),
      workingSets: 16,
      totalReps: 140,
      exerciseCount: 6,
      topE1rmKg: lb(107),
      durationMin: 31,
      prs: [{ lift: "Lat Pulldown (Cable)", templateId: "pulldown", kind: "e1rm", value: lb(107) }],
    },
    annotation: {
      sessionNotes: "Felt strong, quick session.",
      quality: 4,
      focus: "full",
      interpretation: "Steady forward motion: the lat pulldown edges to a new e1RM, and a dumbbell floor press enters as a new pressing variation. The pull keeps leading.",
      interpreted: true,
    },
  },
];

export const mockProgression: Record<string, number[]> = {
  pallof: [lb(30), lb(30), lb(30), lb(40)],
  curl: [lb(20), lb(30), lb(40), lb(45)],
  triceps: [lb(80), lb(80), lb(80), lb(60)],
};

export const mockDetail: SessionDetail = {
  id: "m2",
  hevyId: "h2",
  title: "Session B",
  startedAt: "2026-07-09T22:04:20.000Z",
  endedAt: "2026-07-09T22:59:04.000Z",
  description: "",
  derived: mockSummaries[1].derived,
  annotation: mockSummaries[1].annotation,
  exercises: [
    {
      index: 0,
      title: "Warm Up",
      exerciseTemplateId: null,
      notes: null,
      supersetGroup: null,
      e1rmKg: null,
      e1rmUnreliable: false,
      sets: [{ index: 0, setType: "normal", weightKg: null, reps: null, rpe: null, distanceMeters: null, durationSeconds: 300, pr: false }],
    },
    {
      index: 1,
      title: "Bird Dog",
      exerciseTemplateId: "birddog",
      notes: null,
      supersetGroup: null,
      e1rmKg: null,
      e1rmUnreliable: false,
      sets: [
        { index: 0, setType: "normal", weightKg: null, reps: 10, rpe: null, distanceMeters: null, durationSeconds: null, pr: false },
        { index: 1, setType: "normal", weightKg: null, reps: 10, rpe: null, distanceMeters: null, durationSeconds: null, pr: false },
      ],
    },
    {
      index: 2,
      title: "Lateral Lunge",
      exerciseTemplateId: "latlunge",
      notes: "15lbs kettle bell",
      supersetGroup: null,
      e1rmKg: null,
      e1rmUnreliable: false,
      sets: [{ index: 0, setType: "normal", weightKg: null, reps: 10, rpe: null, distanceMeters: null, durationSeconds: null, pr: false }],
    },
    {
      index: 3,
      title: "Cable Core Pallof Press",
      exerciseTemplateId: "pallof",
      notes: null,
      supersetGroup: null,
      e1rmKg: lb(53),
      e1rmUnreliable: false,
      sets: [
        { index: 0, setType: "normal", weightKg: lb(40), reps: 10, rpe: null, distanceMeters: null, durationSeconds: null, pr: true },
        { index: 1, setType: "normal", weightKg: lb(40), reps: 10, rpe: null, distanceMeters: null, durationSeconds: null, pr: false },
      ],
    },
    {
      index: 4,
      title: "Triceps Pushdown",
      exerciseTemplateId: "triceps",
      notes: null,
      supersetGroup: null,
      e1rmKg: lb(80),
      e1rmUnreliable: false,
      sets: [
        { index: 0, setType: "normal", weightKg: lb(60), reps: 10, rpe: null, distanceMeters: null, durationSeconds: null, pr: false },
        { index: 1, setType: "normal", weightKg: lb(60), reps: 10, rpe: null, distanceMeters: null, durationSeconds: null, pr: false },
      ],
    },
    {
      index: 5,
      title: "Bicep Curl (Dumbbell)",
      exerciseTemplateId: "curl",
      notes: null,
      supersetGroup: null,
      e1rmKg: lb(60),
      e1rmUnreliable: false,
      sets: [
        { index: 0, setType: "normal", weightKg: lb(45), reps: 10, rpe: null, distanceMeters: null, durationSeconds: null, pr: true },
        { index: 1, setType: "normal", weightKg: lb(45), reps: 8, rpe: null, distanceMeters: null, durationSeconds: null, pr: false },
      ],
    },
    {
      index: 6,
      title: "Lateral Raise (Dumbbell)",
      exerciseTemplateId: "latraise",
      notes: null,
      supersetGroup: null,
      e1rmKg: lb(30),
      e1rmUnreliable: true,
      sets: [
        { index: 0, setType: "normal", weightKg: lb(20), reps: 15, rpe: null, distanceMeters: null, durationSeconds: null, pr: false },
        { index: 1, setType: "normal", weightKg: lb(20), reps: 14, rpe: null, distanceMeters: null, durationSeconds: null, pr: false },
      ],
    },
    {
      index: 7,
      title: "Elliptical Trainer",
      exerciseTemplateId: null,
      notes: null,
      supersetGroup: null,
      e1rmKg: null,
      e1rmUnreliable: false,
      sets: [{ index: 0, setType: "normal", weightKg: null, reps: null, rpe: null, distanceMeters: null, durationSeconds: 1800, pr: false }],
    },
  ],
};
