import { FeatureInterface } from "shared/types/feature";
import { FeatureDefinition } from "shared/types/sdk";
import { GrowthBook } from "@growthbook/growthbook";
import { ConstantValueMap } from "shared/sdk-versioning";
import { getFeatureDefinition } from "back-end/src/util/features";
import { RampMonitoredRuleInfo } from "back-end/src/models/RampScheduleModel";

function makeRolloutFeature(
  overrides?: Partial<FeatureInterface>,
): FeatureInterface {
  return {
    id: "feat_test",
    project: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    defaultValue: "false",
    organization: "org-1",
    owner: "",
    valueType: "boolean" as const,
    archived: false,
    description: "",
    version: 1,
    environmentSettings: {
      production: { enabled: true },
    },
    rules: [
      {
        type: "rollout",
        id: "rule_1",
        description: "",
        enabled: true,
        value: "true",
        coverage: 0.8,
        hashAttribute: "id",
        seed: "test-seed",
        allEnvironments: true,
      },
    ],
    ...overrides,
  } as FeatureInterface;
}

function getDefinition(
  feature: FeatureInterface,
  rampMonitoredRuleMap?: Map<string, RampMonitoredRuleInfo>,
  constantMap?: ConstantValueMap,
): FeatureDefinition | null {
  return getFeatureDefinition({
    feature,
    environment: "production",
    groupMap: new Map(),
    experimentMap: new Map(),
    safeRolloutMap: new Map(),
    rampMonitoredRuleMap,
    constantMap,
  });
}

function monitoredMap(
  ruleId: string,
  overrides?: Partial<RampMonitoredRuleInfo>,
): Map<string, RampMonitoredRuleInfo> {
  return new Map([
    [
      ruleId,
      {
        featureId: "feat_test",
        rampScheduleId: "rs_abc",
        ...overrides,
      },
    ],
  ]);
}

describe("getBucketRanges non-adjacent layout (coverage = 2 * step.coverage)", () => {
  // The server sets rule.coverage = min(step.coverage * 2, 1).
  // SDK's getBucketRanges(n, coverage, weights) accumulates `start` by raw weight,
  // not coverage*weight, so with weights=[0.5,0.5]:
  //   var0: start=0.0, end = 0   + coverage*0.5 = step.coverage
  //   var1: start=0.5, end = 0.5 + coverage*0.5 = 0.5 + step.coverage
  // This is the formula (from sdk-js/src/util.ts):
  //   let cumulative = 0;
  //   weights.map(w => { start = cumulative; cumulative += w; return [start, start + coverage*w]; })
  function simulateBucketRanges(
    ruleCoverage: number,
  ): [[number, number], [number, number]] {
    const weights = [0.5, 0.5];
    const cov = Math.min(Math.max(ruleCoverage, 0), 1);
    let cumulative = 0;
    return weights.map((w) => {
      const start = cumulative;
      cumulative += w;
      return [start, start + cov * w] as [number, number];
    }) as [[number, number], [number, number]];
  }

  it.each([
    [0.1, 0.2, [0, 0.1], [0.5, 0.6]],
    [0.25, 0.5, [0, 0.25], [0.5, 0.75]],
    [0.4, 0.8, [0, 0.4], [0.5, 0.9]],
    [0.5, 1.0, [0, 0.5], [0.5, 1.0]], // max valid monitored-step coverage
  ])(
    "step.coverage=%p → rule.coverage=%p → treatment=%p, control=%p",
    (stepCov, ruleCov, expectedTreatment, expectedControl) => {
      const ranges = simulateBucketRanges(ruleCov);
      expect(ranges[0]).toEqual(expectedTreatment);
      expect(ranges[1]).toEqual(expectedControl);
    },
  );
});

