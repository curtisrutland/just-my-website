/** Macros domain + rollup-contract types (UI-CONTRACT §4). Consumed by both the repo/lib layer
 *  (e.g. `week.ts`) and the UI — hence they live in `lib/macros`, never in `components`. */

export type Kind = "training" | "rest" | "unspecified";
export type Confidence = "measured" | "estimated" | "logged_serving";

export type WeekDay = { date: string; kind: Kind };

export type MacroSet = {
  calories: number | null;
  proteinContent: number | null;
  fatContent: number | null;
  carbohydrateContent: number | null;
};

/**
 * The subset of the API's entry shape (`EntryView`) that the UI renders. `name` is the resolved
 * label (entry's own label, else the linked food's name) — the same key the read endpoints return.
 */
export type RollupEntry = {
  id: string;
  consumedOn: string;
  name: string | null;
  quantityGrams: number;
  confidence: Confidence;
  note: string | null;
  calories: number | null;
  proteinContent: number | null;
  fatContent: number | null;
  carbohydrateContent: number | null;
};

export type DayRollupData = {
  day: { date: string; kind: Kind };
  totals: MacroSet;
  estimation: { estimatedFraction: number; entryCount: number; estimatedCount: number };
  targets: Partial<Record<"training" | "rest", MacroSet>>;
  entries: RollupEntry[];
};
