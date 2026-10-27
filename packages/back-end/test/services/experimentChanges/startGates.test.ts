import {
  evaluateStartGates,
  rampLockedGate,
  startChecklistGates,
} from "back-end/src/services/experimentChanges/startGates";
import type { StartChecklistItemStatus } from "back-end/src/services/experimentChanges/changeExperimentStatus";

const item = (
  key: string,
  overrides: Partial<StartChecklistItemStatus> = {},
): StartChecklistItemStatus => ({
  key,
  required: true,
  status: "incomplete",
  manual: false,
  reason: `${key} is open`,
  ...overrides,
});

describe("startChecklistGates", () => {
  it("names how to get past each open item", () => {
    const gates = startChecklistGates(
      "exp_1",
      [
        item("datasource"),
        item("datasource-done", { status: "complete" }),
        item("Sign off", { manual: true }),
        item("missingVariationValues:flag_c", { featureId: "flag_c" }),
        item("pendingApproval:flag_a", {
          hardBlock: true,
          featureId: "flag_a",
        }),
        item("mergeConflict:flag_b", { hardBlock: true, featureId: "flag_b" }),
      ],
      new Map([
        ["flag_a", 3],
        ["flag_b", 5],
      ]),
    );

    expect(gates).toEqual([
      expect.objectContaining({
        key: "datasource",
        type: "checklist-item",
        severity: "warning",
        override: "skipChecklist",
        resolution: null,
      }),
      expect.objectContaining({
        key: "Sign off",
        resolution: expect.objectContaining({
          path: "/experiments/exp_1/start-checklist/manual/complete",
        }),
      }),
      expect.objectContaining({
        key: "missingVariationValues:flag_c",
        featureId: "flag_c",
        override: "skipChecklist",
      }),
      expect.objectContaining({
        key: "pendingApproval:flag_a",
        featureId: "flag_a",
        type: "approval-required",
        severity: "blocker",
        override: null,
        requiresPermission: expect.any(String),
        resolution: expect.objectContaining({
          path: "/features/flag_a/revisions/3/request-review",
        }),
      }),
      expect.objectContaining({
        key: "mergeConflict:flag_b",
        type: "merge-conflict",
        requiresPermission: null,
        resolution: expect.objectContaining({
          path: "/features/flag_b/revisions/5/rebase",
        }),
      }),
    ]);
  });
});

describe("evaluateStartGates", () => {
  const gates = [
    ...startChecklistGates(
      "exp_1",
      [
        item("goalMetric"),
        item("pendingApproval:mine", { hardBlock: true, featureId: "mine" }),
        item("pendingApproval:theirs", {
          hardBlock: true,
          featureId: "theirs",
        }),
        item("mergeConflict:mine", { hardBlock: true, featureId: "mine" }),
      ],
      new Map(),
    ),
    rampLockedGate("theirs", "Locked by a ramp"),
  ];
  const canBypassFlag = (featureId: string) => featureId === "mine";
  const keys = (list: { key: string }[]) => list.map((g) => g.key);

  it("skips checklist items when asked, and waives approval per flag", () => {
    const result = evaluateStartGates(gates, {
      skipChecklist: true,
      canBypassFlag,
      restApiBypassesReviews: false,
    });

    expect(keys(result.blocking)).toEqual([
      "pendingApproval:theirs",
      "mergeConflict:mine",
      "rampLocked:theirs",
    ]);
    expect(result.skipped.map(({ key, via }) => ({ key, via }))).toEqual([
      { key: "goalMetric", via: "skipChecklist" },
      { key: "pendingApproval:mine", via: "bypassApprovalPermission" },
    ]);
  });

  it("lets the REST bypass setting past approvals and ramp locks, not conflicts", () => {
    const result = evaluateStartGates(gates, {
      skipChecklist: false,
      canBypassFlag: () => false,
      restApiBypassesReviews: true,
    });

    expect(keys(result.blocking)).toEqual(["goalMetric", "mergeConflict:mine"]);
  });
});
