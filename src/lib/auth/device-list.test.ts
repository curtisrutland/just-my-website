import { describe, expect, it } from "vitest";
import { underParents } from "./device-list";

const t = (id: string, parentId: string | null = null) => ({ id, parentId });

describe("underParents — the devices page order", () => {
  it("puts each child directly under its parent, keeping the list's order otherwise", () => {
    // Newest first, as the repo returns them: the child was minted after its parent.
    const listed = [t("siri", "iphone"), t("iphone"), t("panel"), t("old-siri", "iphone"), t("recipes")];
    expect(underParents(listed).map((d) => d.id)).toEqual(["iphone", "siri", "old-siri", "panel", "recipes"]);
  });

  it("keeps a child whose parent isn't listed, at the top level", () => {
    expect(underParents([t("orphan", "gone"), t("panel")]).map((d) => d.id)).toEqual(["orphan", "panel"]);
  });

  it("never drops or repeats a token", () => {
    const listed = [t("a"), t("b", "a"), t("c", "a"), t("d"), t("e", "missing")];
    expect(underParents(listed).map((d) => d.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(underParents([])).toEqual([]);
  });
});
