import {
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentAnalysisSummaryVariationStatus,
  DecisionCriteriaRule,
  DecisionCriteriaData,
  ExperimentResultStatusData,
  ExperimentDataForStatus,
  ExperimentHealthSettings,
} from "shared/types/experiment";
import {
  getDecisionFrameworkStatus,
  evaluateDecisionRuleOnVariation,
  getVariationDecisions,
  getEarlyStoppingVariationDecisions,
  resolveScheduledShipDecision,
  getExperimentResultStatus,
  getSafeRolloutResultStatus,
} from "../src/enterprise/decision-criteria/decisionCriteria";
import { PRESET_DECISION_CRITERIA } from "../src/enterprise/decision-criteria/constants";
import { MetricGroupInterface } from "../types/metric-groups";
import { SafeRolloutInterface } from "../types/safe-rollout";

function shipNow(variationIds: string[]): ExperimentResultStatusData {
  return {
    status: "ship-now",
    variations: variationIds.map((variationId) => ({
      variationId,
      decidingRule: null,
    })),
    powerReached: true,
    sequentialUsed: false,
    scheduledEndPassed: false,
  };
}

function setMetricsOnResultsStatus({
  resultsStatus,
  goalMetrics,
  guardrailMetrics,
  secondVariation,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  goalMetrics?: ExperimentAnalysisSummaryVariationStatus["goalMetrics"];
  guardrailMetrics?: ExperimentAnalysisSummaryVariationStatus["guardrailMetrics"];
  secondVariation?: ExperimentAnalysisSummaryVariationStatus;
}): ExperimentAnalysisSummaryResultsStatus {
  return {
    ...resultsStatus,
    variations: [
      {
        ...resultsStatus.variations[0],
        ...(goalMetrics ? { goalMetrics: goalMetrics } : {}),
        ...(guardrailMetrics ? { guardrailMetrics: guardrailMetrics } : {}),
      },
      ...(secondVariation ? [secondVariation] : []),
    ],
  };
}

describe("getSafeRolloutResultStatus with failed guardrails", () => {
  const healthSettings: ExperimentHealthSettings = {
    decisionFrameworkEnabled: true,
    experimentMinLengthDays: 7,
    srmThreshold: 0.001,
    multipleExposureMinPercent: 0.01,
  };

  function makeSafeRollout(
    guardrailMetrics: NonNullable<
      ExperimentAnalysisSummaryVariationStatus["guardrailMetrics"]
    >,
    srm = 1,
  ): SafeRolloutInterface {
    return {
      id: "sfr_test",
      organization: "org_test",
      dateCreated: new Date("2020-01-01"),
      dateUpdated: new Date("2020-01-01"),
      startedAt: new Date("2020-01-01"),
      featureId: "feature_test",
      datasourceId: "ds_test",
      exposureQueryId: "exposure_test",
      status: "running",
      guardrailMetricIds: Object.keys(guardrailMetrics),
      maxDuration: { amount: 7, unit: "days" },
      autoRollback: true,
      autoSnapshots: true,
      rampUpSchedule: {
        enabled: false,
        step: 0,
        steps: [],
        rampUpCompleted: true,
      },
      analysisSummary: {
        snapshotId: "snapshot_test",
        health: { srm, totalUsers: 2000, multipleExposures: 0 },
        resultsStatus: {
          settings: { sequentialTesting: true },
          variations: [{ variationId: "1", guardrailMetrics }],
        },
      },
    };
  }

  it.each([2, 0, -1])(
    "preserves incomplete data with %s days left",
    (daysLeft) => {
      const result = getSafeRolloutResultStatus({
        safeRollout: makeSafeRollout({
          failedGuardrail: { status: "failed" },
          safeGuardrail: { status: "safe" },
        }),
        healthSettings,
        daysLeft,
      });

      expect(result).toEqual({
        status: "data-incomplete",
        failedMetrics: ["failedGuardrail"],
      });
    },
  );

  it.each([
    { daysLeft: 2, status: "days-left" },
    { daysLeft: 0, status: "ship-now" },
  ])("keeps healthy rollout status $status", ({ daysLeft, status }) => {
    const result = getSafeRolloutResultStatus({
      safeRollout: makeSafeRollout({ guardrail: { status: "safe" } }),
      healthSettings,
      daysLeft,
    });

    expect(result?.status).toBe(status);
  });

  it("rolls back a losing guardrail even when another failed to compute", () => {
    const result = getSafeRolloutResultStatus({
      safeRollout: makeSafeRollout({
        failedGuardrail: { status: "failed" },
        losingGuardrail: { status: "lost" },
      }),
      healthSettings,
      daysLeft: 0,
    });

    expect(result?.status).toBe("rollback-now");
  });

  it("keeps unhealthy status ahead of incomplete data", () => {
    const result = getSafeRolloutResultStatus({
      safeRollout: makeSafeRollout({ guardrail: { status: "failed" } }, 0),
      healthSettings,
      daysLeft: 0,
    });

    expect(result).toEqual({
      status: "unhealthy",
      unhealthyData: { srm: true },
    });
  });
});

