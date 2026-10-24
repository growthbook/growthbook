import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  draftNextStep,
  draftReviewState,
  resolveDraftPick,
  startBypassCovers,
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
  const { draft, target } = resolveDraftPick(i, pick);
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
    expect(resolveDraftPick(info(8, 7, 5), pick).launches).toBe(false);
    // Published or discarded elsewhere: back to the newest.
    expect(on(info(7), pick)).toBe(7);
  });

  it("holds a new draft until a newer draft appears, or starting one stops making sense", () => {
    const pick = { newestVersion: 7, target: "new" as const };
    expect(on(info(7, 5), pick)).toBe("new");
    // Still lists the drafts to switch back to.
    expect(resolveDraftPick(info(7, 5), pick).draft?.version).toBe(7);
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
    expect(withPickedDraft(flag, undefined)).toBe(flag);
    expect(
      withPickedDraft(flag, { newestVersion: 7, target: 5 }).pendingDraft
        ?.version,
    ).toBe(5);
    expect(
      withPickedDraft(flag, { newestVersion: 7, target: "new" }).pendingDraft,
    ).toBeUndefined();
  });
});

describe("draftReviewState", () => {
  const pending = (fields: Partial<PendingDraft>) =>
    ({ status: "draft", pendingApproval: false, ...fields }) as PendingDraft;

  it.each([
    ["needs no review", pending({}), "ready", "Publish"],
    [
      "already gets past the review it needs",
      pending({ pendingApproval: true, approval: { satisfied: true } }),
      "ready",
      "Publish",
    ],
    [
      "still needs approval",
      pending({ pendingApproval: true, approval: { satisfied: false } }),
      "needs-approval",
      "Request review",
    ],
    [
      "is waiting on a reviewer",
      pending({ pendingApproval: true, status: "pending-review" }),
      "in-review",
      "Review",
    ],
    [
      "had changes requested",
      pending({ pendingApproval: true, status: "changes-requested" }),
      "changes-requested",
      "View feedback",
    ],
    [
      "is approved",
      pending({ pendingApproval: true, status: "approved" }),
      "approved",
      "Publish",
    ],
    [
      "is approved short of what publishing needs",
      pending({
        pendingApproval: true,
        status: "approved",
        approval: { satisfied: false },
      }),
      "in-review",
      "Review",
    ],
  ])("a draft that %s", (_, draft, state, step) => {
    expect(draftReviewState(draft)).toBe(state);
    expect(draftNextStep(draft)).toBe(step);
  });
});

describe("startBypassCovers", () => {
  const pinnedAt = "2026-10-23T02:59:07.060Z";
  const armed = (bypassApproval: boolean) => ({
    nextScheduledStatusUpdate: {
      type: "start" as const,
      date: "2026-10-27T07:00:00.000Z",
      bypassApproval,
      pinnedDrafts: [
        { featureId: "flag", revisionVersion: 2, dateUpdated: pinnedAt },
      ],
    },
  });
  it.each([
    {
      name: "the pinned draft, unchanged",
      experiment: armed(true),
      draft: { version: 2, dateUpdated: pinnedAt },
      expected: true,
    },
    {
      name: "a start scheduled without the bypass",
      experiment: armed(false),
      draft: { version: 2, dateUpdated: pinnedAt },
      expected: false,
    },
    {
      name: "the pinned draft, edited since",
      experiment: armed(true),
      draft: { version: 2, dateUpdated: "2026-10-24T00:00:00.000Z" },
      expected: false,
    },
    {
      name: "a newer draft than the pinned one",
      experiment: armed(true),
      draft: { version: 3, dateUpdated: pinnedAt },
      expected: false,
    },
    {
      name: "no confirmed start",
      experiment: { nextScheduledStatusUpdate: null },
      draft: { version: 2, dateUpdated: pinnedAt },
      expected: false,
    },
  ])("covers $name: $expected", ({ experiment, draft, expected }) => {
    expect(
      startBypassCovers(
        experiment as Parameters<typeof startBypassCovers>[0],
        "flag",
        draft,
      ),
    ).toBe(expected);
  });
});
