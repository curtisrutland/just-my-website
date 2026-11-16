import { describe, expect, it } from "vitest";
import { decideAttribution, diffProfiles, type RuleMap } from "./rules";

const NEURON = "11111111-1111-4111-8111-111111111111";
const CHECKPOINT = "22222222-2222-4222-8222-222222222222";
const rules: RuleMap = new Map([
  ["gravel", CHECKPOINT],
  ["bike", CHECKPOINT],
]);

describe("decideAttribution: a person beats a rule", () => {
  it("tags a ride whose profile names a bike, case-insensitively, keeping the ride's spelling as the reason", () => {
    expect(decideAttribution("GRAVEL", undefined, rules)).toEqual({ action: "tag", bikeId: CHECKPOINT, reason: "GRAVEL" });
    expect(decideAttribution("Bike", undefined, rules)).toEqual({ action: "tag", bikeId: CHECKPOINT, reason: "Bike" });
  });

  it("never guesses: no rule, or no profile, is unmatched", () => {
    expect(decideAttribution("MTB", undefined, rules)).toEqual({ action: "unmatched" });
    expect(decideAttribution(null, undefined, rules)).toEqual({ action: "unmatched" });
  });

  it("leaves manual and backfill tags alone, even when a rule says otherwise", () => {
    expect(decideAttribution("GRAVEL", { bikeId: NEURON, assignedBy: "manual", bikeRetired: false }, rules)).toEqual({ action: "unchanged" });
    expect(decideAttribution("GRAVEL", { bikeId: NEURON, assignedBy: "backfill", bikeRetired: false }, rules)).toEqual({ action: "unchanged" });
  });

  it("is idempotent for a rule tag already pointing at the rule's bike", () => {
    expect(decideAttribution("GRAVEL", { bikeId: CHECKPOINT, assignedBy: "rule", bikeRetired: false }, rules)).toEqual({ action: "unchanged" });
  });

  it("re-points a rule tag when its profile now names another bike", () => {
    expect(decideAttribution("GRAVEL", { bikeId: NEURON, assignedBy: "rule", bikeRetired: false }, rules)).toEqual({
      action: "tag",
      bikeId: CHECKPOINT,
      reason: "GRAVEL",
    });
  });

  it("removes a rule tag whose rule is gone", () => {
    expect(decideAttribution("MTB", { bikeId: NEURON, assignedBy: "rule", bikeRetired: false }, rules)).toEqual({ action: "untag" });
  });

  it("keeps a retired bike's rule tags: retiring drops the rules, not the history", () => {
    expect(decideAttribution("MTB", { bikeId: NEURON, assignedBy: "rule", bikeRetired: true }, rules)).toEqual({ action: "unchanged" });
    expect(decideAttribution("GRAVEL", { bikeId: NEURON, assignedBy: "rule", bikeRetired: true }, rules)).toEqual({ action: "unchanged" });
  });
});

describe("diffProfiles", () => {
  it("adds and removes case-insensitively, keeping the new spelling", () => {
    expect(diffProfiles(["GRAVEL", "Bike"], ["gravel", "Road"], new Map())).toEqual({
      add: ["Road"],
      remove: ["Bike"],
      conflicts: [],
    });
  });

  it("reports a profile another bike already claims", () => {
    const claimed = new Map([["mtb", "Neuron 6"]]);
    expect(diffProfiles([], ["MTB"], claimed).conflicts).toEqual([{ profile: "MTB", bikeName: "Neuron 6" }]);
  });

  it("collapses duplicates in the requested set", () => {
    expect(diffProfiles([], ["BMX", "bmx"], new Map()).add).toEqual(["bmx"]);
  });
});