describe("default decision tree is correct", () => {
  const resultsStatus: ExperimentAnalysisSummaryResultsStatus = {
    variations: [
      {
        variationId: "1",
        goalMetrics: {},
        guardrailMetrics: {},
      },
    ],
    settings: { sequentialTesting: false },
  };
  it("returns the correct underpowered decisions", () => {
    const daysNeeded = undefined;

    // winning stat sig not enough to trigger any rec
    const noDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "neutral" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(noDecision).toEqual(undefined);

    // losing stat sig not enough to trigger any rec
    const noNegDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "neutral" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(noNegDecision).toEqual(undefined);

    // super stat sig triggers rec
    const shipDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "won" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(shipDecision).toEqual({
      status: "ship-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[0] },
      ],
      sequentialUsed: false,
      powerReached: false,
      scheduledEndPassed: false,
      tooltip: "A test variation is ready to ship.",
    });

    // super stat sig triggers rec with guardrail failure
    const discussDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "won" } },
        guardrailMetrics: {
          "01": { status: "lost" },
        },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: ["01"],
      daysNeeded: undefined,
    });
    expect(discussDecision).toEqual({
      status: "rollback-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[1] },
      ],
      sequentialUsed: false,
      powerReached: false,
      scheduledEndPassed: false,
      tooltip: "The test variation(s) should be rolled back.",
    });

    // super stat sig triggers rec with guardrail failure
    const guardrailSafeDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: {},
        guardrailMetrics: {
          "01": { status: "safe" },
        },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: [],
      guardrailMetrics: ["01"],
      daysNeeded: undefined,
    });
    expect(guardrailSafeDecision).toEqual({
      status: "ship-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[0] },
      ],
      sequentialUsed: false,
      powerReached: false,
      scheduledEndPassed: false,
      tooltip: "A test variation is ready to ship.",
    });

    // losing super stat sig triggers rec
    const negDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "lost" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(negDecision).toEqual({
      status: "rollback-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[2] },
      ],
      sequentialUsed: false,
      powerReached: false,
      scheduledEndPassed: false,
      tooltip: "The test variation(s) should be rolled back.",
    });

    // losing super stat sig on one variation not enough
    const somewhatNegDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "lost" } },
        secondVariation: {
          variationId: "2",
          goalMetrics: {
            "1": { status: "neutral", superStatSigStatus: "neutral" },
          },
          guardrailMetrics: {},
        },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(somewhatNegDecision).toEqual(undefined);
  });

  it("renders underpowered decisions when scheduledEndPassed is set", () => {
    // winning stat sig triggers a rec despite missing power, but the
    // returned powerReached stays honest
    const shipDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "neutral" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded: undefined,
      scheduledEndPassed: true,
    });
    expect(shipDecision).toEqual({
      status: "ship-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[0] },
      ],
      sequentialUsed: false,
      powerReached: false,
      scheduledEndPassed: true,
      tooltip:
        "A test variation is ready to ship. The scheduled end date has passed and a recommendation can be made.",
    });

    // neutral falls through to the default action (review)
    const reviewDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: {
          "1": { status: "neutral", superStatSigStatus: "neutral" },
        },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded: undefined,
      scheduledEndPassed: true,
    });
    expect(reviewDecision).toEqual({
      status: "ready-for-review",
      variations: [{ variationId: "1", decidingRule: null }],
      sequentialUsed: false,
      powerReached: false,
      scheduledEndPassed: true,
      tooltip:
        "A test variation is ready to be reviewed. The scheduled end date has passed and there is no clear ship or rollback recommendation.",
    });
  });

  it("returns the correct powered decisions", () => {
    const daysNeeded = 0;

    // winning stat sig enough to trigger rec
    const decision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "neutral" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(decision).toEqual({
      status: "ship-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[0] },
      ],
      sequentialUsed: false,
      powerReached: true,
      scheduledEndPassed: false,
      tooltip: "A test variation is ready to ship.",
    });

    // neutral triggers no decision
    const noDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: {
          "1": { status: "neutral", superStatSigStatus: "neutral" },
        },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(noDecision).toEqual({
      status: "ready-for-review",
      variations: [{ variationId: "1", decidingRule: null }],
      sequentialUsed: false,
      powerReached: true,
      scheduledEndPassed: false,
      tooltip: "A test variation is ready to be reviewed.",
    });

    // Guardrail failure is now default to rollback
    const guardrailDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        guardrailMetrics: { "01": { status: "lost" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: ["01"],
      daysNeeded,
    });
    expect(guardrailDecision).toEqual({
      status: "rollback-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[1] },
      ],
      sequentialUsed: false,
      powerReached: true,
      scheduledEndPassed: false,
      tooltip: "The test variation(s) should be rolled back.",
    });

    // losing stat sig enough to trigger any rec
    const negDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "neutral" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(negDecision).toEqual({
      status: "rollback-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[2] },
      ],
      sequentialUsed: false,
      powerReached: true,
      scheduledEndPassed: false,
      tooltip: "The test variation(s) should be rolled back.",
    });

    // losing stat sig in two variations also triggers a rec
    const negDecisionTwoVar = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "neutral" } },
        secondVariation: {
          variationId: "2",
          goalMetrics: {
            "1": { status: "lost", superStatSigStatus: "neutral" },
          },
          guardrailMetrics: {},
        },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(negDecisionTwoVar).toEqual({
      status: "rollback-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[2] },
        { variationId: "2", decidingRule: PRESET_DECISION_CRITERIA.rules[2] },
      ],
      sequentialUsed: false,
      powerReached: true,
      scheduledEndPassed: false,
      tooltip: "The test variation(s) should be rolled back.",
    });

    // losing stat sig in only one variation not enough, leads to ready for review
    const ambiguousDecisionTwoVar = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "neutral" } },
        secondVariation: {
          variationId: "2",
          goalMetrics: {
            "1": { status: "neutral", superStatSigStatus: "neutral" },
          },
          guardrailMetrics: {},
        },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(ambiguousDecisionTwoVar).toEqual({
      status: "ready-for-review",
      variations: [{ variationId: "2", decidingRule: null }],
      sequentialUsed: false,
      powerReached: true,
      scheduledEndPassed: false,
      tooltip: "A test variation is ready to be reviewed.",
    });
  });
});

