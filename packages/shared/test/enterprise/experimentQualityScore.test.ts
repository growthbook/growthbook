import { ExperimentHealthSettings } from "shared/types/experiment";
import {
  ExperimentForQualityScore,
  computeAIQualityInputsHash,
  getAICheckHashInputs,
  getExperimentDigestForCustomRules,
  getExperimentQualityScore,
  resolveExperimentQualityScoreSettings,
  reflowShares,
  roundToTotal,
} from "../../src/enterprise/experimentQualityScore";
import { resolveQualityScope } from "../../src/enterprise/experimentationHealth";

const healthSettings: ExperimentHealthSettings = {
  decisionFrameworkEnabled: true,
  srmThreshold: 0.001,
  multipleExposureMinPercent: 0.01,
  experimentMinLengthDays: 3,
};

const NOW = new Date("2026-07-23T12:00:00Z");

function makePhase(dateStarted: Date, dateEnded?: Date) {
  return {
    name: "Main",
    reason: "",
    coverage: 1,
    condition: "",
    variationWeights: [0.5, 0.5],
    variations: [],
    dateStarted,
    ...(dateEnded ? { dateEnded } : {}),
  };
}

function baseExperiment(
  overrides: Partial<ExperimentForQualityScore> = {},
): ExperimentForQualityScore {
  return {
    type: "standard",
    status: "stopped",
    hypothesis: "Bigger CTA increases signups",
    description: "Testing a larger CTA button",
    tags: ["growth"],
    project: "",
    owner: "u_abc123",
    phases: [
      makePhase(
        new Date("2026-06-01T00:00:00Z"),
        new Date("2026-07-01T00:00:00Z"),
      ),
    ],
    variations: [
      {
        id: "0",
        name: "Control",
        key: "0",
        screenshots: [{ path: "/img/control.png" }],
      },
      {
        id: "1",
        name: "Big CTA",
        key: "1",
        screenshots: [{ path: "/img/variation.png" }],
      },
    ],
    goalMetrics: ["met_signups"],
    results: "won",
    releasedVariationId: "1",
    analysis: "The larger CTA won; we should apply this to all pages.",
    analysisSummary: {
      snapshotId: "snap_1",
      health: {
        srm: 0.9,
        multipleExposures: 0,
        totalUsers: 10000,
        power: {
          type: "success",
          isLowPowered: false,
          additionalDaysNeeded: 0,
        },
      },
    },
    dismissedWarnings: [],
    ...overrides,
  };
}

function freshAIResults(
  experiment: ExperimentForQualityScore,
  settings = resolveExperimentQualityScoreSettings(),
  goalMetricNames = ["Signups"],
) {
  return {
    inputsHash: computeAIQualityInputsHash({
      hypothesis: experiment.hypothesis,
      analysis: experiment.analysis,
      goalMetricNames,
      aiCheckContexts: getAICheckHashInputs(settings),
    }),
    checks: [
      { key: "ai-hypothesis-quality" as const, score: 1, reason: "Clear" },
      {
        key: "ai-hypothesis-metric-alignment" as const,
        score: 1,
        reason: "Aligned",
      },
      { key: "ai-learnings-quality" as const, score: 1, reason: "Actionable" },
    ],
  };
}

function score(
  experiment: ExperimentForQualityScore,
  settings = resolveExperimentQualityScoreSettings(),
  goalMetricNames = ["Signups"],
) {
  return getExperimentQualityScore({
    experiment,
    settings,
    healthSettings,
    goalMetricNames,
    now: NOW,
  });
}

function sectionByKey(result: ReturnType<typeof score>, key: string) {
  const section = result.sections.find((s) => s.key === key);
  if (!section) throw new Error(`Missing section ${key}`);
  return section;
}

function checkByKey(result: ReturnType<typeof score>, key: string) {
  for (const section of result.sections) {
    const check = section.checks.find((c) => c.key === key);
    if (check) return check;
  }
  return undefined;
}

