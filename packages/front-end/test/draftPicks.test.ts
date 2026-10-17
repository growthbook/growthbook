import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  resolveDraftPick,
  withPickedDraft,
} from "@/components/Experiment/TabbedPage/draftPicks";

type PendingDraft = NonNullable<LinkedFeatureInfo["pendingDraft"]>;

const draft = (version: number) =>
  ({ version, hasUnrelatedDraftChanges: true }) as PendingDraft;

// Live has the rule and the newest draft carries unrelated edits, so starting
// a separate draft is on offer.
const info = (...versions: number[]) =>
  ({
    feature: { id: "flag" },
    liveHasMatchingRule: true,
    ...(versions.length && {
      pendingDraft: draft(versions[0]),
      otherPendingDrafts: versions.slice(1).map(draft),
    }),
  }) as LinkedFeatureInfo;

const on = (
  i: LinkedFeatureInfo,
  pick?: Parameters<typeof resolveDraftPick>[1],
) => {
  const { draft, target } = resolveDraftPick(i, pick, "exp_1");
  return target === "new" ? "new" : draft?.version;
};

describe("resolveDraftPick", () => {
  it("follows the newest draft until one is picked, and starts one when there's none", () => {
    expect(on(info(7, 5))).toBe(7);
    expect(on(info())).toBe("new");
  });

  it("holds a picked draft while it's open, even past a newer one, which is the one that launches", () => {
    const pick = { newestVersion: 7, target: 5 };
    expect(on(info(7, 5), pick)).toBe(5);
    expect(on(info(8, 7, 5), pick)).toBe(5);
    expect(resolveDraftPick(info(8, 7, 5), pick, "exp_1").launches).toBe(false);
    // Published or discarded elsewhere: back to the newest.
    expect(on(info(7), pick)).toBe(7);
  });

  it("holds a new draft until a newer draft appears, or starting one stops making sense", () => {
    const pick = { newestVersion: 7, target: "new" as const };
    expect(on(info(7, 5), pick)).toBe("new");
    // Still lists the drafts to switch back to.
    expect(resolveDraftPick(info(7, 5), pick, "exp_1").draft?.version).toBe(7);
    expect(on(info(8, 7, 5), pick)).toBe(8);
    const cleaned = {
      ...info(7),
      pendingDraft: { ...draft(7), hasUnrelatedDraftChanges: false },
    };
    expect(on(cleaned, pick)).toBe(7);
  });
});

describe("withPickedDraft", () => {
  it("puts the picked draft in place of the newest, and none when starting one", () => {
    const flag = info(7, 5);
    expect(withPickedDraft(flag, undefined, "exp_1")).toBe(flag);
    expect(
      withPickedDraft(flag, { newestVersion: 7, target: 5 }, "exp_1")
        .pendingDraft?.version,
    ).toBe(5);
    expect(
      withPickedDraft(flag, { newestVersion: 7, target: "new" }, "exp_1")
        .pendingDraft,
    ).toBeUndefined();
  });
});