describe("evaluateDecisionRuleOnVariation", () => {
  const baseVariationStatus: ExperimentAnalysisSummaryVariationStatus = {
    variationId: "1",
    goalMetrics: {},
    guardrailMetrics: {},
  };

  it("evaluates goal metrics with 'all' match condition", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "statsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };

    // All metrics winning - should match
    const allWinning = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
          metric2: { status: "won", superStatSigStatus: "won" },
        },
      },
      goalMetrics: ["metric1", "metric2"],
      guardrailMetrics: [],
      requireSuperStatSig: false,
    });
    expect(allWinning).toEqual("matched");

    // One metric losing - should not match
    const oneLosing = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
          metric2: { status: "lost", superStatSigStatus: "lost" },
        },
      },
      goalMetrics: ["metric1", "metric2"],
      guardrailMetrics: [],
      requireSuperStatSig: false,
    });
    expect(oneLosing).toEqual("not-matched");
  });

  it("evaluates goal metrics with 'any' match condition", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "any" as const,
          direction: "statsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };

    // One metric winning - should match
    const oneWinning = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
          metric2: { status: "lost", superStatSigStatus: "lost" },
        },
      },
      goalMetrics: ["metric1", "metric2"],
      guardrailMetrics: [],
      requireSuperStatSig: false,
    });
    expect(oneWinning).toEqual("matched");

    // No metrics winning - should not match
    const noneWinning = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "lost", superStatSigStatus: "lost" },
          metric2: { status: "lost", superStatSigStatus: "lost" },
        },
      },
      goalMetrics: ["metric1", "metric2"],
      guardrailMetrics: [],
      requireSuperStatSig: false,
    });
    expect(noneWinning).toEqual("not-matched");
  });

  it("evaluates goal metrics with 'none' match condition", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "none" as const,
          direction: "statsigLoser" as const,
        },
      ],
      action: "ship" as const,
    };

    // No metrics losing - should match
    const noneLosing = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
          metric2: { status: "won", superStatSigStatus: "won" },
        },
      },
      goalMetrics: ["metric1", "metric2"],
      guardrailMetrics: [],
      requireSuperStatSig: false,
    });
    expect(noneLosing).toEqual("matched");

    // One metric losing - should not match
    const oneLosing = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
          metric2: { status: "lost", superStatSigStatus: "lost" },
        },
      },
      goalMetrics: ["metric1", "metric2"],
      guardrailMetrics: [],
      requireSuperStatSig: false,
    });
    expect(oneLosing).toEqual("not-matched");
  });

  it("evaluates guardrail metrics correctly", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "guardrails" as const,
          match: "all" as const,
          direction: "statsigLoser" as const,
        },
      ],
      action: "rollback" as const,
    };

    // All guardrails losing - should match
    const allLosing = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        guardrailMetrics: {
          guardrail1: { status: "lost" },
          guardrail2: { status: "lost" },
        },
      },
      goalMetrics: [],
      guardrailMetrics: ["guardrail1", "guardrail2"],
      requireSuperStatSig: false,
    });
    expect(allLosing).toEqual("matched");

    // One guardrail losing - should not match
    const oneLosing = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        guardrailMetrics: {
          guardrail1: { status: "neutral" },
          guardrail2: { status: "lost" },
        },
      },
      goalMetrics: [],
      guardrailMetrics: ["guardrail1", "guardrail2"],
      requireSuperStatSig: false,
    });
    expect(oneLosing).toEqual("not-matched");
  });

  it("respects requireSuperStatSig flag", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "statsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };

    // With requireSuperStatSig=true, should check superStatSigStatus
    const superStatSigRequired = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "neutral" },
        },
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      requireSuperStatSig: true,
    });
    expect(superStatSigRequired).toEqual("not-matched");

    // With requireSuperStatSig=false, should check regular status
    const superStatSigNotRequired = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "neutral" },
        },
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      requireSuperStatSig: false,
    });
    expect(superStatSigNotRequired).toEqual("matched");
  });

  it("handles multiple conditions", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "statsigWinner" as const,
        },
        {
          metrics: "guardrails",
          match: "none",
          direction: "statsigLoser",
        },
      ],
      action: "ship",
    };

    // All conditions met - should match
    const allConditionsMet = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
        },
        guardrailMetrics: {
          guardrail1: { status: "neutral" },
        },
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: ["guardrail1"],
      requireSuperStatSig: false,
    });
    expect(allConditionsMet).toEqual("matched");

    // One condition not met - should not match
    const oneConditionNotMet = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
        },
        guardrailMetrics: {
          guardrail1: { status: "lost" },
        },
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: ["guardrail1"],
      requireSuperStatSig: false,
    });
    expect(oneConditionNotMet).toEqual("not-matched");
  });

  it("returns not-matched when one condition is indeterminate and another does not match in either order", () => {
    const indeterminateCondition: DecisionCriteriaRule["conditions"][number] = {
      metrics: "guardrails",
      match: "none",
      direction: "statsigLoser",
    };
    const notMatchedCondition: DecisionCriteriaRule["conditions"][number] = {
      metrics: "goals",
      match: "all",
      direction: "statsigWinner",
    };

    for (const conditions of [
      [indeterminateCondition, notMatchedCondition],
      [notMatchedCondition, indeterminateCondition],
    ]) {
      expect(
        evaluateDecisionRuleOnVariation({
          rule: { conditions, action: "ship" },
          variationStatus: {
            ...baseVariationStatus,
            goalMetrics: {
              goal1: { status: "lost", superStatSigStatus: "lost" },
            },
            guardrailMetrics: { guardrail1: { status: "failed" } },
          },
          goalMetrics: ["goal1"],
          guardrailMetrics: ["guardrail1"],
          requireSuperStatSig: false,
        }),
      ).toEqual("not-matched");
    }
  });

  it("returns indeterminate when one condition is indeterminate and the rest match", () => {
    expect(
      evaluateDecisionRuleOnVariation({
        rule: {
          conditions: [
            {
              metrics: "guardrails",
              match: "none",
              direction: "statsigLoser",
            },
            {
              metrics: "goals",
              match: "all",
              direction: "statsigWinner",
            },
          ],
          action: "ship",
        },
        variationStatus: {
          ...baseVariationStatus,
          goalMetrics: {
            goal1: { status: "won", superStatSigStatus: "won" },
          },
          guardrailMetrics: { guardrail1: { status: "failed" } },
        },
        goalMetrics: ["goal1"],
        guardrailMetrics: ["guardrail1"],
        requireSuperStatSig: false,
      }),
    ).toEqual("indeterminate");
  });
});