describe("resolveExperimentQualityScoreSettings", () => {
  it("uses design default shares 35/25/20/20", () => {
    const resolved = resolveExperimentQualityScoreSettings();
    expect(resolved.sections.documentation.share).toBeCloseTo(0.35, 9);
    expect(resolved.sections.results.share).toBeCloseTo(0.25, 9);
    expect(resolved.sections.health.share).toBeCloseTo(0.2, 9);
    expect(resolved.sections.ai.share).toBeCloseTo(0.2, 9);
  });

  it("defaults screenshots and min-runtime to disabled", () => {
    const resolved = resolveExperimentQualityScoreSettings();
    expect(resolved.checks["screenshots"].enabled).toBe(false);
    expect(resolved.checks["min-runtime"].enabled).toBe(false);
    expect(resolved.checks["screenshots"].split).toBe(0);
    const docSplits = (
      [
        "hypothesis",
        "description",
        "tags-or-project",
        "goal-metrics",
        "owner",
      ] as const
    )
      .map((k) => resolved.checks[k].split)
      .reduce((a, b) => a + b, 0);
    expect(docSplits).toBeCloseTo(1, 9);
  });

  it("redistributes the AI share when aiChecksEnabled is false", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
    });
    expect(resolved.sections.ai.enabled).toBe(false);
    expect(resolved.sections.ai.share).toBe(0);
    expect(resolved.sections.documentation.share).toBeCloseTo(35 / 80, 9);
    expect(resolved.sections.results.share).toBeCloseTo(25 / 80, 9);
    expect(resolved.sections.health.share).toBeCloseTo(20 / 80, 9);
  });

  it("treats scaled raw weights as identical shares", () => {
    const scaled = resolveExperimentQualityScoreSettings({
      sections: {
        documentation: { weight: 7 },
        results: { weight: 5 },
        health: { weight: 4 },
        ai: { weight: 4 },
      },
    });
    expect(scaled.sections.documentation.share).toBeCloseTo(0.35, 9);
    expect(scaled.sections.ai.share).toBeCloseTo(0.2, 9);
  });

  it("falls back to equal shares when all enabled weights are zero", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
      sections: {
        documentation: { weight: 0 },
        results: { weight: 0 },
        health: { weight: 0 },
      },
    });
    expect(resolved.sections.documentation.share).toBeCloseTo(1 / 3, 9);
  });

  it("treats a section with every check disabled as disabled", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      checks: {
        decision: { enabled: false },
        learnings: { enabled: false },
      },
    });
    expect(resolved.sections.results.enabled).toBe(false);
    expect(resolved.sections.results.share).toBe(0);
    expect(resolved.sections.documentation.share).toBeCloseTo(35 / 75, 9);
  });

  it("resolving without a config (or with a dangling config id) yields catalog defaults", () => {
    // A deleted/missing referenced config resolves as undefined → defaults
    const fromUndefined = resolveExperimentQualityScoreSettings(undefined);
    const fromNull = resolveExperimentQualityScoreSettings(null);
    expect(fromUndefined.sections.documentation.share).toBeCloseTo(0.35, 9);
    expect(fromNull.sections.documentation.share).toBeCloseTo(0.35, 9);
  });

  describe("resolveQualityScope", () => {
    it("is off with no records", () => {
      expect(resolveQualityScope(undefined, undefined)).toEqual({
        enabled: false,
        configId: undefined,
        overridden: { enabled: false, configId: false },
      });
    });

    it("inherits every field from the organization default", () => {
      const scope = resolveQualityScope(
        { quality: { enabled: true, configId: "eqc__org" } },
        null,
      );
      expect(scope.enabled).toBe(true);
      expect(scope.configId).toBe("eqc__org");
      expect(scope.overridden).toEqual({ enabled: false, configId: false });
    });

    it("lets a Project override each field independently", () => {
      const org = { quality: { enabled: true, configId: "eqc__org" } };

      const disabledOnly = resolveQualityScope(org, {
        quality: { enabled: false },
      });
      expect(disabledOnly.enabled).toBe(false);
      expect(disabledOnly.configId).toBe("eqc__org");
      expect(disabledOnly.overridden).toEqual({
        enabled: true,
        configId: false,
      });

      const configOnly = resolveQualityScope(org, {
        quality: { configId: "eqc__proj" },
      });
      expect(configOnly.enabled).toBe(true);
      expect(configOnly.configId).toBe("eqc__proj");
      expect(configOnly.overridden).toEqual({
        enabled: false,
        configId: true,
      });
    });

    it("lets a Project turn scoring on when the organization has it off", () => {
      const scope = resolveQualityScope(
        { quality: { enabled: false } },
        { quality: { enabled: true } },
      );
      expect(scope.enabled).toBe(true);
      expect(scope.configId).toBeUndefined();
    });
  });

  it("sanitizes params, merging defaults", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      checks: {
        "goal-metrics": { enabled: true, params: { maxGoalMetrics: 5 } },
        "min-runtime": { enabled: true },
      },
    });
    expect(resolved.checks["goal-metrics"].params).toEqual({
      maxGoalMetrics: 5,
    });
    expect(resolved.checks["min-runtime"].params).toEqual({
      minRuntimeDays: 14,
    });
  });
});

