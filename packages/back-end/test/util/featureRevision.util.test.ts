import { FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";

// `applyPartialFeatureRuleUpdatesToRevision` matches by `rule.id` against the
// unified `revision.rules: FeatureRule[]`. These tests pin the idempotent-match,
// immutability, and missing-rule-tolerance contracts.

// Minimal revision factory; only `rules` and `status` matter to the helper.
const makeRevision = (
  rules: FeatureRule[],
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface =>
  ({
    organization: "org",
    featureId: "feat",
    version: 2,
    baseVersion: 1,
    status: "draft",
    rules,
    ...overrides,
  }) as unknown as FeatureRevisionInterface;

describe("applyPartialFeatureRuleUpdatesToRevision", () => {
  it("overlays updates onto the targeted rule (single match)", () => {
    const rule: FeatureRule = {
      id: "r1",
      type: "experiment-ref",
      experimentId: "exp1",
      variations: ["a", "b"],
      enabled: true,
    } as FeatureRule;
    const revision = makeRevision([{ ...rule }]);

    const next = applyPartialFeatureRuleUpdatesToRevision(revision, ["r1"], {
      variations: ["x", "y"],
    });

    expect(next.rules).toHaveLength(1);
    expect((next.rules![0] as { variations: string[] }).variations).toEqual([
      "x",
      "y",
    ]);
    // Does not mutate input
    expect((revision.rules![0] as { variations: string[] }).variations).toEqual(
      ["a", "b"],
    );
  });

  it("overlays updates onto every targeted rule when multiple ids are given", () => {
    const rule0: FeatureRule = {
      id: "r0",
      type: "experiment-ref",
      experimentId: "exp0",
      variations: ["a", "b"],
      enabled: true,
    } as FeatureRule;
    const rule1: FeatureRule = {
      id: "r1",
      type: "experiment-ref",
      experimentId: "exp1",
      variations: ["c", "d"],
      enabled: false,
    } as FeatureRule;
    const revision = makeRevision([{ ...rule0 }, { ...rule1 }]);

    const next = applyPartialFeatureRuleUpdatesToRevision(
      revision,
      ["r0", "r1"],
      { variations: ["x", "y"] },
    );

    expect((next.rules![0] as { variations: string[] }).variations).toEqual([
      "x",
      "y",
    ]);
    expect((next.rules![1] as { variations: string[] }).variations).toEqual([
      "x",
      "y",
    ]);
    // Original identity (experimentId) is preserved on the overlay
    expect((next.rules![0] as { experimentId: string }).experimentId).toEqual(
      "exp0",
    );
    expect((next.rules![1] as { experimentId: string }).experimentId).toEqual(
      "exp1",
    );
  });

  it("is idempotent when the same ruleId appears multiple times in matches", () => {
    const rule: FeatureRule = {
      id: "r1",
      type: "force",
      value: "true",
      enabled: true,
    } as FeatureRule;
    const revision = makeRevision([{ ...rule }]);

    const next = applyPartialFeatureRuleUpdatesToRevision(
      revision,
      ["r1", "r1", "r1"],
      { enabled: false },
    );

    expect(next.rules).toHaveLength(1);
    expect((next.rules![0] as { enabled: boolean }).enabled).toBe(false);
  });

  it("returns the revision unchanged for an empty match list", () => {
    const revision = makeRevision([
      {
        id: "r1",
        type: "force",
        value: "true",
        enabled: true,
      } as unknown as FeatureRule,
    ]);
    const next = applyPartialFeatureRuleUpdatesToRevision(revision, [], {
      enabled: false,
    });
    // Reference-equal short-circuit — no-op is cheap.
    expect(next).toBe(revision);
  });

  it("silently ignores ruleIds that don't match any rule", () => {
    // No "throw on unknown rule" — see the helper's JSDoc for rationale.
    const rule: FeatureRule = {
      id: "r1",
      type: "force",
      value: "true",
      enabled: true,
    } as FeatureRule;
    const revision = makeRevision([{ ...rule }]);

    const next = applyPartialFeatureRuleUpdatesToRevision(
      revision,
      ["r_missing"],
      { enabled: false },
    );
    expect((next.rules![0] as { enabled: boolean }).enabled).toBe(true);
  });

  it("does not mutate the input revision or its rules array", () => {
    const rule: FeatureRule = {
      id: "r1",
      type: "force",
      value: "true",
      enabled: true,
    } as FeatureRule;
    const revision = makeRevision([{ ...rule }]);
    const snapshot = JSON.stringify(revision);

    applyPartialFeatureRuleUpdatesToRevision(revision, ["r1"], {
      enabled: false,
    });

    expect(JSON.stringify(revision)).toBe(snapshot);
  });
});