describe("getVariationDecisions", () => {
  const baseResultsStatus: ExperimentAnalysisSummaryResultsStatus = {
    variations: [
      {
        variationId: "1",
        goalMetrics: {},
        guardrailMetrics: {},
      },
      {
        variationId: "2",
        goalMetrics: {},
        guardrailMetrics: {},
      },
    ],
    settings: { sequentialTesting: false },
  };

  it("returns a decided fallback with power and pending without power when no rules match", () => {
    const decisionCriteria = {
      id: "test-criteria-1",
      name: "Test Criteria 1",
      rules: [
        {
          conditions: [
            {
              metrics: "goals" as const,
              match: "all" as const,
              direction: "statsigWinner" as const,
            },
          ],
          action: "ship" as const,
        },
      ],
      defaultAction: "review" as const,
    };

    const results = getVariationDecisions({
      resultsStatus: baseResultsStatus,
      decisionCriteria,
      goalMetrics: ["metric1"],
      powerReached: true,
      guardrailMetrics: [],
    });

    expect(results).toEqual([
      {
        status: "decided",
        decisionCriteriaAction: "review",
        variation: { variationId: "1", decidingRule: null },
      },
      {
        status: "decided",
        decisionCriteriaAction: "review",
        variation: { variationId: "2", decidingRule: null },
      },
    ]);

    // Without power, no fallback decision is available yet.
    const resultsWithoutPower = getVariationDecisions({
      resultsStatus: baseResultsStatus,
      decisionCriteria,
      goalMetrics: ["metric1"],
      powerReached: false,
      guardrailMetrics: [],
    });

    expect(resultsWithoutPower).toEqual([
      {
        status: "pending",
        variation: { variationId: "1", decidingRule: null },
      },
      {
        status: "pending",
        variation: { variationId: "2", decidingRule: null },
      },
    ]);
  });
  it("applies rules to each variation and returns default action if no rules match and power is reached", () => {
    const decisionCriteria = {
      id: "test-criteria-1",
      name: "Test Criteria 1",
      rules: [
        {
          conditions: [
            {
              metrics: "goals" as const,
              match: "all" as const,
              direction: "statsigWinner" as const,
            },
          ],
          action: "ship" as const,
        },
      ],
      defaultAction: "review" as const,
    };

    const results = getVariationDecisions({
      resultsStatus: baseResultsStatus,
      decisionCriteria,
      goalMetrics: ["metric1"],
      powerReached: true,
      guardrailMetrics: [],
    });

    expect(results).toEqual([
      {
        status: "decided",
        decisionCriteriaAction: "review",
        variation: { variationId: "1", decidingRule: null },
      },
      {
        status: "decided",
        decisionCriteriaAction: "review",
        variation: { variationId: "2", decidingRule: null },
      },
    ]);
  });

  it("applies matching rules to variations", () => {
    const shipRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "statsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };
    const rollbackRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "statsigLoser" as const,
        },
      ],
      action: "rollback" as const,
    };
    const decisionCriteria = {
      id: "test-criteria-2",
      name: "Test Criteria 2",
      rules: [shipRule, rollbackRule],
      defaultAction: "review" as const,
    };

    const results = getVariationDecisions({
      resultsStatus: {
        ...baseResultsStatus,
        variations: [
          {
            variationId: "1",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "won" },
            },
            guardrailMetrics: {},
          },
          {
            variationId: "2",
            goalMetrics: {
              metric1: { status: "lost", superStatSigStatus: "lost" },
            },
            guardrailMetrics: {},
          },
        ],
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      powerReached: true,
    });

    expect(results).toEqual([
      {
        status: "decided",
        decisionCriteriaAction: "ship",
        variation: { variationId: "1", decidingRule: shipRule },
      },
      {
        status: "decided",
        decisionCriteriaAction: "rollback",
        variation: { variationId: "2", decidingRule: rollbackRule },
      },
    ]);
  });

  it("applies first matching rule to each variation", () => {
    const shipRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "any" as const,
          direction: "statsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };
    const reviewRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "statsigWinner" as const,
        },
      ],
      action: "review" as const,
    };
    const decisionCriteria = {
      id: "test-criteria-3",
      name: "Test Criteria 3",
      rules: [shipRule, reviewRule],
      defaultAction: "rollback" as const,
    };

    const results = getVariationDecisions({
      resultsStatus: {
        ...baseResultsStatus,
        variations: [
          {
            variationId: "1",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "won" },
              metric2: { status: "lost", superStatSigStatus: "lost" },
            },
            guardrailMetrics: {},
          },
          {
            variationId: "2",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "won" },
              metric2: { status: "won", superStatSigStatus: "won" },
            },
            guardrailMetrics: {},
          },
        ],
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1", "metric2"],
      guardrailMetrics: [],
      powerReached: true,
    });

    // Both variations match the first rule (any metric winning)
    expect(results).toEqual([
      {
        status: "decided",
        decisionCriteriaAction: "ship",
        variation: { variationId: "1", decidingRule: shipRule },
      },
      {
        status: "decided",
        decisionCriteriaAction: "ship",
        variation: { variationId: "2", decidingRule: shipRule },
      },
    ]);
  });

  it("handles guardrail metrics correctly", () => {
    const rollbackRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "guardrails" as const,
          match: "all" as const,
          direction: "statsigLoser" as const,
        },
      ],
      action: "rollback" as const,
    };

    const decisionCriteria = {
      id: "test-criteria-4",
      name: "Test Criteria 4",
      rules: [rollbackRule],
      defaultAction: "review" as const,
    };

    const results = getVariationDecisions({
      resultsStatus: {
        ...baseResultsStatus,
        variations: [
          {
            variationId: "1",
            goalMetrics: {},
            guardrailMetrics: {
              guardrail1: { status: "lost" },
              guardrail2: { status: "lost" },
            },
          },
          {
            variationId: "2",
            goalMetrics: {},
            guardrailMetrics: {
              guardrail1: { status: "neutral" },
              guardrail2: { status: "lost" },
            },
          },
        ],
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: [],
      guardrailMetrics: ["guardrail1", "guardrail2"],
      powerReached: true,
    });

    expect(results).toEqual([
      {
        status: "decided",
        decisionCriteriaAction: "rollback",
        variation: { variationId: "1", decidingRule: rollbackRule },
      },
      {
        status: "decided",
        decisionCriteriaAction: "review",
        variation: { variationId: "2", decidingRule: null },
      },
    ]);
  });

  it("respects requireSuperStatSig flag", () => {
    const shipRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "statsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };
    const decisionCriteria = {
      id: "test-criteria-5",
      name: "Test Criteria 5",
      rules: [shipRule],
      defaultAction: "review" as const,
    };

    const results = getEarlyStoppingVariationDecisions({
      resultsStatus: {
        ...baseResultsStatus,
        variations: [
          {
            variationId: "1",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "neutral" },
            },
            guardrailMetrics: {},
          },
          {
            variationId: "2",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "won" },
            },
            guardrailMetrics: {},
          },
        ],
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
    });

    expect(results).toEqual([
      // Early stopping has no fallback decision.
      {
        status: "pending",
        variation: { variationId: "1", decidingRule: null },
      },
      {
        status: "decided",
        decisionCriteriaAction: "ship",
        variation: { variationId: "2", decidingRule: shipRule },
      },
    ]);
  });
});