describe("computeAIQualityInputsHash", () => {
  const base = {
    hypothesis: "h",
    analysis: "a",
    goalMetricNames: ["Signups"],
    aiCheckContexts: [] as Array<
      [
        (
          | "ai-hypothesis-quality"
          | "ai-hypothesis-metric-alignment"
          | "ai-learnings-quality"
        ),
        string,
      ]
    >,
  };

  it("is stable regardless of metric name order", () => {
    const a = computeAIQualityInputsHash({
      ...base,
      goalMetricNames: ["Revenue", "Signups"],
    });
    const b = computeAIQualityInputsHash({
      ...base,
      goalMetricNames: ["Signups", "Revenue"],
    });
    expect(a).toBe(b);
  });

  it("changes when any input changes, including per-check contexts and the enabled set", () => {
    const hash = computeAIQualityInputsHash(base);
    expect(computeAIQualityInputsHash({ ...base, hypothesis: "h2" })).not.toBe(
      hash,
    );
    expect(
      computeAIQualityInputsHash({
        ...base,
        aiCheckContexts: [["ai-hypothesis-quality", ""]],
      }),
    ).not.toBe(hash);
    expect(
      computeAIQualityInputsHash({
        ...base,
        aiCheckContexts: [["ai-hypothesis-quality", "judge strictly"]],
      }),
    ).not.toBe(hash);
  });

  it("getAICheckHashInputs reflects enabled AI checks and their contexts", () => {
    const settings = resolveExperimentQualityScoreSettings({
      checks: {
        "ai-learnings-quality": { enabled: false },
        "ai-hypothesis-quality": {
          enabled: true,
          aiContext: "prefer falsifiable",
        },
      },
    });
    expect(getAICheckHashInputs(settings)).toEqual([
      ["ai-hypothesis-metric-alignment", ""],
      ["ai-hypothesis-quality", "prefer falsifiable"],
    ]);
  });
});

