import {
  getValuesDraftStage,
  hasValuesReview,
} from "@/components/Experiment/TabbedPage/valuesStatus";

type Draft = Parameters<typeof getValuesDraftStage>[0];

const draft = (overrides: Partial<Draft>): Draft => ({
  status: "draft",
  pendingApproval: true,
  hasMergeConflict: false,
  rebaseRequired: false,
  staleApproval: false,
  ...overrides,
});

describe("getValuesDraftStage", () => {
  it.each([
    [
      "a merge conflict, first",
      { hasMergeConflict: true, rebaseRequired: true },
      "conflict",
    ],
    ["a draft behind live", { rebaseRequired: true }, "stale"],
    ["no review required", { pendingApproval: false }, "unreviewed"],
    ["not yet sent", {}, "unsent"],
    ["sent for review", { status: "pending-review" }, "pending-review"],
    ["changes requested", { status: "changes-requested" }, "changes-requested"],
    [
      "approved",
      { status: "approved", approval: { satisfied: true } },
      "approved",
    ],
    [
      "approved short of the policy",
      { status: "approved", approval: { satisfied: false } },
      "short-of-approval",
    ],
  ] as const)("%s", (_, overrides, stage) => {
    expect(getValuesDraftStage(draft(overrides as Partial<Draft>))).toBe(stage);
  });
});

describe("hasValuesReview", () => {
  it("opens once the values are sent, or while stuck on live", () => {
    expect(hasValuesReview(draft({}))).toBe(false);
    expect(hasValuesReview(draft({ pendingApproval: false }))).toBe(false);
    expect(hasValuesReview(draft({ status: "pending-review" }))).toBe(true);
    expect(hasValuesReview(draft({ hasMergeConflict: true }))).toBe(true);
  });
});