describe("getDecisionFrameworkStatus Handles Super Stat Sig Correctly", () => {
  const base2ArmedResultsStatus: ExperimentAnalysisSummaryResultsStatus = {
    variations: [
      {
        variationId: "1",
        goalMetrics: {},
        guardrailMetrics: {},
      },
    ],
    settings: { sequentialTesting: false },
  };

  const base3ArmedResultsStatus: ExperimentAnalysisSummaryResultsStatus = {
    variations: [
      {
        variationId: "1",
        goalMetrics: {},
        guardrailMetrics: {},
      },
      {
        variationId: "2",
        goalMetrics: {},
        guardrailMetrics: {},
      },
    ],
    settings: { sequentialTesting: false },
  };
  const earlyStoppingOverrideDecisionRule: DecisionCriteriaRule = {
    conditions: [
      {
        metrics: "goals" as const,
        match: "all" as const,
        direction: "statsigWinner" as const,
      },
      {
        metrics: "guardrails" as const,
        match: "none" as const,
        direction: "statsigLoser" as const,
      },
    ],
    action: "ship" as const,
  };
  const shipRule: DecisionCriteriaRule = {
    conditions: [
      {
        metrics: "goals" as const,
        match: "all" as const,
        direction: "statsigWinner" as const,
      },
    ],
    action: "ship" as const,
  };
  const rollbackRule: DecisionCriteriaRule = {
    conditions: [
      {
        metrics: "goals" as const,
        match: "all" as const,
        direction: "statsigLoser" as const,
      },
    ],
    action: "rollback" as const,
  };
  const decisionCriteria = {
    id: "test-criteria-6",
    name: "Test Criteria 6",
    rules: [shipRule, rollbackRule],
    defaultAction: "review" as const,
  };

  it("succeeds in 2 variation case with clear winner", () => {
    const decision = getDecisionFrameworkStatus({
      resultsStatus: {
        ...base2ArmedResultsStatus,
        variations: [
          {
            variationId: "1",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "won" },
            },
            guardrailMetrics: {},
          },
        ],
        // not decision ready
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      // not decision ready
      daysNeeded: 100,
    });

    // early stopping, so the rule is from the default strict criteria flow
    expect(decision).toEqual({
      status: "ship-now",
      variations: [
        { variationId: "1", decidingRule: earlyStoppingOverrideDecisionRule },
      ],
      sequentialUsed: false,
      powerReached: false,
      scheduledEndPassed: false,
      tooltip: "A test variation is ready to ship.",
    });
  });

  it("in 3 variation case it does not ship if one is clear winner while other is ambiguous", () => {
    const decision = getDecisionFrameworkStatus({
      resultsStatus: {
        ...base3ArmedResultsStatus,
        variations: [
          {
            variationId: "1",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "won" },
            },
            guardrailMetrics: {},
          },
          {
            variationId: "2",
            goalMetrics: {
              metric1: { status: "neutral", superStatSigStatus: "neutral" },
            },
            guardrailMetrics: {},
          },
        ],
        // not decision ready
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      // not decision ready
      daysNeeded: 100,
    });

    expect(decision).toEqual(undefined);
  });

  it("in 3 variation case it ships if one is clear winner while other is rollback", () => {
    const decision = getDecisionFrameworkStatus({
      resultsStatus: {
        ...base3ArmedResultsStatus,
        variations: [
          {
            variationId: "1",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "won" },
            },
            guardrailMetrics: {},
          },
          {
            variationId: "2",
            goalMetrics: {
              metric1: { status: "lost", superStatSigStatus: "lost" },
            },
            guardrailMetrics: {},
          },
        ],
        // not decision ready
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      // not decision ready
      daysNeeded: 100,
    });

    expect(decision).toEqual({
      status: "ship-now",
      variations: [
        { variationId: "1", decidingRule: earlyStoppingOverrideDecisionRule },
      ],
      sequentialUsed: false,
      powerReached: false,
      scheduledEndPassed: false,
      tooltip: "A test variation is ready to ship.",
    });
  });

  it("in 3 variation case it falls back to no result rather than fallback action in stat sig case if results are not clear", () => {
    const decision = getDecisionFrameworkStatus({
      resultsStatus: {
        ...base2ArmedResultsStatus,
        variations: [
          {
            variationId: "1",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "neutral" },
            },
            guardrailMetrics: {},
          },
        ],
        // not decision ready
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      // not decision ready
      daysNeeded: 100,
    });

    expect(decision).toEqual(undefined);
  });
});

