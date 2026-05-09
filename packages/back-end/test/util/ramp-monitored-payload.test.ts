import { FeatureInterface } from "shared/types/feature";
import { FeatureDefinition, FeatureDefinitionRule } from "shared/types/sdk";
import { GrowthBook } from "@growthbook/growthbook";
import { getFeatureDefinition } from "back-end/src/util/features";
import { RampMonitoredRuleInfo } from "back-end/src/models/RampScheduleModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1. Map generation & lookup
// ---------------------------------------------------------------------------
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

    it("produces a standard rollout when map has no matching rule", () => {
      const def = getDefinition(
        makeRolloutFeature(),
        monitoredMap("rule_other"),
      );
      const rule = def!.rules![0];
      expect(rule.force).toBe(true);
      expect(rule.variations).toBeUndefined();
    });

    it("converts to experiment with filters when map matches rule id", () => {
      const def = getDefinition(makeRolloutFeature(), monitoredMap("rule_1"));
      const rule = def!.rules![0];

      expect(rule.force).toBeUndefined();
      expect(rule.variations).toEqual([true, false]);
      expect(rule.weights).toEqual([0.5, 0.5]);
      expect(rule.coverage).toBe(0.8);
      expect(rule.filters).toEqual([
        {
          seed: "test-seed",
          attribute: "id",
          hashVersion: 1,
          ranges: [[0, 0.8]],
        },
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

    it("falls back to standard rollout when rule has no seed", () => {
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
      expect(rule.force).toBe(true);
      expect(rule.variations).toBeUndefined();
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
  });

  // ---------------------------------------------------------------------------
  // 2. Hash space continuity — end-to-end through SDK evaluation
  // ---------------------------------------------------------------------------
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
      const rule: FeatureDefinitionRule = {
        variations: [TREATMENT, CONTROL],
        weights: [0.5, 0.5],
        coverage,
        hashAttribute: "id",
        seed: SEED,
        key: "ramp_test",
        meta: [{ key: "0" }, { key: "1", passthrough: true }],
        phase: "0",
      };
      if (coverage < 1) {
        rule.filters = [
          {
            seed: SEED,
            attribute: "id",
            hashVersion: 1,
            ranges: [[0, coverage]],
          },
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

    it("monitored experiment produces a roughly 50/50 split within enrolled users (control uses passthrough)", () => {
      const userIds = Array.from({ length: 2000 }, (_, i) => `split_${i}`);
      const coverage = 0.8;

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
          // Control users fall through via passthrough to the default value
          controlPassthroughCount++;
        } else {
          unenrolledCount++;
        }
      }

      // All users should resolve to either treatment (experiment) or control (defaultValue passthrough)
      // since coverage=0.8 + filter means ~80% enrolled, rest unenrolled also get default
      const totalDefault = controlPassthroughCount + unenrolledCount;
      const total = treatmentCount + totalDefault;
      expect(total).toBe(userIds.length);

      // Treatment should be roughly half of the enrolled portion (~40% of total for 80% coverage)
      expect(treatmentCount).toBeGreaterThan(0);
      const treatmentRate = treatmentCount / userIds.length;
      expect(treatmentRate).toBeGreaterThan(0.3);
      expect(treatmentRate).toBeLessThan(0.5);
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
