import type { AssignedBy } from "./schema";

/**
 * The garage's tagging decisions as pure functions, so precedence is tested without a database.
 * The repo loads the rules and existing tags, asks these what to do, then writes.
 *
 * Precedence: a person beats a rule. `manual` and `backfill` tags are never touched by rules; a
 * `rule` tag follows its profile (re-pointed when the profile moves to another bike, removed when
 * the rule is removed), except on a retired bike, whose history stays put.
 */

export const normalizeProfile = (profile: string) => profile.trim().toLowerCase();

/** `lower(profile)` → bikeId, for live rules on non-retired bikes. */
export type RuleMap = Map<string, string>;

export type ExistingTag = { bikeId: string; assignedBy: AssignedBy; bikeRetired: boolean };

export type AttributeDecision =
  | { action: "unchanged" } // a person tagged it, or the rule already points here
  | { action: "unmatched" } // no rule names this profile
  | { action: "tag"; bikeId: string; reason: string } // create, or re-point an existing rule tag
  | { action: "untag" }; // a rule tag whose rule is gone

export function decideAttribution(
  sportProfileName: string | null,
  existing: ExistingTag | undefined,
  rules: RuleMap
): AttributeDecision {
  if (existing && existing.assignedBy !== "rule") return { action: "unchanged" };
  // Retiring a bike drops its rules but keeps its history: its rule tags stay where they are.
  if (existing?.bikeRetired) return { action: "unchanged" };
  const bikeId = sportProfileName ? rules.get(normalizeProfile(sportProfileName)) : undefined;
  if (!bikeId) return existing ? { action: "untag" } : { action: "unmatched" };
  if (existing?.bikeId === bikeId) return { action: "unchanged" };
  return { action: "tag", bikeId, reason: sportProfileName!.trim() };
}

/**
 * Replacing a bike's profile set: which profiles it adds and removes, and which of the adds are
 * already claimed by another live bike (a conflict — a profile names at most one bike).
 */
export function diffProfiles(
  current: string[],
  next: string[],
  claimedElsewhere: Map<string, string> // lower(profile) → the other bike's name
): { add: string[]; remove: string[]; conflicts: { profile: string; bikeName: string }[] } {
  const have = new Map(current.map((p) => [normalizeProfile(p), p]));
  const want = new Map<string, string>();
  for (const p of next) want.set(normalizeProfile(p), p.trim());
  const add = [...want].filter(([k]) => !have.has(k)).map(([, p]) => p);
  const remove = [...have].filter(([k]) => !want.has(k)).map(([, p]) => p);
  const conflicts = add
    .filter((p) => claimedElsewhere.has(normalizeProfile(p)))
    .map((p) => ({ profile: p, bikeName: claimedElsewhere.get(normalizeProfile(p))! }));
  return { add, remove, conflicts };
}