describe("resolveScheduledShipDecision", () => {
  it("ships a single clear winner", () => {
    expect(
      resolveScheduledShipDecision({ resultStatus: shipNow(["1"]) }),
    ).toEqual({ action: "ship", variationId: "1" });
  });

  it("has no winner when status is not ship-now", () => {
    expect(
      resolveScheduledShipDecision({
        resultStatus: { status: "rollback-now" } as ExperimentResultStatusData,
      }),
    ).toEqual({ action: "no-winner" });
    expect(resolveScheduledShipDecision({ resultStatus: undefined })).toEqual({
      action: "no-winner",
    });
  });

  it("has no winner on a multi-winner tie without a tiebreaker", () => {
    expect(
      resolveScheduledShipDecision({ resultStatus: shipNow(["1", "2"]) }),
    ).toEqual({ action: "no-winner" });
  });

  it("breaks a tie by highest lift on the tiebreaker metric", () => {
    expect(
      resolveScheduledShipDecision({
        resultStatus: shipNow(["1", "2", "3"]),
        tiebreakerLiftByVariationId: { "1": 0.02, "2": 0.05, "3": 0.01 },
      }),
    ).toEqual({ action: "ship", variationId: "2" });
  });

  it("ignores winners missing a tiebreaker lift, no winner if none have it", () => {
    expect(
      resolveScheduledShipDecision({
        resultStatus: shipNow(["1", "2"]),
        tiebreakerLiftByVariationId: { "3": 0.9 },
      }),
    ).toEqual({ action: "no-winner" });
  });
});

describe("compute-failed metrics are indeterminate, not false", () => {
  const baseVariationStatus: ExperimentAnalysisSummaryVariationStatus = {
    variationId: "1",
    goalMetrics: {},
    guardrailMetrics: {},
  };

  it("returns 'indeterminate' for a match:'none' ship guardrail when a guardrail failed", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "guardrails" as const,
          match: "none" as const,
          direction: "statsigLoser" as const,
        },
      ],
      action: "ship" as const,
    };

    const result = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        guardrailMetrics: {
          guardrail1: { status: "safe" },
          guardrail2: { status: "failed" },
        },
      },
      goalMetrics: [],
      guardrailMetrics: ["guardrail1", "guardrail2"],
      requireSuperStatSig: false,
    });
    expect(result).toEqual("indeterminate");
  });

  it("returns matched for match:'any' with a surviving winner despite another failing", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals",
          match: "any",
          direction: "statsigWinner",
        },
      ],
      action: "ship",
    };

    const result = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
          metric2: { status: "failed", superStatSigStatus: "failed" },
        },
      },
      goalMetrics: ["metric1", "metric2"],
      guardrailMetrics: [],
      requireSuperStatSig: false,
    });
    expect(result).toEqual("matched");
  });

  it("returns not-matched for match:'all' with a surviving loser despite a failed metric", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals",
          match: "all",
          direction: "statsigWinner",
        },
      ],
      action: "ship",
    };

    const result = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "lost", superStatSigStatus: "lost" },
          metric2: { status: "failed", superStatSigStatus: "failed" },
        },
      },
      goalMetrics: ["metric1", "metric2"],
      guardrailMetrics: [],
      requireSuperStatSig: false,
    });
    expect(result).toEqual("not-matched");
  });

  it("returns matched for a surviving losing guardrail while another failed", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "guardrails",
          match: "any",
          direction: "statsigLoser",
        },
      ],
      action: "rollback",
    };

    const result = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        guardrailMetrics: {
          guardrail1: { status: "lost" },
          guardrail2: { status: "failed" },
        },
      },
      goalMetrics: [],
      guardrailMetrics: ["guardrail1", "guardrail2"],
      requireSuperStatSig: false,
    });
    expect(result).toEqual("matched");
  });

  it("rollback rule is indeterminate, not a no-match, when every guardrail failed", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "guardrails",
          match: "any",
          direction: "statsigLoser",
        },
      ],
      action: "rollback",
    };

    const result = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        guardrailMetrics: {
          guardrail1: { status: "failed" },
          guardrail2: { status: "failed" },
        },
      },
      goalMetrics: [],
      guardrailMetrics: ["guardrail1", "guardrail2"],
      requireSuperStatSig: false,
    });
    expect(result).toEqual("indeterminate");
  });

  it("rollback match:'all' is indeterminate, not a vacuous match, when every guardrail failed", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "guardrails",
          match: "all",
          direction: "statsigLoser",
        },
      ],
      action: "rollback",
    };

    const result = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        guardrailMetrics: {
          guardrail1: { status: "failed" },
          guardrail2: { status: "failed" },
        },
      },
      goalMetrics: [],
      guardrailMetrics: ["guardrail1", "guardrail2"],
      requireSuperStatSig: false,
    });
    expect(result).toEqual("indeterminate");
  });

  it("getDecisionFrameworkStatus yields data-incomplete when a ship goal metric failed", () => {
    const resultsStatus: ExperimentAnalysisSummaryResultsStatus = {
      variations: [
        {
          variationId: "1",
          goalMetrics: {
            metric1: { status: "failed", superStatSigStatus: "failed" },
          },
          guardrailMetrics: {},
        },
      ],
      settings: { sequentialTesting: false },
    };

    const decision = getDecisionFrameworkStatus({
      resultsStatus,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      daysNeeded: 0,
    });

    expect(decision).toEqual({
      status: "data-incomplete",
      failedMetrics: ["metric1"],
    });
  });

  it("getDecisionFrameworkStatus still rolls back on a surviving losing guardrail while another failed", () => {
    const resultsStatus: ExperimentAnalysisSummaryResultsStatus = {
      variations: [
        {
          variationId: "1",
          goalMetrics: {},
          guardrailMetrics: {
            guardrail1: { status: "lost" },
            guardrail2: { status: "failed" },
          },
        },
      ],
      settings: { sequentialTesting: false },
    };

    const decision = getDecisionFrameworkStatus({
      resultsStatus,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: [],
      guardrailMetrics: ["guardrail1", "guardrail2"],
      daysNeeded: 0,
    });

    expect(decision).toEqual({
      status: "rollback-now",
      variations: [
        { variationId: "1", decidingRule: PRESET_DECISION_CRITERIA.rules[1] },
      ],
      sequentialUsed: false,
      powerReached: true,
      scheduledEndPassed: false,
      tooltip: "The test variation(s) should be rolled back.",
    });
  });

  it("does not fire a lower-precedence rollback when an indeterminate rule sits above a definitive ship/review", () => {
    const criteria: DecisionCriteriaData = {
      id: "gbdeccrit_ship_review_rollback",
      name: "ship-review-rollback",
      description: "",
      rules: [
        {
          conditions: [
            { metrics: "goals", match: "all", direction: "statsigWinner" },
          ],
          action: "ship",
        },
        {
          conditions: [
            { metrics: "goals", match: "any", direction: "statsigWinner" },
          ],
          action: "review",
        },
        {
          conditions: [
            { metrics: "guardrails", match: "any", direction: "statsigLoser" },
          ],
          action: "rollback",
        },
      ],
      defaultAction: "review",
    };

    const resultsStatus: ExperimentAnalysisSummaryResultsStatus = {
      variations: [
        {
          variationId: "1",
          goalMetrics: {
            goalA: { status: "won", superStatSigStatus: "won" },
            goalB: { status: "failed", superStatSigStatus: "failed" },
          },
          guardrailMetrics: { guardrail1: { status: "lost" } },
        },
      ],
      settings: { sequentialTesting: false },
    };

    const decision = getDecisionFrameworkStatus({
      resultsStatus,
      decisionCriteria: criteria,
      goalMetrics: ["goalA", "goalB"],
      guardrailMetrics: ["guardrail1"],
      daysNeeded: 0,
    });

    expect(decision).toEqual({
      status: "data-incomplete",
      failedMetrics: ["goalB"],
    });
  });

  it("withholds a lower ship rule when a higher rollback rule's only guardrail failed", () => {
    const criteria: DecisionCriteriaData = {
      id: "gbdeccrit_rollback_then_ship",
      name: "rollback-then-ship",
      description: "",
      rules: [
        {
          conditions: [
            { metrics: "guardrails", match: "any", direction: "statsigLoser" },
          ],
          action: "rollback",
        },
        {
          conditions: [
            { metrics: "goals", match: "all", direction: "statsigWinner" },
          ],
          action: "ship",
        },
      ],
      defaultAction: "review",
    };

    const resultsStatus: ExperimentAnalysisSummaryResultsStatus = {
      variations: [
        {
          variationId: "1",
          goalMetrics: {
            goalA: { status: "won", superStatSigStatus: "won" },
          },
          guardrailMetrics: { guardrail1: { status: "failed" } },
        },
      ],
      settings: { sequentialTesting: false },
    };

    const decision = getDecisionFrameworkStatus({
      resultsStatus,
      decisionCriteria: criteria,
      goalMetrics: ["goalA"],
      guardrailMetrics: ["guardrail1"],
      daysNeeded: 0,
    });

    expect(decision).toEqual({
      status: "data-incomplete",
      failedMetrics: ["guardrail1"],
    });
  });

  it("getVariationDecisions marks an unresolved variation indeterminate with no action and no fallback", () => {
    const results = getVariationDecisions({
      resultsStatus: {
        variations: [
          {
            variationId: "1",
            goalMetrics: {
              metric1: { status: "failed", superStatSigStatus: "failed" },
            },
            guardrailMetrics: {},
          },
          {
            variationId: "2",
            goalMetrics: {
              metric1: { status: "won", superStatSigStatus: "won" },
            },
            guardrailMetrics: {},
          },
        ],
        settings: { sequentialTesting: false },
      },
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      powerReached: true,
    });

    expect(results).toEqual([
      {
        status: "indeterminate",
        variation: { variationId: "1", decidingRule: null },
      },
      {
        status: "decided",
        variation: {
          variationId: "2",
          decidingRule: PRESET_DECISION_CRITERIA.rules.find(
            (r) => r.action === "ship",
          ),
        },
        decisionCriteriaAction: "ship",
      },
    ]);
  });
});

