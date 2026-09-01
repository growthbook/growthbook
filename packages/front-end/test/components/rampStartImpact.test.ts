import type { FeatureRule } from "shared/types/feature";
import {
  countRampFallthroughRules,
  getRampStartImpact,
} from "@/components/Features/RuleModal/rampStartImpact";

function forceRule(overrides: Partial<FeatureRule> = {}): FeatureRule {
  return {
    type: "force",
    id: "fr_force",
    description: "",
    value: "on",
    allEnvironments: true,
    ...overrides,
  } as FeatureRule;
}

function rolloutRule(
  coverage: number,
  overrides: Partial<FeatureRule> = {},
): FeatureRule {
  return {
    type: "rollout",
    id: "fr_rollout",
    description: "",
    value: "on",
    coverage,
    hashAttribute: "id",
    allEnvironments: true,
    ...overrides,
  } as FeatureRule;
}

describe("getRampStartImpact", () => {
  it("returns null when the rule is not live", () => {
    expect(
      getRampStartImpact({
        liveRule: undefined,
        firstStepCoveragePct: 1,
        hasDelayedStart: false,
      }),
    ).toBeNull();
  });

  it("returns null when the live rule is disabled", () => {
    expect(
      getRampStartImpact({
        liveRule: forceRule({ enabled: false }),
        firstStepCoveragePct: 1,
        hasDelayedStart: false,
      }),
    ).toBeNull();
  });

  it("flags a drop from a live force rule (100%) to step 0", () => {
    expect(
      getRampStartImpact({
        liveRule: forceRule(),
        firstStepCoveragePct: 1,
        hasDelayedStart: false,
      }),
    ).toEqual({ kind: "coverage-drop", fromPct: 100, toPct: 1 });
  });

  it("flags a drop from a live rollout rule when step 0 is below its coverage", () => {
    expect(
      getRampStartImpact({
        liveRule: rolloutRule(0.4),
        firstStepCoveragePct: 10,
        hasDelayedStart: false,
      }),
    ).toEqual({ kind: "coverage-drop", fromPct: 40, toPct: 10 });
  });

  it("does not flag when step 0 is at or above the live coverage", () => {
    expect(
      getRampStartImpact({
        liveRule: rolloutRule(0.4),
        firstStepCoveragePct: 50,
        hasDelayedStart: false,
      }),
    ).toBeNull();
    expect(
      getRampStartImpact({
        liveRule: rolloutRule(0.4),
        firstStepCoveragePct: 40,
        hasDelayedStart: false,
      }),
    ).toBeNull();
  });

  it("does not flag a live rollout already at 0% coverage", () => {
    expect(
      getRampStartImpact({
        liveRule: rolloutRule(0),
        firstStepCoveragePct: 1,
        hasDelayedStart: false,
      }),
    ).toBeNull();
  });

  it("flags a delayed start on a live rule regardless of step coverage", () => {
    expect(
      getRampStartImpact({
        liveRule: forceRule(),
        firstStepCoveragePct: undefined,
        hasDelayedStart: true,
      }),
    ).toEqual({ kind: "disabled-until-start", liveCoveragePct: 100 });
  });

  it("returns null when the ramp has no coverage steps and starts immediately", () => {
    expect(
      getRampStartImpact({
        liveRule: forceRule(),
        firstStepCoveragePct: undefined,
        hasDelayedStart: false,
      }),
    ).toBeNull();
  });
});

describe("countRampFallthroughRules", () => {
  it("reports no rules below when the target is last", () => {
    expect(
      countRampFallthroughRules({ rules: [forceRule()] }, "fr_force"),
    ).toBe(0);
  });

  it("counts enabled rules below the target, not those above", () => {
    expect(
      countRampFallthroughRules(
        {
          rules: [
            forceRule({ id: "fr_above" }),
            forceRule({ id: "fr_target" }),
            forceRule({ id: "fr_below1" }),
            forceRule({ id: "fr_below2" }),
          ],
        },
        "fr_target",
      ),
    ).toBe(2);
  });

  it("ignores disabled rules below the target", () => {
    expect(
      countRampFallthroughRules(
        {
          rules: [
            forceRule({ id: "fr_target" }),
            forceRule({ id: "fr_below", enabled: false }),
          ],
        },
        "fr_target",
      ),
    ).toBe(0);
  });

  it("ignores rules below with no shared environment", () => {
    expect(
      countRampFallthroughRules(
        {
          rules: [
            forceRule({
              id: "fr_target",
              allEnvironments: false,
              environments: ["production"],
            }),
            forceRule({
              id: "fr_below",
              allEnvironments: false,
              environments: ["staging"],
            }),
          ],
        },
        "fr_target",
      ),
    ).toBe(0);
  });

  it("counts rules below that share an environment", () => {
    expect(
      countRampFallthroughRules(
        {
          rules: [
            forceRule({
              id: "fr_target",
              allEnvironments: false,
              environments: ["production"],
            }),
            forceRule({
              id: "fr_below",
              allEnvironments: false,
              environments: ["production", "staging"],
            }),
          ],
        },
        "fr_target",
      ),
    ).toBe(1);
  });

  it("treats legacy rules with no env fields as applying to all environments", () => {
    // Pre-v2 rules may lack both allEnvironments and environments; the
    // canonical semantics (ruleAppliesToEnv) treat that as permissive.
    const legacyRule = (id: string): FeatureRule =>
      ({ type: "force", id, description: "", value: "on" }) as FeatureRule;
    expect(
      countRampFallthroughRules(
        {
          rules: [
            forceRule({
              id: "fr_target",
              allEnvironments: false,
              environments: ["production"],
            }),
            legacyRule("fr_below_legacy"),
          ],
        },
        "fr_target",
      ),
    ).toBe(1);
    expect(
      countRampFallthroughRules(
        {
          rules: [
            legacyRule("fr_target_legacy"),
            forceRule({
              id: "fr_below",
              allEnvironments: false,
              environments: ["staging"],
            }),
          ],
        },
        "fr_target_legacy",
      ),
    ).toBe(1);
  });

  it("reports no rules below when the rule id is unknown (draft-only rule)", () => {
    expect(
      countRampFallthroughRules({ rules: [forceRule()] }, "fr_not_saved_yet"),
    ).toBe(0);
  });
});
