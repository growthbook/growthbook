import { FeatureInterface } from "shared/types/feature";
import { FeatureDefinition, FeatureDefinitionRule } from "shared/types/sdk";
import { GrowthBook } from "@growthbook/growthbook";
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
): FeatureDefinition | null {
  return getFeatureDefinition({
    feature,
    environment: "production",
    groupMap: new Map(),
    experimentMap: new Map(),
    safeRolloutMap: new Map(),
    rampMonitoredRuleMap,
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

    it("converts to experiment with contiguous ranges when map matches rule id", () => {
      const def = getDefinition(makeRolloutFeature(), monitoredMap("rule_1"));
      const rule = def!.rules![0];

      expect(rule.force).toBeUndefined();
      expect(rule.variations).toEqual([true, false]);
      expect(rule.weights).toEqual([0.5, 0.5]);
      expect(rule.force).toBeUndefined();
      expect(rule.variations).toEqual([true, false]);
      expect(rule.weights).toEqual([0.5, 0.5]);
      expect(rule.coverage).toBe(0.8);
      expect(rule.filters).toBeUndefined();
      // Explicit contiguous ranges: treatment=[0, c], control=[c, min(1, 2c)] for c=0.8
      expect(rule.ranges).toEqual([
        [0, 0.8],
        [0.8, 1.0],
      ]);
      expect(rule.hashAttribute).toBe("id");
      expect(rule.seed).toBe("test-seed");
      expect(rule.key).toBe("ramp_rs_abc");
      expect(rule.phase).toBe("0");
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
      expect(rule.coverage).toBe(1);
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
      expect(rule.coverage).toBe(1);
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

    it("uses feature id as payload seed when monitored rollout has no seed", () => {
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
            allEnvironments: true,
          },
        ],
      } as Partial<FeatureInterface>);

      const def = getDefinition(feature, monitoredMap("rule_1"));
      const rule = def!.rules![0];
      expect(rule.variations).toEqual([true, false]);
      expect(rule.seed).toBe(feature.id);
      // ranges use hash space, not a seed; just confirm no filters and ranges are present
      expect(rule.filters).toBeUndefined();
      expect(rule.ranges).toBeDefined();
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

    it("bucketingV2 SDK receives ranges and seed (ranges takes precedence over coverage)", () => {
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
      expect(rule.ranges).toEqual([
        [0, 0.8],
        [0.8, 1.0],
      ]);
      expect(rule.seed).toBe("test-seed");
      expect(rule.hashVersion).toBe(1); // old rule has no hashVersion → falls back to 1
      expect(rule.coverage).toBe(0.8); // present as a fallback sentinel but overridden by ranges
    });

    it("monitored experiment inherits hashVersion:2 from the rollout rule", () => {
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
      expect(rule.ranges).toEqual([
        [0, 0.4],
        [0.4, 0.8],
      ]);
    });

    it("non-bucketingV2 SDK receives coverage as enrollment gate but no ranges or seed", () => {
      // Without bucketingV2, ranges/seed/meta/phase are stripped. coverage remains
      // (it's a STRICT key) so enrollment is bounded to ~coverage% rather than 100%.
      // The hash will differ from the rollout (key used instead of seed) but that is
      // unavoidable; this is the best-effort fallback for very old SDKs.
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
      expect(rule.coverage).toBe(0.8); // still sent — limits enrollment to ~80% via getBucketRanges
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
      const controlEnd = Math.min(1, coverage * 2);
      const rule: FeatureDefinitionRule = {
        variations: [TREATMENT, CONTROL],
        weights: [0.5, 0.5],
        hashAttribute: "id",
        seed: SEED,
        key: "ramp_test",
        meta: [{ key: "0" }, { key: "1", passthrough: true }],
        phase: "0",
      };
      if (coverage < 1) {
        rule.ranges = [
          [0, coverage],
          [coverage, controlEnd],
        ];
      }
      return {
        defaultValue: CONTROL,
        rules: [rule],
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
        const controlEnd = Math.min(1, coverage * 2);
        const payload: FeatureDefinition = {
          defaultValue: CONTROL,
          rules: [
            {
              variations: [TREATMENT, CONTROL],
              weights: [0.5, 0.5],
              ranges:
                coverage < 1
                  ? [
                      [0, coverage],
                      [coverage, controlEnd],
                    ]
                  : undefined,
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

        // Treatment arm = coverage%, control arm = min(coverage, 1-coverage)%
        const treatmentRate = treatmentCount / userIds.length;
        const expectedControl = Math.min(coverage, 1 - coverage);
        const controlRate = controlCount / userIds.length;
        expect(treatmentRate).toBeGreaterThan(coverage - 0.05);
        expect(treatmentRate).toBeLessThan(coverage + 0.05);
        expect(controlRate).toBeGreaterThan(expectedControl - 0.05);
        expect(controlRate).toBeLessThan(expectedControl + 0.05);
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
  });
});
