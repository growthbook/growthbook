import {
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentAnalysisSummaryVariationStatus,
  DecisionCriteriaRule,
} from "back-end/types/experiment";
import {
  getDecisionFrameworkStatus,
  evaluateDecisionRuleOnVariation,
  getVariationDecisions,
  getEarlyStoppingVariationDecisions,
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
    expect(allWinning).toEqual("ship");

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
      requireSuperStatSig: false,
    });
    expect(oneWinning).toEqual("ship");

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
      requireSuperStatSig: false,
    });
    expect(noneLosing).toEqual("ship");

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
    const allWinning = evaluateDecisionRuleOnVariation({
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
    expect(allWinning).toEqual("rollback");

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
    expect(oneLosing).toBeUndefined();
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
    expect(superStatSigRequired).toBeUndefined();

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
    expect(superStatSigNotRequired).toEqual("ship");
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
      requireSuperStatSig: false,
    });
    expect(allConditionsMet).toEqual("ship");

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

  it("applies rules to each variation and returns default action if no rules match", () => {
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
    });

    expect(results).toEqual([
      {
        decisionCriteriaAction: "ship",
        variation: { variationId: "1", decidingRule: shipRule },
      },
      {
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
    });

    // Both variations match the first rule (any metric winning)
    expect(results).toEqual([
      {
        decisionCriteriaAction: "ship",
        variation: { variationId: "1", decidingRule: shipRule },
      },
      {
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
    });

    expect(results).toEqual([
      {
        decisionCriteriaAction: "rollback",
        variation: { variationId: "1", decidingRule: rollbackRule },
      },
      {
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
      // Should not go to fallback, should instead return null
      {
        decisionCriteriaAction: null,
        variation: { variationId: "1", decidingRule: null },
      },
      {
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

    expect(decision).toEqual({
      status: "ship-now",
      variations: [{ variationId: "1", decidingRule: shipRule }],
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
      variations: [{ variationId: "1", decidingRule: shipRule }],
      sequentialUsed: false,
      powerReached: false,
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
