import { FeatureInterface } from "shared/types/feature";
import {
  getSafeRolloutRuleFromFeature,
  shouldSkipScheduledSafeRolloutSnapshot,
} from "back-end/src/routers/safe-rollout/safe-rollout.helper";

function makeFeature(overrides?: Partial<FeatureInterface>): FeatureInterface {
  return {
    id: "feat_test",
    project: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    defaultValue: "false",
    organization: "org-1",
    owner: "",
    valueType: "boolean",
    archived: false,
    description: "",
    version: 1,
    environmentSettings: {
      production: { enabled: true },
    },
    rules: [],
    ...overrides,
  } as FeatureInterface;
}

const rampRolloutRule = {
  type: "rollout",
  id: "rule_ramp",
  description: "",
  enabled: true,
  value: "true",
  coverage: 0.25,
  hashAttribute: "id",
  seed: "seed",
  allEnvironments: true,
};

function classicSafeRolloutRule(enabled: boolean) {
  return {
    type: "safe-rollout",
    id: "rule_sr",
    description: "",
    enabled,
    safeRolloutId: "sr_1",
    controlValue: "false",
    variationValue: "true",
    status: "running",
    hashAttribute: "id",
    seed: "seed",
    trackingKey: "tk",
    allEnvironments: true,
  };
}

describe("getSafeRolloutRuleFromFeature", () => {
  it("returns null for a ramp-monitored feature (no safe-rollout rule)", () => {
    const feature = makeFeature({ rules: [rampRolloutRule] as never });
    expect(getSafeRolloutRuleFromFeature(feature, "sr_1")).toBeNull();
  });

  it("returns the matching safe-rollout rule for a classic rollout", () => {
    const feature = makeFeature({
      rules: [classicSafeRolloutRule(true)] as never,
    });
    expect(getSafeRolloutRuleFromFeature(feature, "sr_1")?.id).toBe("rule_sr");
  });

  it("skips rules in disabled environments when asked", () => {
    const feature = makeFeature({
      environmentSettings: { production: { enabled: false } } as never,
      rules: [classicSafeRolloutRule(true)] as never,
    });
    expect(getSafeRolloutRuleFromFeature(feature, "sr_1", true)).toBeNull();
  });
});

describe("shouldSkipScheduledSafeRolloutSnapshot", () => {
  it("does not skip a ramp-linked rollout even with no safe-rollout rule", () => {
    const feature = makeFeature({ rules: [rampRolloutRule] as never });
    expect(
      shouldSkipScheduledSafeRolloutSnapshot(feature, {
        id: "sr_1",
        rampScheduleId: "rs_1",
      }),
    ).toBe(false);
  });

  it("does not skip a classic rollout with an enabled safe-rollout rule", () => {
    const feature = makeFeature({
      rules: [classicSafeRolloutRule(true)] as never,
    });
    expect(
      shouldSkipScheduledSafeRolloutSnapshot(feature, { id: "sr_1" }),
    ).toBe(false);
  });

  it("skips a classic rollout whose safe-rollout rule is disabled", () => {
    const feature = makeFeature({
      rules: [classicSafeRolloutRule(false)] as never,
    });
    expect(
      shouldSkipScheduledSafeRolloutSnapshot(feature, { id: "sr_1" }),
    ).toBe(true);
  });

  it("skips a classic rollout whose safe-rollout rule is missing", () => {
    const feature = makeFeature({ rules: [rampRolloutRule] as never });
    expect(
      shouldSkipScheduledSafeRolloutSnapshot(feature, { id: "sr_1" }),
    ).toBe(true);
  });
});