describe("getExperimentQualityScore", () => {
  it("scores 100 when everything passes and section points sum to 100", () => {
    const experiment = baseExperiment();
    experiment.aiQualityResults = freshAIResults(experiment);
    const result = score(experiment);
    expect(result.score).toBe(100);
    expect(result.computedScore).toBe(100);
    expect(result.pending).toBe(false);
    const totalPossible = result.sections.reduce(
      (sum, s) => sum + s.possiblePoints,
      0,
    );
    expect(totalPossible).toBeCloseTo(100, 6);
    const totalEarned = result.sections.reduce(
      (sum, s) => sum + s.earnedPoints,
      0,
    );
    expect(totalEarned).toBeCloseTo(100, 6);
  });

  it("renormalizes when the results section is N/A (running experiment)", () => {
    const experiment = baseExperiment({
      status: "running",
      results: undefined,
      analysis: undefined,
      releasedVariationId: "",
      phases: [makePhase(new Date("2026-06-01T00:00:00Z"))],
    });
    experiment.aiQualityResults = freshAIResults(experiment);
    const result = score(experiment);
    const results = sectionByKey(result, "results");
    expect(results.applicable).toBe(false);
    expect(results.possiblePoints).toBe(0);
    // ai-learnings-quality is also N/A while running; remaining checks all
    // pass, so the renormalized score is still 100
    expect(result.score).toBe(100);
    const totalPossible = result.sections.reduce(
      (sum, s) => sum + s.possiblePoints,
      0,
    );
    expect(totalPossible).toBeCloseTo(100, 6);
    // Documentation absorbed more than its configured 35%
    expect(
      sectionByKey(result, "documentation").possiblePoints,
    ).toBeGreaterThan(35);
  });

  it("computes proportional section points for partial failures", () => {
    // Documentation-only config with two enabled equal-split checks: one
    // passes (hypothesis), one fails (description)
    const settings = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
      sections: {
        results: { enabled: false },
        health: { enabled: false },
      },
      checks: {
        screenshots: { enabled: false },
        "tags-or-project": { enabled: false },
        "goal-metrics": { enabled: false },
        owner: { enabled: false },
      },
    });
    const experiment = baseExperiment({ description: "" });
    const result = score(experiment, settings);
    expect(result.score).toBe(50);
    const doc = sectionByKey(result, "documentation");
    expect(doc.possiblePoints).toBeCloseTo(100, 6);
    expect(doc.earnedPoints).toBeCloseTo(50, 6);
  });

  it("excludes pending AI checks from numerator and denominator", () => {
    const experiment = baseExperiment(); // no aiQualityResults cached
    const result = score(experiment);
    expect(result.pending).toBe(true);
    // All deterministic checks pass → 100 despite pending AI
    expect(result.score).toBe(100);
    const ai = sectionByKey(result, "ai");
    expect(ai.possiblePoints).toBe(0);
    expect(checkByKey(result, "ai-hypothesis-quality")?.score).toBeNull();
  });

  it("treats stale AI results (hash mismatch) as pending", () => {
    const experiment = baseExperiment();
    experiment.aiQualityResults = {
      ...freshAIResults(experiment),
      inputsHash: "stale",
    };
    const result = score(experiment);
    expect(result.pending).toBe(true);
    expect(checkByKey(result, "ai-hypothesis-quality")?.score).toBeNull();
  });

  it("returns null score when nothing is scorable", () => {
    const settings = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
      sections: {
        documentation: { enabled: false },
        results: { enabled: false },
        health: { enabled: false },
      },
    });
    const result = score(baseExperiment(), settings);
    expect(result.score).toBeNull();
    expect(result.computedScore).toBeNull();
    expect(result.pending).toBe(false);
  });

  it("counts applied vs enabled checks", () => {
    const experiment = baseExperiment({
      status: "running",
      results: undefined,
      analysis: undefined,
      releasedVariationId: "",
    });
    const result = score(experiment);
    // Enabled by default: 5 documentation (screenshots off) + 2 results +
    // 2 health (min-runtime off) + 3 ai = 12
    expect(result.totalEnabledCheckCount).toBe(12);
    // N/A while running: decision, learnings, ai-learnings-quality
    expect(result.appliedCheckCount).toBe(9);
  });

  describe("new checks", () => {
    it("owner check passes and fails", () => {
      expect(checkByKey(score(baseExperiment()), "owner")?.score).toBe(1);
      expect(
        checkByKey(score(baseExperiment({ owner: " " })), "owner")?.score,
      ).toBe(0);
    });

    it("goal-metrics enforces fewer-than-max", () => {
      const none = checkByKey(
        score(baseExperiment({ goalMetrics: [] })),
        "goal-metrics",
      );
      expect(none?.score).toBe(0);
      expect(none?.reason).toBe("No goal metrics selected");

      const tooMany = checkByKey(
        score(baseExperiment({ goalMetrics: ["a", "b", "c", "d"] })),
        "goal-metrics",
      );
      expect(tooMany?.score).toBe(0);
      expect(tooMany?.reason).toContain("4 goal metrics");

      const two = checkByKey(
        score(baseExperiment({ goalMetrics: ["a", "b"] })),
        "goal-metrics",
      );
      expect(two?.score).toBe(1);

      const customMax = resolveExperimentQualityScoreSettings({
        checks: {
          "goal-metrics": { enabled: true, params: { maxGoalMetrics: 5 } },
        },
      });
      expect(
        checkByKey(
          score(
            baseExperiment({ goalMetrics: ["a", "b", "c", "d"] }),
            customMax,
          ),
          "goal-metrics",
        )?.score,
      ).toBe(1);
    });

    it("min-runtime measures phases against the threshold", () => {
      const settings = resolveExperimentQualityScoreSettings({
        checks: { "min-runtime": { enabled: true } },
      });

      // 30 days stopped → passes 14-day default
      expect(
        checkByKey(score(baseExperiment(), settings), "min-runtime")?.score,
      ).toBe(1);

      // 5 days → fails with reason
      const shortRun = baseExperiment({
        phases: [
          makePhase(
            new Date("2026-06-01T00:00:00Z"),
            new Date("2026-06-06T00:00:00Z"),
          ),
        ],
      });
      const failed = checkByKey(score(shortRun, settings), "min-runtime");
      expect(failed?.score).toBe(0);
      expect(failed?.reason).toBe("Ran 5 of 14 minimum days");

      // Running experiment measured against `now` (3 days before NOW)
      const running = baseExperiment({
        status: "running",
        results: undefined,
        analysis: undefined,
        releasedVariationId: "",
        phases: [makePhase(new Date("2026-07-20T00:00:00Z"))],
      });
      expect(checkByKey(score(running, settings), "min-runtime")?.score).toBe(
        0,
      );

      // Draft → N/A
      const draft = baseExperiment({ status: "draft", phases: [] });
      expect(
        checkByKey(score(draft, settings), "min-runtime")?.applicable,
      ).toBe(false);
    });
  });

  describe("manual override", () => {
    it("override becomes the effective score; computed stays available", () => {
      const experiment = baseExperiment({
        hypothesis: "",
        description: "",
        qualityScoreOverride: {
          score: 85,
          userId: "u_1",
          userName: "Graham",
          dateOverridden: new Date("2026-07-23T00:00:00Z"),
          reason: "Known good experiment",
        },
      });
      const result = score(experiment);
      expect(result.score).toBe(85);
      expect(result.computedScore).not.toBe(85);
      expect(result.override?.userName).toBe("Graham");
    });

    it("null override is ignored", () => {
      const result = score(baseExperiment({ qualityScoreOverride: null }));
      expect(result.override).toBeNull();
      expect(result.score).toBe(result.computedScore);
    });
  });
});

