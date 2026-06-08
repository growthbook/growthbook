import {
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentAnalysisSummaryVariationStatus,
  DecisionCriteriaRule,
  DecisionCriteriaData,
} from "shared/types/experiment";
import {
  getDecisionFrameworkStatus,
  evaluateDecisionRuleOnVariation,
  getVariationDecisions,
} from "../src/enterprise/decision-criteria/decisionCriteria";
import { PRESET_DECISION_CRITERIA } from "../src/enterprise/decision-criteria/constants";

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
    // pre-power, no sequential testing => decisionReady is false
    const daysNeeded = undefined;

    // winning regular stat sig is not enough to ship pre-power (statsigWinner
    // is suppressed and the preset ship rule has no superStatsigWinner condition)
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

    // losing regular stat sig DOES trigger a rollback pre-power: harm is
    // detected early via statsigLoser (which is never suppressed)
    const negRegularDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "lost", superStatSigStatus: "neutral" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(negRegularDecision).toEqual({
      status: "rollback-now",
      variations: [
        {
          variationId: "1",
          decidingRule: PRESET_DECISION_CRITERIA.rules[2],
          triggeredMetricIds: ["1"],
        },
      ],
      sequentialUsed: false,
      powerReached: false,
      tooltip: "The test variation(s) should be rolled back.",
    });

    // super stat sig winner alone does NOT ship with the preset, because the
    // preset ship rule uses regular statsigWinner (no early-ship opt-in)
    const noEarlyShipDecision = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "won" } },
      }),
      decisionCriteria: PRESET_DECISION_CRITERIA,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded,
    });
    expect(noEarlyShipDecision).toEqual(undefined);

    // a failing guardrail triggers rollback pre-power
    const guardrailFailureDecision = getDecisionFrameworkStatus({
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
    expect(guardrailFailureDecision).toEqual({
      status: "rollback-now",
      variations: [
        {
          variationId: "1",
          decidingRule: PRESET_DECISION_CRITERIA.rules[1],
          triggeredMetricIds: ["01"],
        },
      ],
      sequentialUsed: false,
      powerReached: false,
      tooltip: "The test variation(s) should be rolled back.",
    });

    // a safe guardrail with no goal metrics does not ship pre-power
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
    expect(guardrailSafeDecision).toEqual(undefined);

    // losing super stat sig also triggers a rollback pre-power
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
        {
          variationId: "1",
          decidingRule: PRESET_DECISION_CRITERIA.rules[2],
          triggeredMetricIds: ["1"],
        },
      ],
      sequentialUsed: false,
      powerReached: false,
      tooltip: "The test variation(s) should be rolled back.",
    });

    // losing on one variation but not the other is not enough for rollback-now
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
        {
          variationId: "1",
          decidingRule: PRESET_DECISION_CRITERIA.rules[0],
          triggeredMetricIds: ["1"],
        },
      ],
      sequentialUsed: false,
      powerReached: true,
      tooltip: "A test variation is ready to ship.",
    });

    // neutral triggers no decision other than the default review
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
      tooltip: "A test variation is ready to be reviewed.",
    });

    // Guardrail failure defaults to rollback
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
        {
          variationId: "1",
          decidingRule: PRESET_DECISION_CRITERIA.rules[1],
          triggeredMetricIds: ["01"],
        },
      ],
      sequentialUsed: false,
      powerReached: true,
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
        {
          variationId: "1",
          decidingRule: PRESET_DECISION_CRITERIA.rules[2],
          triggeredMetricIds: ["1"],
        },
      ],
      sequentialUsed: false,
      powerReached: true,
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
        {
          variationId: "1",
          decidingRule: PRESET_DECISION_CRITERIA.rules[2],
          triggeredMetricIds: ["1"],
        },
        {
          variationId: "2",
          decidingRule: PRESET_DECISION_CRITERIA.rules[2],
          triggeredMetricIds: ["1"],
        },
      ],
      sequentialUsed: false,
      powerReached: true,
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
      tooltip: "A test variation is ready to be reviewed.",
    });
  });

  it("ships early only with an explicit superStatsigWinner direction", () => {
    const earlyShipCriteria: DecisionCriteriaData = {
      id: "test-early-ship",
      name: "Early Ship",
      rules: [
        {
          conditions: [
            {
              match: "all",
              metrics: "goals",
              direction: "superStatsigWinner",
            },
            {
              match: "none",
              metrics: "guardrails",
              direction: "statsigLoser",
            },
          ],
          action: "ship",
        },
      ],
      defaultAction: "review",
    };

    // pre-power, super stat sig winner => ships early
    const earlyShip = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "won" } },
      }),
      decisionCriteria: earlyShipCriteria,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded: undefined,
    });
    expect(earlyShip).toEqual({
      status: "ship-now",
      variations: [
        {
          variationId: "1",
          decidingRule: earlyShipCriteria.rules[0],
          triggeredMetricIds: ["1"],
        },
      ],
      sequentialUsed: false,
      powerReached: false,
      tooltip: "A test variation is ready to ship.",
    });

    // pre-power, regular winner but not super => does not ship early
    const noEarlyShip = getDecisionFrameworkStatus({
      resultsStatus: setMetricsOnResultsStatus({
        resultsStatus,
        goalMetrics: { "1": { status: "won", superStatSigStatus: "neutral" } },
      }),
      decisionCriteria: earlyShipCriteria,
      goalMetrics: ["1"],
      guardrailMetrics: [],
      daysNeeded: undefined,
    });
    expect(noEarlyShip).toEqual(undefined);
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
      decisionReady: true,
    });
    expect(allWinning?.action).toEqual("ship");

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
      decisionReady: true,
    });
    expect(oneLosing).toBeUndefined();
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
      decisionReady: true,
    });
    expect(oneWinning?.action).toEqual("ship");

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
      decisionReady: true,
    });
    expect(noneWinning).toBeUndefined();
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
      decisionReady: true,
    });
    expect(noneLosing?.action).toEqual("ship");

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
      decisionReady: true,
    });
    expect(oneLosing).toBeUndefined();
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
      decisionReady: true,
    });
    expect(allLosing?.action).toEqual("rollback");

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
      decisionReady: true,
    });
    expect(oneLosing).toBeUndefined();
  });

  it("suppresses regular statsigWinner before decision-ready, but not superStatsigWinner", () => {
    const regularRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "statsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };

    // Before decision-ready, a regular statsigWinner is suppressed (no match)
    const suppressed = evaluateDecisionRuleOnVariation({
      rule: regularRule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
        },
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      decisionReady: false,
    });
    expect(suppressed).toBeUndefined();

    // Once decision-ready, the regular statsigWinner matches
    const notSuppressed = evaluateDecisionRuleOnVariation({
      rule: regularRule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "neutral" },
        },
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      decisionReady: true,
    });
    expect(notSuppressed?.action).toEqual("ship");

    // superStatsigWinner checks superStatSigStatus and is never suppressed
    const superRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "superStatsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };
    const superMatch = evaluateDecisionRuleOnVariation({
      rule: superRule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "won" },
        },
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      decisionReady: false,
    });
    expect(superMatch?.action).toEqual("ship");

    // superStatsigWinner does not match if only regular status is "won"
    const superNoMatch = evaluateDecisionRuleOnVariation({
      rule: superRule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "won", superStatSigStatus: "neutral" },
        },
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      decisionReady: false,
    });
    expect(superNoMatch).toBeUndefined();
  });

  it("does not suppress regular statsigLoser before decision-ready", () => {
    const rule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "any" as const,
          direction: "statsigLoser" as const,
        },
      ],
      action: "rollback" as const,
    };

    const harmDetected = evaluateDecisionRuleOnVariation({
      rule,
      variationStatus: {
        ...baseVariationStatus,
        goalMetrics: {
          metric1: { status: "lost", superStatSigStatus: "neutral" },
        },
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      decisionReady: false,
    });
    expect(harmDetected?.action).toEqual("rollback");
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
          metrics: "guardrails" as const,
          match: "none" as const,
          direction: "statsigLoser" as const,
        },
      ],
      action: "ship" as const,
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
      decisionReady: true,
    });
    expect(allConditionsMet?.action).toEqual("ship");

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
      decisionReady: true,
    });
    expect(oneConditionNotMet).toBeUndefined();
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

  it("returns default action when power reached and null when not", () => {
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
      decisionReady: true,
      guardrailMetrics: [],
    });

    expect(results).toEqual([
      {
        decisionCriteriaAction: "review",
        variation: { variationId: "1", decidingRule: null },
      },
      {
        decisionCriteriaAction: "review",
        variation: { variationId: "2", decidingRule: null },
      },
    ]);

    // without power / not decision-ready, return null (no default fallback)
    const resultsWithoutPower = getVariationDecisions({
      resultsStatus: baseResultsStatus,
      decisionCriteria,
      goalMetrics: ["metric1"],
      powerReached: false,
      decisionReady: false,
      guardrailMetrics: [],
    });

    expect(resultsWithoutPower).toEqual([
      {
        decisionCriteriaAction: null,
        variation: { variationId: "1", decidingRule: null },
      },
      {
        decisionCriteriaAction: null,
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
      decisionReady: true,
    });

    expect(results).toEqual([
      {
        decisionCriteriaAction: "ship",
        variation: {
          variationId: "1",
          decidingRule: shipRule,
          triggeredMetricIds: ["metric1"],
        },
      },
      {
        decisionCriteriaAction: "rollback",
        variation: {
          variationId: "2",
          decidingRule: rollbackRule,
          triggeredMetricIds: ["metric1"],
        },
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
      decisionReady: true,
    });

    // Both variations match the first rule (any metric winning)
    expect(results).toEqual([
      {
        decisionCriteriaAction: "ship",
        variation: {
          variationId: "1",
          decidingRule: shipRule,
          triggeredMetricIds: ["metric1"],
        },
      },
      {
        decisionCriteriaAction: "ship",
        variation: {
          variationId: "2",
          decidingRule: shipRule,
          triggeredMetricIds: ["metric1", "metric2"],
        },
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
      decisionReady: true,
    });

    expect(results).toEqual([
      {
        decisionCriteriaAction: "rollback",
        variation: {
          variationId: "1",
          decidingRule: rollbackRule,
          triggeredMetricIds: ["guardrail1", "guardrail2"],
        },
      },
      {
        decisionCriteriaAction: "review",
        variation: { variationId: "2", decidingRule: null },
      },
    ]);
  });

  it("only ships pre-power with an explicit superStatsigWinner rule", () => {
    const regularShipRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "statsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };
    const superShipRule: DecisionCriteriaRule = {
      conditions: [
        {
          metrics: "goals" as const,
          match: "all" as const,
          direction: "superStatsigWinner" as const,
        },
      ],
      action: "ship" as const,
    };

    const variations = [
      {
        variationId: "1",
        goalMetrics: {
          metric1: {
            status: "won" as const,
            superStatSigStatus: "won" as const,
          },
        },
        guardrailMetrics: {},
      },
      {
        variationId: "2",
        goalMetrics: {
          metric1: {
            status: "won" as const,
            superStatSigStatus: "won" as const,
          },
        },
        guardrailMetrics: {},
      },
    ];

    // regular statsigWinner ship rule is blocked pre-power
    const regularResults = getVariationDecisions({
      resultsStatus: {
        ...baseResultsStatus,
        variations,
        settings: { sequentialTesting: false },
      },
      decisionCriteria: {
        id: "test-criteria-5a",
        name: "Regular Ship",
        rules: [regularShipRule],
        defaultAction: "review" as const,
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      powerReached: false,
      decisionReady: false,
    });
    expect(regularResults).toEqual([
      {
        decisionCriteriaAction: null,
        variation: { variationId: "1", decidingRule: null },
      },
      {
        decisionCriteriaAction: null,
        variation: { variationId: "2", decidingRule: null },
      },
    ]);

    // superStatsigWinner ship rule fires pre-power
    const superResults = getVariationDecisions({
      resultsStatus: {
        ...baseResultsStatus,
        variations,
        settings: { sequentialTesting: false },
      },
      decisionCriteria: {
        id: "test-criteria-5b",
        name: "Super Ship",
        rules: [superShipRule],
        defaultAction: "review" as const,
      },
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      powerReached: false,
      decisionReady: false,
    });
    expect(superResults).toEqual([
      {
        decisionCriteriaAction: "ship",
        variation: {
          variationId: "1",
          decidingRule: superShipRule,
          triggeredMetricIds: ["metric1"],
        },
      },
      {
        decisionCriteriaAction: "ship",
        variation: {
          variationId: "2",
          decidingRule: superShipRule,
          triggeredMetricIds: ["metric1"],
        },
      },
    ]);
  });
});

describe("getDecisionFrameworkStatus handles early shipping correctly", () => {
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

  const shipRule: DecisionCriteriaRule = {
    conditions: [
      {
        metrics: "goals" as const,
        match: "all" as const,
        direction: "superStatsigWinner" as const,
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
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      daysNeeded: 100,
    });

    expect(decision).toEqual({
      status: "ship-now",
      variations: [
        {
          variationId: "1",
          decidingRule: shipRule,
          triggeredMetricIds: ["metric1"],
        },
      ],
      sequentialUsed: false,
      powerReached: false,
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
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
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
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      daysNeeded: 100,
    });

    expect(decision).toEqual({
      status: "ship-now",
      variations: [
        {
          variationId: "1",
          decidingRule: shipRule,
          triggeredMetricIds: ["metric1"],
        },
      ],
      sequentialUsed: false,
      powerReached: false,
      tooltip: "A test variation is ready to ship.",
    });
  });

  it("falls back to no result rather than the fallback action pre-power when results are not clear", () => {
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
        settings: { sequentialTesting: false },
      },
      decisionCriteria,
      goalMetrics: ["metric1"],
      guardrailMetrics: [],
      daysNeeded: 100,
    });

    expect(decision).toEqual(undefined);
  });
});
