import {
  ExperimentForQualityScore,
  computeAIQualityInputsHash,
  getChecksForSection,
  getAICheckHashInputs,
  getExperimentDigestForCustomRules,
  getExperimentQualityScore,
  resolveExperimentQualityScoreSettings,
  reflowShares,
  roundToTotal,
} from "../../src/enterprise/experimentQualityScore";
import { resolveQualityScope } from "../../src/enterprise/experimentationHealth";
import { EXPERIMENT_PROCESS_RULES_VERSION } from "../../src/enterprise/experimentProcess";

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
  it("uses default shares 40/30/30", () => {
    const resolved = resolveExperimentQualityScoreSettings();
    expect(resolved.sections.documentation.share).toBeCloseTo(0.4, 9);
    expect(resolved.sections.process.share).toBeCloseTo(0.3, 9);
    expect(resolved.sections.ai.share).toBeCloseTo(0.3, 9);
  });

  it("defaults screenshots and planned-end to disabled", () => {
    const resolved = resolveExperimentQualityScoreSettings();
    expect(resolved.checks["screenshots"].enabled).toBe(false);
    expect(resolved.checks["planned-end"].enabled).toBe(false);
    expect(resolved.checks["screenshots"].split).toBe(0);
    const docSplits = (
      [
        "hypothesis",
        "description",
        "tags-or-project",
        "goal-metrics",
        "decision",
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
    expect(resolved.sections.documentation.share).toBeCloseTo(40 / 70, 9);
    expect(resolved.sections.process.share).toBeCloseTo(30 / 70, 9);
  });

  it("treats scaled raw weights as identical shares", () => {
    const scaled = resolveExperimentQualityScoreSettings({
      sections: {
        documentation: { weight: 4 },
        process: { weight: 3 },
        ai: { weight: 3 },
      },
    });
    expect(scaled.sections.documentation.share).toBeCloseTo(0.4, 9);
    expect(scaled.sections.ai.share).toBeCloseTo(0.3, 9);
  });

  it("falls back to equal shares when all enabled weights are zero", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
      sections: {
        documentation: { weight: 0 },
        process: { weight: 0 },
      },
    });
    expect(resolved.sections.documentation.share).toBeCloseTo(1 / 2, 9);
  });

  it("treats a section with every check disabled as disabled", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      checks: Object.fromEntries(
        getChecksForSection("process").map((k) => [k, { enabled: false }]),
      ),
    });
    expect(resolved.sections.process.enabled).toBe(false);
    expect(resolved.sections.process.share).toBe(0);
    expect(resolved.sections.documentation.share).toBeCloseTo(40 / 70, 9);
  });

  it("resolving without a config yields catalog defaults", () => {
    const fromUndefined = resolveExperimentQualityScoreSettings(undefined);
    const fromNull = resolveExperimentQualityScoreSettings(null);
    expect(fromUndefined.sections.documentation.share).toBeCloseTo(0.4, 9);
    expect(fromNull.sections.documentation.share).toBeCloseTo(0.4, 9);
  });

  describe("resolveQualityScope", () => {
    const orgConfig = { aiChecksEnabled: false };
    const projectConfig = { sections: { process: { enabled: false } } };

    it("is off with no records", () => {
      expect(resolveQualityScope(undefined, undefined)).toEqual({
        enabled: false,
        config: undefined,
        overridden: { enabled: false, config: false },
      });
    });

    it("inherits every field from the organization default", () => {
      const scope = resolveQualityScope(
        { quality: { enabled: true, config: orgConfig } },
        null,
      );
      expect(scope.enabled).toBe(true);
      expect(scope.config).toBe(orgConfig);
      expect(scope.overridden).toEqual({ enabled: false, config: false });
    });

    it("lets a Project override each field independently", () => {
      const org = { quality: { enabled: true, config: orgConfig } };

      const disabledOnly = resolveQualityScope(org, {
        quality: { enabled: false },
      });
      expect(disabledOnly.enabled).toBe(false);
      expect(disabledOnly.config).toBe(orgConfig);
      expect(disabledOnly.overridden).toEqual({
        enabled: true,
        config: false,
      });

      const configOnly = resolveQualityScope(org, {
        quality: { config: projectConfig },
      });
      expect(configOnly.enabled).toBe(true);
      expect(configOnly.config).toBe(projectConfig);
      expect(configOnly.overridden).toEqual({
        enabled: false,
        config: true,
      });
    });

    it("lets a Project turn scoring on when the organization has it off", () => {
      const scope = resolveQualityScope(
        { quality: { enabled: false } },
        { quality: { enabled: true } },
      );
      expect(scope.enabled).toBe(true);
      expect(scope.config).toBeUndefined();
    });
  });

  it("sanitizes params, merging defaults", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      checks: {
        "goal-metrics": { enabled: true, params: { maxGoalMetrics: 5 } },
        "no-early-stop": { enabled: true },
      },
    });
    expect(resolved.checks["goal-metrics"].params).toEqual({
      maxGoalMetrics: 5,
    });
    expect(resolved.checks["no-early-stop"].params).toEqual({
      minRuntimeDays: 14,
    });
  });
});