describe("custom AI rules", () => {
  const customSettings = resolveExperimentQualityScoreSettings({
    customAiChecks: [
      { id: "rule1", name: "Metric budget", rule: "Fewer than 20 metrics" },
    ],
  });

  it("joins the AI section's split alongside built-in AI checks", () => {
    // 3 built-in AI checks + 1 custom, equal weights → 25% each
    expect(customSettings.customAiChecks).toHaveLength(1);
    expect(customSettings.customAiChecks[0].key).toBe("custom:rule1");
    expect(customSettings.customAiChecks[0].split).toBeCloseTo(0.25, 9);
    expect(customSettings.checks["ai-hypothesis-quality"].split).toBeCloseTo(
      0.25,
      9,
    );
  });

  it("keeps the AI section alive when only custom checks are enabled", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      checks: {
        "ai-hypothesis-quality": { enabled: false },
        "ai-hypothesis-metric-alignment": { enabled: false },
        "ai-learnings-quality": { enabled: false },
      },
      customAiChecks: [
        { id: "rule1", name: "Metric budget", rule: "Fewer than 20 metrics" },
      ],
    });
    expect(resolved.sections.ai.enabled).toBe(true);
    expect(resolved.customAiChecks[0].split).toBeCloseTo(1, 9);
  });

  it("is disabled with the AI section", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
      customAiChecks: [
        { id: "rule1", name: "Metric budget", rule: "Fewer than 20 metrics" },
      ],
    });
    expect(resolved.customAiChecks[0].enabled).toBe(false);
    expect(resolved.customAiChecks[0].split).toBe(0);
  });

  it("scores from a cached verdict and is pending without one", () => {
    const experiment = baseExperiment();
    const pendingResult = score(experiment, customSettings);
    expect(pendingResult.pending).toBe(true);
    const pendingCheck = checkByKey(pendingResult, "custom:rule1");
    expect(pendingCheck?.applicable).toBe(true);
    expect(pendingCheck?.score).toBeNull();
    expect(pendingCheck?.label).toBe("Metric budget");

    const withVerdict = baseExperiment();
    withVerdict.aiQualityResults = {
      inputsHash: computeAIQualityInputsHash({
        hypothesis: withVerdict.hypothesis,
        analysis: withVerdict.analysis,
        goalMetricNames: ["Signups"],
        aiCheckContexts: getAICheckHashInputs(customSettings),
        experimentDigest: getExperimentDigestForCustomRules(withVerdict, [
          "Signups",
        ]),
      }),
      checks: [
        ...freshAIResults(withVerdict).checks,
        { key: "custom:rule1", score: 0.8, reason: "Within budget" },
      ],
    };
    const result = score(withVerdict, customSettings);
    expect(result.pending).toBe(false);
    const check = checkByKey(result, "custom:rule1");
    expect(check?.score).toBe(0.8);
    expect(check?.reason).toBe("Within budget");
  });

  it("invalidates verdicts when the rule text or the experiment changes", () => {
    const experiment = baseExperiment();
    const base = {
      hypothesis: experiment.hypothesis,
      analysis: experiment.analysis,
      goalMetricNames: ["Signups"],
      aiCheckContexts: getAICheckHashInputs(customSettings),
      experimentDigest: getExperimentDigestForCustomRules(experiment, [
        "Signups",
      ]),
    };
    const hash = computeAIQualityInputsHash(base);

    const editedRule = resolveExperimentQualityScoreSettings({
      customAiChecks: [
        { id: "rule1", name: "Metric budget", rule: "Fewer than 10 metrics" },
      ],
    });
    expect(
      computeAIQualityInputsHash({
        ...base,
        aiCheckContexts: getAICheckHashInputs(editedRule),
      }),
    ).not.toBe(hash);

    // Custom rules see the whole experiment — a tag change re-runs them
    const taggedExperiment = baseExperiment({ tags: ["growth", "new-tag"] });
    expect(
      computeAIQualityInputsHash({
        ...base,
        experimentDigest: getExperimentDigestForCustomRules(taggedExperiment, [
          "Signups",
        ]),
      }),
    ).not.toBe(hash);
  });
});

describe("share math", () => {
  it("roundToTotal produces integers that sum to the total", () => {
    expect(roundToTotal([33.33, 33.33, 33.34])).toEqual([33, 33, 34]);
    const rounded = roundToTotal([35.5, 24.5, 20.0, 20.0]);
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(100);
    expect(roundToTotal([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("reflowShares sets one share and re-flows the rest to the total", () => {
    expect(reflowShares([34, 33, 33], 1, 40)).toEqual([30, 40, 30]);
    expect(reflowShares([0, 100, 0], 1, 60)).toEqual([20, 60, 20]);
    expect(reflowShares([50, 50], 0, 120)).toEqual([100, 0]);
    expect(reflowShares([25], 0, 10)).toEqual([100]);
  });
});