describe("getExperimentResultStatus schedule-driven states", () => {
  const baseHealthSettings: ExperimentHealthSettings = {
    decisionFrameworkEnabled: true,
    srmThreshold: 0.001,
    multipleExposureMinPercent: 0.01,
    experimentMinLengthDays: 7,
  };

  const daysAgo = (n: number): Date =>
    new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const hoursFromNow = (n: number): Date =>
    new Date(Date.now() + n * 60 * 60 * 1000);

  function makeExperimentData({
    stopAt,
    dateStarted = daysAgo(30),
    goalMetrics = ["metric-1"],
    secondaryMetrics = [],
    guardrailMetrics = [],
    analysisSummary,
    status = "running",
  }: {
    stopAt?: Date;
    dateStarted?: Date;
    goalMetrics?: string[];
    secondaryMetrics?: string[];
    guardrailMetrics?: string[];
    analysisSummary?: ExperimentDataForStatus["analysisSummary"];
    status?: ExperimentDataForStatus["status"];
  } = {}): ExperimentDataForStatus {
    return {
      type: "standard",
      status,
      archived: false,
      variations: [
        { id: "0", key: "0", name: "Control", screenshots: [] },
        { id: "1", key: "1", name: "Variation 1", screenshots: [] },
      ],
      phases: [{ dateStarted, variations: [] }],
      goalMetrics,
      secondaryMetrics,
      guardrailMetrics,
      datasource: "ds_1",
      ...(stopAt ? { statusUpdateSchedule: { stopAt } } : {}),
      ...(analysisSummary ? { analysisSummary } : {}),
    } as unknown as ExperimentDataForStatus;
  }

  it("returns scheduled-end-review when the scheduled end passed with no goal metrics", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({
        stopAt: daysAgo(1),
        goalMetrics: [],
        secondaryMetrics: ["secondary-1"],
      }),
      healthSettings: baseHealthSettings,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [],
    });

    expect(result?.status).toBe("scheduled-end-review");
    expect(result?.tooltip).toContain("The scheduled end date has passed");
    expect(result?.tooltip).toContain("No goal metrics are configured");
  });

  it("requires review when the scheduled end passed with an empty goal metric group", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({
        stopAt: daysAgo(1),
        goalMetrics: ["mg_empty"],
        analysisSummary: {
          snapshotId: "snap-1",
          health: { srm: 0.5, multipleExposures: 0, totalUsers: 1000 },
          resultsStatus: {
            variations: [
              {
                variationId: "1",
                goalMetrics: {},
                guardrailMetrics: {},
              },
            ],
            settings: { sequentialTesting: false },
          },
        },
      }),
      healthSettings: baseHealthSettings,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [
        {
          id: "mg_empty",
          organization: "org_1",
          dateCreated: daysAgo(30),
          dateUpdated: daysAgo(1),
          name: "Empty goal group",
          description: "",
          owner: "",
          tags: [],
          projects: [],
          metrics: [],
          datasource: "ds_1",
          archived: false,
        },
      ],
    });

    expect(result?.status).toBe("scheduled-end-review");
    expect(result?.tooltip).toContain("No goal metrics are configured");
  });

  it("keeps unhealthy precedence over scheduled-end-review when the scheduled end passed", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({
        stopAt: daysAgo(1),
        analysisSummary: {
          snapshotId: "snap-1",
          health: {
            srm: 0.0001,
            multipleExposures: 0,
            totalUsers: 1_000_000,
          },
        },
      }),
      healthSettings: baseHealthSettings,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [],
    });

    expect(result?.status).toBe("unhealthy");
  });

  it("uses the scheduled end date for days-left even when power reports a different estimate", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({
        // ~2.5 days out, so ceil() yields 3
        stopAt: hoursFromNow(60),
        analysisSummary: {
          snapshotId: "snap-1",
          health: {
            srm: 0.5,
            multipleExposures: 0,
            totalUsers: 1000,
            power: {
              type: "success",
              isLowPowered: false,
              additionalDaysNeeded: 10,
            },
          },
        },
      }),
      healthSettings: baseHealthSettings,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [],
    });

    expect(result?.status).toBe("days-left");
    expect(result).toMatchObject({ status: "days-left", daysLeft: 3 });
    expect(result?.tooltip).toContain("scheduled to end in about 3 days");
  });

  it("suppresses the low-power unhealthy warning when a scheduled end is set", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({
        stopAt: hoursFromNow(60),
        analysisSummary: {
          snapshotId: "snap-1",
          health: {
            srm: 0.5,
            multipleExposures: 0,
            totalUsers: 1000,
            power: {
              type: "success",
              isLowPowered: true,
              additionalDaysNeeded: 10,
            },
          },
        },
      }),
      healthSettings: baseHealthSettings,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [],
    });

    expect(result?.status).toBe("days-left");
    expect(result).toMatchObject({ status: "days-left", daysLeft: 3 });
  });

  it("falls back to power-driven days-left when there is no scheduled end", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({
        analysisSummary: {
          snapshotId: "snap-1",
          health: {
            srm: 0.5,
            multipleExposures: 0,
            totalUsers: 1000,
            power: {
              type: "success",
              isLowPowered: false,
              additionalDaysNeeded: 10,
            },
          },
        },
      }),
      healthSettings: baseHealthSettings,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [],
    });

    expect(result).toMatchObject({ status: "days-left", daysLeft: 10 });
    expect(result?.tooltip ?? "").not.toContain("scheduled to end");
  });

  it("renders schedule-driven days-left even with the Decision Framework disabled", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({ stopAt: hoursFromNow(60) }),
      healthSettings: {
        ...baseHealthSettings,
        decisionFrameworkEnabled: false,
      },
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [],
    });

    expect(result).toMatchObject({ status: "days-left", daysLeft: 3 });
    expect(result?.tooltip).toContain("scheduled to end in about 3 days");
  });

  const incompleteAnalysisSummary: ExperimentDataForStatus["analysisSummary"] =
    {
      snapshotId: "snap-1",
      health: {
        srm: 0.5,
        multipleExposures: 0,
        totalUsers: 1000,
        power: {
          type: "success",
          isLowPowered: false,
          additionalDaysNeeded: 0,
        },
      },
      resultsStatus: {
        variations: [
          {
            variationId: "1",
            goalMetrics: {
              "metric-1": { status: "failed", superStatSigStatus: "failed" },
            },
            guardrailMetrics: {},
          },
        ],
        settings: { sequentialTesting: false },
      },
    };

  it("withholds data-incomplete while the experiment is before its minimum duration", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({
        dateStarted: daysAgo(2),
        analysisSummary: incompleteAnalysisSummary,
      }),
      healthSettings: baseHealthSettings,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [],
    });

    expect(result?.status).toBe("before-min-duration");
  });

  it("surfaces data-incomplete once the experiment is past its minimum duration", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({
        dateStarted: daysAgo(30),
        analysisSummary: incompleteAnalysisSummary,
      }),
      healthSettings: baseHealthSettings,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [],
    });

    expect(result?.status).toBe("data-incomplete");
  });

  it("expands metric groups so a failed group member is seen", () => {
    const result = getExperimentResultStatus({
      experimentData: makeExperimentData({
        dateStarted: daysAgo(30),
        goalMetrics: ["mg_1"],
        analysisSummary: incompleteAnalysisSummary,
      }),
      healthSettings: baseHealthSettings,
      decisionCriteria: PRESET_DECISION_CRITERIA,
      metricGroups: [
        { id: "mg_1", metrics: ["metric-1"] } as MetricGroupInterface,
      ],
    });

    expect(result).toEqual({
      status: "data-incomplete",
      failedMetrics: ["metric-1"],
    });
  });
});