describe("computeAIQualityInputsHash", () => {
  const base = {
    hypothesis: "h",
    goalMetricNames: ["Signups"],
    aiCheckContexts: [] as Array<
      ["ai-hypothesis-quality" | "ai-hypothesis-metric-alignment", string]
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

  it("renormalizes when the process section is N/A (running experiment)", () => {
    const experiment = baseExperiment({
      status: "running",
      results: undefined,
      analysis: undefined,
      releasedVariationId: "",
      phases: [makePhase(new Date("2026-06-01T00:00:00Z"))],
    });
    experiment.aiQualityResults = freshAIResults(experiment);
    const result = score(experiment);
    const process = sectionByKey(result, "process");
    expect(process.applicable).toBe(false);
    expect(process.possiblePoints).toBe(0);
    // Decision is also N/A while running; the remaining checks all pass,
    // so the renormalized score is still 100
    expect(result.score).toBe(100);
    const totalPossible = result.sections.reduce(
      (sum, s) => sum + s.possiblePoints,
      0,
    );
    expect(totalPossible).toBeCloseTo(100, 6);
    // Documentation absorbed more than its configured 40%
    expect(
      sectionByKey(result, "documentation").possiblePoints,
    ).toBeGreaterThan(40);
  });

  it("computes proportional section points for partial failures", () => {
    // Documentation-only config with two enabled equal-split checks: one
    // passes (hypothesis), one fails (description)
    const settings = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
      sections: { process: { enabled: false } },
      checks: {
        decision: { enabled: false },
        screenshots: { enabled: false },
        "tags-or-project": { enabled: false },
        "goal-metrics": { enabled: false },
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
        process: { enabled: false },
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
    // Enabled by default: 5 documentation (screenshots off) + 6 process
    // (planned-end off) + 2 ai = 13
    expect(result.totalEnabledCheckCount).toBe(13);
    // N/A while running: decision and the 6 process checks
    expect(result.appliedCheckCount).toBe(6);
  });

  describe("new checks", () => {
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
  });

  describe("process checks", () => {
    const processResults = (
      rules: NonNullable<ExperimentForQualityScore["processResults"]>["rules"],
      version = EXPERIMENT_PROCESS_RULES_VERSION,
    ) => ({ version, rules });

    it("only judges stopped experiments", () => {
      const running = baseExperiment({ status: "running" });
      expect(
        checkByKey(score(running), "goal-metrics-locked")?.applicable,
      ).toBe(false);
    });

    it("waits for current cached results", () => {
      for (const experiment of [
        baseExperiment(),
        baseExperiment({ processResults: processResults([], 0) }),
      ]) {
        const check = checkByKey(score(experiment), "goal-metrics-locked");
        expect(check?.applicable).toBe(true);
        expect(check?.score).toBeNull();
        expect(check?.reason).toBe("Still being calculated");
      }
    });

    it("scores cached results, with the failure's evidence", () => {
      const result = score(
        baseExperiment({
          processResults: processResults([
            { key: "goal-metrics-locked", result: "pass" },
            {
              key: "hypothesis-locked",
              result: "fail",
              detail: "Hypothesis changed while running",
              user: "Sam",
              date: "2026-06-10T00:00:00Z",
            },
            { key: "stable-analysis", result: "na" },
          ]),
        }),
      );
      expect(checkByKey(result, "goal-metrics-locked")?.score).toBe(1);
      expect(checkByKey(result, "hypothesis-locked")).toMatchObject({
        score: 0,
        reason: "Hypothesis changed while running",
        evidence: { user: "Sam", date: "2026-06-10T00:00:00Z" },
      });
      expect(checkByKey(result, "stable-analysis")?.applicable).toBe(false);
    });

    it("judges an early stop by the minimum runtime without a scheduled end", () => {
      const settings = resolveExperimentQualityScoreSettings({
        checks: { "no-early-stop": { params: { minRuntimeDays: 14 } } },
      });
      const unscheduled = processResults([
        { key: "no-early-stop", result: "na" },
      ]);

      // 30 days
      expect(
        checkByKey(
          score(baseExperiment({ processResults: unscheduled }), settings),
          "no-early-stop",
        )?.score,
      ).toBe(1);

      // 5 days
      const shortRun = baseExperiment({
        processResults: unscheduled,
        phases: [
          makePhase(
            new Date("2026-06-01T00:00:00Z"),
            new Date("2026-06-06T00:00:00Z"),
          ),
        ],
      });
      expect(
        checkByKey(score(shortRun, settings), "no-early-stop"),
      ).toMatchObject({
        score: 0,
        reason: "Stopped after 5 of the 14 minimum days",
      });

      // A scheduled end decides it instead
      const scheduled = baseExperiment({
        processResults: processResults([
          { key: "no-early-stop", result: "pass" },
        ]),
        phases: shortRun.phases,
      });
      expect(
        checkByKey(score(scheduled, settings), "no-early-stop")?.score,
      ).toBe(1);
    });
  });

  it("fails the built-in AI checks without a hypothesis instead of asking the AI", () => {
    const result = score(baseExperiment({ hypothesis: " " }));
    for (const key of [
      "ai-hypothesis-quality",
      "ai-hypothesis-metric-alignment",
    ]) {
      expect(checkByKey(result, key)).toMatchObject({
        applicable: true,
        score: 0,
        reason: "No hypothesis",
      });
    }
    expect(result.pending).toBe(false);
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
    // 2 built-in AI checks + 1 custom, equal weights → a third each
    expect(customSettings.customAiChecks).toHaveLength(1);
    expect(customSettings.customAiChecks[0].key).toBe("custom:rule1");
    expect(customSettings.customAiChecks[0].split).toBeCloseTo(1 / 3, 9);
    expect(customSettings.checks["ai-hypothesis-quality"].split).toBeCloseTo(
      1 / 3,
      9,
    );
  });

  it("keeps the AI section alive when only custom checks are enabled", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      checks: {
        "ai-hypothesis-quality": { enabled: false },
        "ai-hypothesis-metric-alignment": { enabled: false },
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