describe("ramp-monitored SDK payload", () => {
  describe("map lookup and conversion", () => {
    it("produces a standard rollout when no map is provided", () => {
      const def = getDefinition(makeRolloutFeature());
      expect(def).not.toBeNull();
      const rule = def!.rules![0];
      expect(rule.force).toBe(true);
      expect(rule.coverage).toBe(0.8);
      expect(rule.variations).toBeUndefined();
      expect(rule.filters).toBeUndefined();
    });

    it("unmonitored rollout emits hashVersion when explicitly set on rule", () => {
      const feature = makeRolloutFeature({
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: "true",
            coverage: 0.5,
            hashAttribute: "id",
            hashVersion: 2,
            allEnvironments: true,
          },
        ],
      });
      const def = getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: new Map(),
        experimentMap: new Map(),
        safeRolloutMap: new Map(),
        rampMonitoredRuleMap: new Map(),
        capabilities: ["bucketingV2"],
      });
      const rule = def!.rules![0];
      expect(rule.hashVersion).toBe(2);
    });

    it("unmonitored rollout without hashVersion does not emit hashVersion (SDK defaults to v1)", () => {
      const def = getDefinition(makeRolloutFeature());
      const rule = def!.rules![0];
      expect(rule.hashVersion).toBeUndefined();
    });

    it("produces a standard rollout when map has no matching rule", () => {
      const def = getDefinition(
        makeRolloutFeature(),
        monitoredMap("rule_other"),
      );
      const rule = def!.rules![0];
      expect(rule.force).toBe(true);
      expect(rule.variations).toBeUndefined();
    });

    it("converts to experiment rule when map matches rule id", () => {
      // Default fixture has step.coverage=0.8 (API-rejected for monitored steps,
      // graceful degradation). coverage=min(0.8*2,1)=1 → SDK uses full hash space.
      const def = getDefinition(makeRolloutFeature(), monitoredMap("rule_1"));
      const rule = def!.rules![0];

      expect(rule.force).toBeUndefined();
      expect(rule.variations).toEqual([true, false]);
      expect(rule.weights).toEqual([0.5, 0.5]);
      expect(rule.coverage).toBe(1); // min(0.8*2, 1)=1
      expect(rule.ranges).toBeUndefined(); // no explicit ranges — SDK uses getBucketRanges
      expect(rule.filters).toBeUndefined();
      expect(rule.hashAttribute).toBe("id");
      expect(rule.seed).toBe("test-seed");
      expect(rule.key).toBe("ramp_rs_abc");
      expect(rule.phase).toBe("0");
      expect(rule.disableStickyBucketing).toBe(true);
    });

    it("merges a sparse rule value onto the default for monitored variations", () => {
      const feature = makeRolloutFeature({
        valueType: "json" as const,
        defaultValue: JSON.stringify({ a: 1, b: 2 }),
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: JSON.stringify({ b: 9 }),
            sparse: true,
            coverage: 0.5,
            hashAttribute: "id",
            seed: "test-seed",
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);
      const def = getDefinition(feature, monitoredMap("rule_1"));
      const rule = def!.rules![0];
      // Treatment merges the patch onto the default; control is the full default.
      expect(rule.variations).toEqual([
        { a: 1, b: 9 },
        { a: 1, b: 2 },
      ]);
    });

    it("serves the resolved base config on the control arm for a config-backed monitored ramp", () => {
      // Regression: post-lock, a config-backed default is a pure config stored as
      // a bare `{}` (the base). The monitored-ramp control arm must resolve that
      // config, not ship the literal `{}`, or the holdback slice would receive an
      // empty object while treatment + fall-through default serve the config.
      const feature = makeRolloutFeature({
        valueType: "json" as const,
        baseConfig: "base",
        defaultValue: "{}",
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: JSON.stringify({ x: 2 }),
            sparse: true,
            coverage: 0.5,
            hashAttribute: "id",
            seed: "test-seed",
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);

      const constantMap: ConstantValueMap = new Map([
        [
          "config:base",
          {
            type: "json" as const,
            source: "config" as const,
            value: '{"cfg":1}',
          },
        ],
      ]);

      const def = getDefinition(feature, monitoredMap("rule_1"), constantMap);
      const rule = def!.rules![0];
      // Treatment = base + patch; control = the resolved base (NOT a bare `{}`).
      expect(rule.variations).toEqual([{ cfg: 1, x: 2 }, { cfg: 1 }]);
      // The fall-through default resolves the same base config.
      expect(def!.defaultValue).toEqual({ cfg: 1 });
    });

    it("coverage=2*step.coverage produces non-adjacent arms via getBucketRanges", () => {
      // With step.coverage=0.25: rule.coverage=0.5
      // getBucketRanges(2, 0.5, [0.5,0.5]) → [0,0.25],[0.5,0.75]
      // treatment matches rollout [0,0.25); control is non-adjacent [0.5,0.75)
      const feature = makeRolloutFeature({
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: "true",
            coverage: 0.25,
            hashAttribute: "id",
            seed: "test-seed",
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);
      const def = getDefinition(feature, monitoredMap("rule_1"));
      const rule = def!.rules![0];

      expect(rule.coverage).toBe(0.5); // 0.25 * 2
      expect(rule.ranges).toBeUndefined();
      expect(rule.weights).toEqual([0.5, 0.5]);
    });

    it("clamps coverage above 1", () => {
      const feature = makeRolloutFeature({
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: "true",
            coverage: 1.5,
            hashAttribute: "id",
            seed: "seed-clamp",
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);
      const def = getDefinition(feature, monitoredMap("rule_1"));
      const rule = def!.rules![0];
      expect(rule.coverage).toBe(1); // min(1.5*2, 1) = 1
      expect(rule.ranges).toBeUndefined();
      expect(rule.filters).toBeUndefined();
    });

    it("always uses ramp schedule id as tracking key (not safeRolloutId)", () => {
      const def = getDefinition(
        makeRolloutFeature(),
        monitoredMap("rule_1", { safeRolloutId: "sr_xyz" }),
      );
      expect(def!.rules![0].key).toBe("ramp_rs_abc");
    });

    it("variation 0 is treatment, variation 1 is control", () => {
      const feature = makeRolloutFeature({
        valueType: "json" as const,
        defaultValue: '{"state":"off"}',
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: '{"state":"on"}',
            coverage: 0.6,
            hashAttribute: "id",
            seed: "seed-a",
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);

      const def = getDefinition(feature, monitoredMap("rule_1"));
      const rule = def!.rules![0];
      expect(rule.variations![0]).toEqual({ state: "on" });
      expect(rule.variations![1]).toEqual({ state: "off" });
    });

    it("omits filter when coverage is 1 (100%)", () => {
      const feature = makeRolloutFeature({
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: "true",
            coverage: 1.0,
            hashAttribute: "id",
            seed: "seed-full",
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);

      const def = getDefinition(feature, monitoredMap("rule_1"));
      const rule = def!.rules![0];
      expect(rule.variations).toEqual([true, false]);
      expect(rule.filters).toBeUndefined();
      expect(rule.ranges).toBeUndefined();
      expect(rule.coverage).toBe(1); // min(1.0*2, 1) = 1
    });

    it("falls back to standard rollout when rule has no hashAttribute", () => {
      const feature = makeRolloutFeature({
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: "true",
            coverage: 0.5,
            hashAttribute: "",
            seed: "seed",
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);

      const def = getDefinition(feature, monitoredMap("rule_1"));
      const rule = def!.rules![0];
      expect(rule.force).toBe(true);
      expect(rule.variations).toBeUndefined();
    });

    it("uses the persisted seed as payload seed even when it equals rule.id", () => {
      // Rules stamped while the backfill wrote seed = rule.id keep that value
      // (an explicit seed is never rewritten). The monitored payload uses
      // r.seed verbatim, and the SDK's own rollout path does too, so both hash
      // consistently and no variation hopping occurs.
      const feature = makeRolloutFeature({
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: "true",
            coverage: 0.5,
            hashAttribute: "id",
            seed: "rule_1", // backfilled: seed = rule.id
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);

      const def = getDefinition(feature, monitoredMap("rule_1"));
      const rule = def!.rules![0];
      expect(rule.variations).toEqual([true, false]);
      expect(rule.seed).toBe("rule_1");
      expect(rule.filters).toBeUndefined();
      expect(rule.coverage).toBe(1); // min(0.5*2, 1) = 1
      expect(rule.ranges).toBeUndefined();
    });

    it("falls back to feature.id as payload seed when monitored rollout has no seed (pre-backfill rule)", () => {
      // For older rules that pre-date the seed-at-write-time backfill, the monitored
      // payload falls back to feature.id — matching the SDK's own `rule.seed || featureId`
      // fallback for force-coverage rules so that users hash identically on both paths.
      const feature = makeRolloutFeature({
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: "true",
            coverage: 0.5,
            hashAttribute: "id",
            // no seed — pre-backfill rule
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);

      const def = getDefinition(feature, monitoredMap("rule_1"));
      const rule = def!.rules![0];
      expect(rule.variations).toEqual([true, false]);
      // SDK fallback: rule.seed || featureId = feature.id (not rule.id)
      expect(rule.seed).toBe(feature.id);
      expect(rule.filters).toBeUndefined();
      expect(rule.coverage).toBe(1); // min(0.5*2, 1) = 1
      expect(rule.ranges).toBeUndefined();
    });

    it("includes experiment name when includeExperimentNames is set", () => {
      const def = getFeatureDefinition({
        feature: makeRolloutFeature(),
        environment: "production",
        groupMap: new Map(),
        experimentMap: new Map(),
        safeRolloutMap: new Map(),
        rampMonitoredRuleMap: monitoredMap("rule_1"),
        includeExperimentNames: true,
      });
      const rule = def!.rules![0];
      expect(rule.name).toBe("feat_test - Monitored Ramp");
      expect(rule.meta).toEqual([
        { key: "0", name: "Variation" },
        { key: "1", name: "Control", passthrough: true },
      ]);
    });

    it("bucketingV2 SDK receives coverage=2*step.coverage and seed", () => {
      // Default fixture step.coverage=0.8 (API-rejected >0.5, graceful degradation)
      // rule.coverage = min(0.8*2, 1) = 1; no explicit ranges.
      const def = getFeatureDefinition({
        feature: makeRolloutFeature(),
        environment: "production",
        groupMap: new Map(),
        experimentMap: new Map(),
        safeRolloutMap: new Map(),
        rampMonitoredRuleMap: monitoredMap("rule_1"),
        capabilities: ["bucketingV2"],
      });
      const rule = def!.rules![0];
      expect(rule.ranges).toBeUndefined();
      expect(rule.coverage).toBe(1); // min(0.8*2, 1)
      expect(rule.seed).toBe("test-seed");
      expect(rule.hashVersion).toBe(1); // old rule has no hashVersion → falls back to 1
    });

    it("monitored experiment inherits hashVersion:2 from the rollout rule", () => {
      // step.coverage=0.4 → rule.coverage=0.8; getBucketRanges(2,0.8,[0.5,0.5])
      // produces treatment=[0,0.4), control=[0.5,0.9) — non-adjacent, stable bucketing
      const feature = makeRolloutFeature({
        rules: [
          {
            type: "rollout",
            id: "rule_1",
            description: "",
            enabled: true,
            value: "true",
            coverage: 0.4,
            hashAttribute: "id",
            seed: "test-seed",
            hashVersion: 2,
            allEnvironments: true,
          },
        ],
      });
      const def = getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: new Map(),
        experimentMap: new Map(),
        safeRolloutMap: new Map(),
        rampMonitoredRuleMap: monitoredMap("rule_1"),
        capabilities: ["bucketingV2"],
      });
      const rule = def!.rules![0];
      expect(rule.hashVersion).toBe(2);
      expect(rule.coverage).toBe(0.8); // 0.4 * 2
      expect(rule.ranges).toBeUndefined();
    });

    it("non-bucketingV2 SDK receives coverage=2*step.coverage (old SDKs use same getBucketRanges)", () => {
      // coverage is a STRICT key so it reaches all SDKs. Old SDKs call the same
      // getBucketRanges with this value and get the correct non-adjacent arms.
      const def = getFeatureDefinition({
        feature: makeRolloutFeature(),
        environment: "production",
        groupMap: new Map(),
        experimentMap: new Map(),
        safeRolloutMap: new Map(),
        rampMonitoredRuleMap: monitoredMap("rule_1"),
        capabilities: [],
      });
      const rule = def!.rules![0];
      expect(rule.ranges).toBeUndefined();
      expect(rule.seed).toBeUndefined();
      expect(rule.coverage).toBe(1); // min(0.8*2,1); present as STRICT key for old SDKs
      expect(rule.variations).toEqual([true, false]);
    });
  });

  describe("hash space continuity across monitored/unmonitored transitions", () => {
    const SEED = "continuity-seed";
    const FEATURE_ID = "f_cont";
    const TREATMENT = "treatment";
    const CONTROL = "default";

    function makeRolloutPayload(coverage: number): FeatureDefinition {
      return {
        defaultValue: CONTROL,
        rules: [
          {
            force: TREATMENT,
            coverage,
            hashAttribute: "id",
            seed: SEED,
          },
        ],
      };
    }

    function makeMonitoredPayload(coverage: number): FeatureDefinition {
      // Mirror the server: coverage = min(step.coverage * 2, 1).
      // getBucketRanges(2, 2c, [0.5,0.5]) naturally produces
      //   treatment=[0, c)  control=[0.5, 0.5+c)  — non-adjacent, stable bucketing.
      return {
        defaultValue: CONTROL,
        rules: [
          {
            variations: [TREATMENT, CONTROL],
            weights: [0.5, 0.5],
            coverage: Math.min(coverage * 2, 1),
            hashAttribute: "id",
            seed: SEED,
            key: "ramp_test",
            meta: [{ key: "0" }, { key: "1", passthrough: true }],
            phase: "0",
          },
        ],
      };
    }

    function evaluateForUser(
      userId: string,
      features: Record<string, FeatureDefinition>,
    ): {
      value: string;
      source: string;
      variationIndex?: number;
    } {
      const gb = new GrowthBook({
        features,
        user: { id: userId },
      });
      const result = gb.evalFeature(FEATURE_ID);
      const variationIndex = result.experimentResult?.variationId;
      gb.destroy();
      return {
        value: result.value as string,
        source: result.source,
        variationIndex:
          variationIndex !== undefined ? Number(variationIndex) : undefined,
      };
    }

    it("rollout treatment users bucket into variation 0 (treatment) of monitored experiment", () => {
      const userIds = Array.from({ length: 200 }, (_, i) => `var_idx_${i}`);
      const rolloutCoverage = 0.4;
      const monitoredCoverage = 0.8;

      const rolloutPayload = makeRolloutPayload(rolloutCoverage);
      const monitoredPayload = makeMonitoredPayload(monitoredCoverage);

      let checkedCount = 0;

      for (const userId of userIds) {
        const rolloutResult = evaluateForUser(userId, {
          [FEATURE_ID]: rolloutPayload,
        });

        if (rolloutResult.value === TREATMENT) {
          checkedCount++;
          const monitoredResult = evaluateForUser(userId, {
            [FEATURE_ID]: monitoredPayload,
          });

          expect(monitoredResult.source).toBe("experiment");
          expect(monitoredResult.value).toBe(TREATMENT);
          expect(monitoredResult.variationIndex).toBe(0);
        }
      }

      expect(checkedCount).toBeGreaterThan(10);
    });

    it("users in rollout treatment stay in treatment during monitored step", () => {
      const userIds = Array.from({ length: 200 }, (_, i) => `user_${i}`);
      const rolloutCoverage = 0.4;
      const monitoredCoverage = 0.8;

      const rolloutPayload = makeRolloutPayload(rolloutCoverage);
      const monitoredPayload = makeMonitoredPayload(monitoredCoverage);

      let treatmentUsersWhoHopped = 0;
      let treatmentCount = 0;

      for (const userId of userIds) {
        const rolloutResult = evaluateForUser(userId, {
          [FEATURE_ID]: rolloutPayload,
        });

        if (rolloutResult.value === TREATMENT) {
          treatmentCount++;
          const monitoredResult = evaluateForUser(userId, {
            [FEATURE_ID]: monitoredPayload,
          });
          if (monitoredResult.value !== TREATMENT) {
            treatmentUsersWhoHopped++;
          }
        }
      }

      expect(treatmentCount).toBeGreaterThan(0);
      expect(treatmentUsersWhoHopped).toBe(0);
    });

    it("users excluded from rollout remain excluded from monitored experiment", () => {
      const userIds = Array.from({ length: 200 }, (_, i) => `user_${i}`);
      const coverage = 0.6;

      const rolloutPayload = makeRolloutPayload(coverage);
      const monitoredPayload = makeMonitoredPayload(coverage);

      let excludedUsersWhoGotIn = 0;

      for (const userId of userIds) {
        const rolloutResult = evaluateForUser(userId, {
          [FEATURE_ID]: rolloutPayload,
        });
        const monitoredResult = evaluateForUser(userId, {
          [FEATURE_ID]: monitoredPayload,
        });

        if (
          rolloutResult.source === "defaultValue" &&
          monitoredResult.source !== "defaultValue"
        ) {
          excludedUsersWhoGotIn++;
        }
      }

      expect(excludedUsersWhoGotIn).toBe(0);
    });

    it("treatment users in monitored step stay in treatment after step-up to higher rollout", () => {
      const userIds = Array.from({ length: 200 }, (_, i) => `user_${i}`);
      const monitoredCoverage = 0.6;
      const nextRolloutCoverage = 0.8;

      const monitoredPayload = makeMonitoredPayload(monitoredCoverage);
      const nextRolloutPayload = makeRolloutPayload(nextRolloutCoverage);

      let treatmentUsersWhoLost = 0;
      let treatmentCount = 0;

      for (const userId of userIds) {
        const monitoredResult = evaluateForUser(userId, {
          [FEATURE_ID]: monitoredPayload,
        });

        if (monitoredResult.value === TREATMENT) {
          treatmentCount++;
          const nextResult = evaluateForUser(userId, {
            [FEATURE_ID]: nextRolloutPayload,
          });
          if (nextResult.value !== TREATMENT) {
            treatmentUsersWhoLost++;
          }
        }
      }

      expect(treatmentCount).toBeGreaterThan(0);
      expect(treatmentUsersWhoLost).toBe(0);
    });

    it("monitored experiment: treatment arm equals rollout coverage, control arm fills remaining hash space", () => {
      const userIds = Array.from({ length: 2000 }, (_, i) => `split_${i}`);
      // coverage=0.4: treatment=[0,0.4]=40%, control=[0.4,0.8]=40%, unenrolled=20%
      const coverage = 0.4;

      const monitoredPayload = makeMonitoredPayload(coverage);

      let treatmentCount = 0;
      let controlPassthroughCount = 0;
      let unenrolledCount = 0;

      for (const userId of userIds) {
        const result = evaluateForUser(userId, {
          [FEATURE_ID]: monitoredPayload,
        });
        if (result.value === TREATMENT && result.source === "experiment") {
          treatmentCount++;
        } else if (
          result.value === CONTROL &&
          result.source === "defaultValue"
        ) {
          controlPassthroughCount++;
        } else {
          unenrolledCount++;
        }
      }

      const total = treatmentCount + controlPassthroughCount + unenrolledCount;
      expect(total).toBe(userIds.length);

      // Treatment arm ≈ coverage% of all users
      const treatmentRate = treatmentCount / userIds.length;
      expect(treatmentRate).toBeGreaterThan(coverage - 0.05);
      expect(treatmentRate).toBeLessThan(coverage + 0.05);

      // Control (passthrough) + unenrolled both appear as defaultValue —
      // combined they are the remaining (1 - coverage)% of users
      const nonTreatmentRate =
        (controlPassthroughCount + unenrolledCount) / userIds.length;
      expect(nonTreatmentRate).toBeGreaterThan(1 - coverage - 0.05);
      expect(nonTreatmentRate).toBeLessThan(1 - coverage + 0.05);
    });

    it("enrollment rate matches coverage exactly (no double-application)", () => {
      // Treatment arm should be exactly coverage% of users.
      // Using a non-passthrough variant so both arms report source="experiment".
      const userIds = Array.from({ length: 1000 }, (_, i) => `enroll_${i}`);
      const coverages = [0.25, 0.5, 0.75];

      for (const coverage of coverages) {
        // Mirror server: rule.coverage = min(step.coverage * 2, 1)
        const payload: FeatureDefinition = {
          defaultValue: CONTROL,
          rules: [
            {
              variations: [TREATMENT, CONTROL],
              weights: [0.5, 0.5],
              coverage: Math.min(coverage * 2, 1),
              hashAttribute: "id",
              seed: SEED,
              key: "ramp_test",
              meta: [{ key: "0" }, { key: "1" }],
              phase: "0",
            },
          ],
        };

        let treatmentCount = 0;
        let controlCount = 0;
        for (const userId of userIds) {
          const result = evaluateForUser(userId, { [FEATURE_ID]: payload });
          if (result.source === "experiment") {
            if (result.value === TREATMENT) treatmentCount++;
            else controlCount++;
          }
        }

        // rule.coverage = min(step.coverage * 2, 1)
        // getBucketRanges(2, ruleCoverage, [0.5, 0.5]):
        //   treatment arm = [0, ruleCoverage/2) = [0, step.coverage) capped at 0.5
        //   control arm   = [0.5, 0.5 + ruleCoverage/2) capped at 0.5
        const effectiveArm = Math.min(coverage, 0.5);
        const treatmentRate = treatmentCount / userIds.length;
        const controlRate = controlCount / userIds.length;
        expect(treatmentRate).toBeGreaterThan(effectiveArm - 0.05);
        expect(treatmentRate).toBeLessThan(effectiveArm + 0.05);
        expect(controlRate).toBeGreaterThan(effectiveArm - 0.05);
        expect(controlRate).toBeLessThan(effectiveArm + 0.05);
      }
    });

    it("enrollment boundary is consistent across rollout→monitored→rollout transitions", () => {
      const userIds = Array.from({ length: 500 }, (_, i) => `boundary_${i}`);
      const coverage = 0.5;

      const rolloutPayload = makeRolloutPayload(coverage);
      const monitoredPayload = makeMonitoredPayload(coverage);

      for (const userId of userIds) {
        const rollout1 = evaluateForUser(userId, {
          [FEATURE_ID]: rolloutPayload,
        });
        const monitored = evaluateForUser(userId, {
          [FEATURE_ID]: monitoredPayload,
        });
        const rollout2 = evaluateForUser(userId, {
          [FEATURE_ID]: rolloutPayload,
        });

        const inRollout = rollout1.value === TREATMENT;
        const inExperiment = monitored.source === "experiment";

        if (!inRollout) {
          expect(inExperiment).toBe(false);
        }

        expect(rollout1.value).toBe(rollout2.value);
      }
    });

    it("step-up in coverage only adds users, never drops existing treatment", () => {
      const userIds = Array.from({ length: 300 }, (_, i) => `stepup_${i}`);
      const coverages = [0.2, 0.4, 0.6, 0.8, 1.0];

      for (const userId of userIds) {
        let wasTreatment = false;
        for (const cov of coverages) {
          const result = evaluateForUser(userId, {
            [FEATURE_ID]: makeRolloutPayload(cov),
          });
          if (wasTreatment) {
            expect(result.value).toBe(TREATMENT);
          }
          if (result.value === TREATMENT) {
            wasTreatment = true;
          }
        }
      }
    });

    it("rollout treatment space and monitored variation-0 space are identical (bijection)", () => {
      // The treatment arm [0, coverage) is shared by both rollout and monitored
      // experiment variation 0. This verifies BOTH directions:
      //   rollout treatment  → monitored var-0
      //   monitored var-0    → rollout treatment
      // (var-1 passthrough means source="experiment" only fires for var-0)
      const userIds = Array.from({ length: 500 }, (_, i) => `bijection_${i}`);
      const coverage = 0.3;

      const rolloutPayload = makeRolloutPayload(coverage);
      const monitoredPayload = makeMonitoredPayload(coverage);

      for (const userId of userIds) {
        const rolloutResult = evaluateForUser(userId, {
          [FEATURE_ID]: rolloutPayload,
        });
        const monitoredResult = evaluateForUser(userId, {
          [FEATURE_ID]: monitoredPayload,
        });

        const inRollout = rolloutResult.value === TREATMENT;
        // passthrough on var-1: source="experiment" iff the user landed in var-0
        const inMonitoredVar0 = monitoredResult.source === "experiment";

        expect(inRollout).toBe(inMonitoredVar0);
      }
    });

    it("control arm is monotonically enrolled: step-up never drops or re-exposes existing control users", () => {
      // With non-adjacent ranges [0,C),[0.5,0.5+C), the control arm [0.5, 0.5+C)
      // strictly grows as C increases. A user who entered control at C₁ is still
      // in control at any C₂ > C₁ — they never exit and are never re-assigned.
      // Only users in [0.5+C₁, 0.5+C₂) are newly enrolled at the higher step.
      const userIds = Array.from({ length: 500 }, (_, i) => `ctrl_mono_${i}`);
      const stepCoverages = [0.1, 0.2, 0.3, 0.4, 0.5]; // all ≤ 0.5 → non-adjacent formula

      // Use non-passthrough variations so we can distinguish control-arm users
      // from truly unenrolled users (both would show "defaultValue" with passthrough).
      function makeNonPassthroughPayload(coverage: number): FeatureDefinition {
        return {
          defaultValue: "unenrolled",
          rules: [
            {
              variations: [TREATMENT, "control_arm"],
              weights: [0.5, 0.5],
              coverage: Math.min(coverage * 2, 1), // mirror server formula
              hashAttribute: "id",
              seed: SEED,
              key: "ctrl_mono_test",
              meta: [{ key: "0" }, { key: "1" }],
              phase: "0",
            },
          ],
        };
      }

      for (const userId of userIds) {
        let wasControl = false;
        for (const cov of stepCoverages) {
          const result = evaluateForUser(userId, {
            [FEATURE_ID]: makeNonPassthroughPayload(cov),
          });
          const isControl =
            result.source === "experiment" && result.value === "control_arm";
          if (wasControl) {
            // Once assigned to control, coverage increases must keep them in control
            expect(isControl).toBe(true);
          }
          if (isControl) wasControl = true;
        }
      }
    });

    it("monitored→unmonitored at same coverage: treatment users keep treatment", () => {
      const userIds = Array.from({ length: 300 }, (_, i) => `same_cov_${i}`);
      const coverage = 0.6;

      const monitoredPayload = makeMonitoredPayload(coverage);
      const rolloutPayload = makeRolloutPayload(coverage);

      let treatmentInMonitored = 0;
      let lostTreatment = 0;

      for (const userId of userIds) {
        const monResult = evaluateForUser(userId, {
          [FEATURE_ID]: monitoredPayload,
        });

        if (monResult.value === TREATMENT) {
          treatmentInMonitored++;
          const rolloutResult = evaluateForUser(userId, {
            [FEATURE_ID]: rolloutPayload,
          });
          if (rolloutResult.value !== TREATMENT) {
            lostTreatment++;
          }
        }
      }

      expect(treatmentInMonitored).toBeGreaterThan(0);
      expect(lostTreatment).toBe(0);
    });

    it("users in rollout treatment stay in treatment during monitored step with hashVersion: 2", () => {
      const userIds = Array.from({ length: 200 }, (_, i) => `user_v2_${i}`);
      const rolloutCoverage = 0.4;
      const monitoredCoverage = 0.8; // >0.5 graceful degradation; rule.coverage=min(1.6,1)=1

      const rolloutPayload: FeatureDefinition = {
        defaultValue: CONTROL,
        rules: [
          {
            force: TREATMENT,
            coverage: rolloutCoverage,
            hashAttribute: "id",
            seed: SEED,
            hashVersion: 2,
          },
        ],
      };

      const monitoredPayload: FeatureDefinition = {
        defaultValue: CONTROL,
        rules: [
          {
            variations: [TREATMENT, CONTROL],
            weights: [0.5, 0.5],
            coverage: Math.min(monitoredCoverage * 2, 1), // mirror server formula
            hashAttribute: "id",
            seed: SEED,
            key: "ramp_test_v2",
            meta: [{ key: "0" }, { key: "1", passthrough: true }],
            phase: "0",
            hashVersion: 2,
          },
        ],
      };

      let treatmentUsersWhoHopped = 0;
      let treatmentCount = 0;

      for (const userId of userIds) {
        const rolloutResult = evaluateForUser(userId, {
          [FEATURE_ID]: rolloutPayload,
        });

        if (rolloutResult.value === TREATMENT) {
          treatmentCount++;
          const monitoredResult = evaluateForUser(userId, {
            [FEATURE_ID]: monitoredPayload,
          });
          if (monitoredResult.value !== TREATMENT) {
            treatmentUsersWhoHopped++;
          }
        }
      }

      expect(treatmentCount).toBeGreaterThan(0);
      expect(treatmentUsersWhoHopped).toBe(0);
    });
  });

  describe("rules stamped with seed = rule.id keep bucketing consistently", () => {
    // An earlier version of the write-time backfill persisted seed = rule.id.
    // Those rules keep that seed (explicit seeds are never rewritten), and both
    // monitored and unmonitored payloads must carry it verbatim so the SDK
    // hashes users through the same space — i.e. no variation hopping.
    // (The backfill itself now writes the feature ID, matching the SDK's
    // no-seed fallback `rule.seed || featureId`.)
    const RULE_ID = "fr_backfill_rule";
    const FEATURE_ID = "feat_backfill";

    it("getFeatureDefinition uses rule.id as seed when the persisted seed is rule.id", () => {
      const feature = makeRolloutFeature({
        id: FEATURE_ID,
        rules: [
          {
            type: "rollout",
            id: RULE_ID,
            description: "",
            enabled: true,
            value: "true",
            coverage: 0.5,
            hashAttribute: "id",
            seed: RULE_ID, // stamped by the old backfill: seed === rule.id
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);

      const def = getDefinition(feature, monitoredMap(RULE_ID));
      const rule = def!.rules![0];
      expect(rule.seed).toBe(RULE_ID);
      expect(rule.seed).not.toBe(FEATURE_ID);
    });

    it("legacy-stamped rule: monitored and unmonitored payloads use the same seed", () => {
      // Rules may carry a persisted seed === rule.id. Both monitored (experiment)
      // and unmonitored (force-coverage) payloads must carry that same seed so the
      // SDK hashes users through the same space and no variation hopping can occur.
      const ruleId = "fr_backfill_rule";
      const feature = makeRolloutFeature({
        id: FEATURE_ID,
        rules: [
          {
            type: "rollout",
            id: ruleId,
            description: "",
            enabled: true,
            value: "true",
            coverage: 0.6,
            hashAttribute: "id",
            seed: ruleId, // backfilled
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);

      // Monitored path (experiment rule)
      const monDef = getDefinition(feature, monitoredMap(ruleId));
      const monRule = monDef!.rules![0];

      // Unmonitored path (force-coverage rule)
      const rolloutDef = getDefinition(feature);
      const rolloutRule = rolloutDef!.rules![0];

      expect(monRule.seed).toBe(ruleId);
      expect(rolloutRule.seed).toBe(ruleId);
      // Both carry the same explicit seed → hash space is identical
      expect(monRule.seed).toBe(rolloutRule.seed);
    });
  });
});
