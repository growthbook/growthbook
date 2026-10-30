import {
  ExperimentForQualityScore,
  computeAIQualityInputsHash,
  getChecksForSection,
  getExperimentDigestForCustomRules,
  getAIQualityInputsHash,
  getExperimentQualityScore,
  getQualityImprovements,
  getQualityScoreBand,
  getQualitySummaryKey,
  getQualitySummaryTemplate,
  resolveExperimentQualityScoreSettings,
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
    guardrailMetrics: ["met_errors"],
    results: "won",
    releasedVariationId: "1",
    analysis: "The larger CTA won; we should apply this to all pages.",
    ...overrides,
  };
}

function freshAIResults(
  experiment: ExperimentForQualityScore,
  settings = resolveExperimentQualityScoreSettings(),
) {
  return {
    inputsHash: getAIQualityInputsHash(experiment, settings),
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
) {
  return getExperimentQualityScore({ experiment, settings, now: NOW });
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
  it("uses default shares 35/30/15/20", () => {
    const resolved = resolveExperimentQualityScoreSettings();
    expect(resolved.sections.setup.share).toBeCloseTo(0.35, 9);
    expect(resolved.sections.process.share).toBeCloseTo(0.3, 9);
    expect(resolved.sections.documentation.share).toBeCloseTo(0.15, 9);
    expect(resolved.sections.ai.share).toBeCloseTo(0.2, 9);
  });

  it("defaults some checks to disabled and splits the rest equally", () => {
    const resolved = resolveExperimentQualityScoreSettings();
    for (const key of [
      "screenshots",
      "tags-or-project",
      "max-variations",
      "planned-end",
    ] as const) {
      expect(resolved.checks[key].enabled).toBe(false);
      expect(resolved.checks[key].split).toBe(0);
    }
    for (const key of [
      "hypothesis",
      "description",
      "goal-metrics",
      "guardrail-metrics",
    ] as const) {
      expect(resolved.checks[key].split).toBeCloseTo(1 / 4, 9);
    }
    for (const key of ["decision", "analysis-written"] as const) {
      expect(resolved.checks[key].split).toBeCloseTo(1 / 2, 9);
    }
  });

  it("redistributes the AI share when aiChecksEnabled is false", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
    });
    expect(resolved.sections.ai.enabled).toBe(false);
    expect(resolved.sections.ai.share).toBe(0);
    expect(resolved.sections.setup.share).toBeCloseTo(35 / 80, 9);
    expect(resolved.sections.process.share).toBeCloseTo(30 / 80, 9);
    expect(resolved.sections.documentation.share).toBeCloseTo(15 / 80, 9);
  });

  it("treats scaled raw weights as identical shares", () => {
    const scaled = resolveExperimentQualityScoreSettings({
      sections: {
        setup: { weight: 4 },
        documentation: { weight: 5 },
        process: { weight: 6 },
        ai: { weight: 5 },
      },
    });
    expect(scaled.sections.documentation.share).toBeCloseTo(0.25, 9);
    expect(scaled.sections.ai.share).toBeCloseTo(0.25, 9);
  });

  it("falls back to equal shares when all enabled weights are zero", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
      sections: {
        setup: { weight: 0 },
        documentation: { weight: 0 },
        process: { weight: 0 },
      },
    });
    expect(resolved.sections.documentation.share).toBeCloseTo(1 / 3, 9);
  });

  it("treats a section with every check disabled as disabled", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      checks: Object.fromEntries(
        getChecksForSection("process").map((k) => [k, { enabled: false }]),
      ),
    });
    expect(resolved.sections.process.enabled).toBe(false);
    expect(resolved.sections.process.share).toBe(0);
    expect(resolved.sections.documentation.share).toBeCloseTo(15 / 70, 9);
  });

  it("resolving without a config yields catalog defaults", () => {
    const fromUndefined = resolveExperimentQualityScoreSettings(undefined);
    const fromNull = resolveExperimentQualityScoreSettings(null);
    expect(fromUndefined.sections.documentation.share).toBeCloseTo(0.15, 9);
    expect(fromNull.sections.documentation.share).toBeCloseTo(0.15, 9);
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

describe("getExperimentDigestForCustomRules", () => {
  // Older documents can lack list fields, so they must not throw
  it("handles experiments missing list fields", () => {
    const partial = {
      ...baseExperiment(),
      tags: undefined,
      goalMetrics: undefined,
      phases: undefined,
    } as unknown as ReturnType<typeof baseExperiment>;
    expect(() => getExperimentDigestForCustomRules(partial, [])).not.toThrow();
  });
});

describe("computeAIQualityInputsHash", () => {
  const base = { hypothesis: "h", goalMetrics: ["met_signups"] };

  it("is stable regardless of metric name order", () => {
    const a = computeAIQualityInputsHash({
      ...base,
      goalMetrics: ["met_revenue", "met_signups"],
    });
    const b = computeAIQualityInputsHash({
      ...base,
      goalMetrics: ["met_signups", "met_revenue"],
    });
    expect(a).toBe(b);
  });

  it("changes when the experiment's inputs change", () => {
    const hash = computeAIQualityInputsHash(base);
    expect(computeAIQualityInputsHash({ ...base, hypothesis: "h2" })).not.toBe(
      hash,
    );
    expect(
      computeAIQualityInputsHash({ ...base, experimentDigest: "{}" }),
    ).not.toBe(hash);
  });

  // Settings changes keep verdicts until someone re-checks them
  it("ignores the AI checks' settings", () => {
    const experiment = baseExperiment();
    const contexts = resolveExperimentQualityScoreSettings({
      checks: {
        "ai-hypothesis-quality": { enabled: true, aiContext: "be strict" },
      },
    });
    expect(getAIQualityInputsHash(experiment, contexts)).toBe(
      getAIQualityInputsHash(
        experiment,
        resolveExperimentQualityScoreSettings(null),
      ),
    );
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
    // Setup absorbed more than its configured 35%
    expect(sectionByKey(result, "setup").possiblePoints).toBeGreaterThan(35);
  });

  it("computes proportional section points for partial failures", () => {
    // Setup-only config with two enabled equal-split checks: one passes
    // (hypothesis), one fails (description)
    const settings = resolveExperimentQualityScoreSettings({
      aiChecksEnabled: false,
      sections: {
        process: { enabled: false },
        documentation: { enabled: false },
      },
      checks: {
        "goal-metrics": { enabled: false },
        "guardrail-metrics": { enabled: false },
      },
    });
    const experiment = baseExperiment({ description: "" });
    const result = score(experiment, settings);
    expect(result.score).toBe(50);
    const setup = sectionByKey(result, "setup");
    expect(setup.possiblePoints).toBeCloseTo(100, 6);
    expect(setup.earnedPoints).toBeCloseTo(50, 6);
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
        setup: { enabled: false },
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
    // Enabled by default: 4 setup + 6 process (planned-end off) + 2
    // documentation + 2 ai = 14
    expect(result.totalEnabledCheckCount).toBe(14);
    // N/A while running: decision, analysis and the 6 process checks
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

  it("counts a win with a recorded winner, even without a release", () => {
    const won = (overrides: Partial<ExperimentForQualityScore>) =>
      checkByKey(
        score(baseExperiment({ results: "won", ...overrides })),
        "decision",
      );
    expect(won({ releasedVariationId: "", winner: 1 })?.score).toBe(1);
    expect(won({ releasedVariationId: "1", winner: undefined })?.score).toBe(1);
    expect(won({ releasedVariationId: "", winner: undefined })).toMatchObject({
      score: 0,
      reason: "Marked as won without a winning variation",
    });
  });

  it("checks the analysis write-up once stopped", () => {
    const settings = resolveExperimentQualityScoreSettings();
    expect(settings.checks["analysis-written"].enabled).toBe(true);
    expect(
      checkByKey(score(baseExperiment(), settings), "analysis-written")?.score,
    ).toBe(1);
    expect(
      checkByKey(
        score(baseExperiment({ analysis: " " }), settings),
        "analysis-written",
      ),
    ).toMatchObject({ score: 0, reason: "No analysis written" });
    expect(
      checkByKey(
        score(baseExperiment({ status: "running" }), settings),
        "analysis-written",
      )?.applicable,
    ).toBe(false);
  });

  describe("setup checks", () => {
    it("checks guardrails and, when enabled, the number of variations", () => {
      const settings = resolveExperimentQualityScoreSettings({
        checks: {
          "max-variations": { enabled: true, params: { maxVariations: 2 } },
        },
      });
      expect(
        checkByKey(score(baseExperiment(), settings), "guardrail-metrics")
          ?.score,
      ).toBe(1);
      expect(
        checkByKey(
          score(baseExperiment({ guardrailMetrics: [] }), settings),
          "guardrail-metrics",
        ),
      ).toMatchObject({ score: 0, reason: "No guardrail metrics selected" });

      const three = baseExperiment();
      three.variations = [
        ...three.variations,
        { ...three.variations[1], id: "2", key: "2", name: "Third" },
      ];
      expect(
        checkByKey(score(three, settings), "max-variations"),
      ).toMatchObject({ score: 0 });
      expect(
        checkByKey(score(baseExperiment(), settings), "max-variations")?.score,
      ).toBe(1);
      expect(
        checkByKey(
          score({ ...three, type: "multi-armed-bandit" }, settings),
          "max-variations",
        )?.applicable,
      ).toBe(false);
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

  describe("getQualityImprovements", () => {
    it("lists failing checks by the points they would add, without process checks", () => {
      const settings = resolveExperimentQualityScoreSettings({
        aiChecksEnabled: false,
      });
      const result = score(
        baseExperiment({
          description: "",
          guardrailMetrics: [],
          processResults: {
            version: EXPERIMENT_PROCESS_RULES_VERSION,
            rules: [{ key: "goal-metrics-locked", result: "fail" }],
          },
        }),
        settings,
      );
      const improvements = getQualityImprovements(result);
      expect(improvements.map((i) => i.key)).toEqual([
        "description",
        "guardrail-metrics",
      ]);
      // Equal checks in one section are worth the same
      expect(improvements[0].gain).toBeCloseTo(improvements[1].gain, 9);
      const total = result.sections
        .flatMap((s) => s.checks)
        .reduce((sum, c) => sum + c.possiblePoints, 0);
      expect(total).toBeCloseTo(100, 6);
    });
  });

  it("folds the AI checks a missing hypothesis fails into adding one", () => {
    const result = score(baseExperiment({ hypothesis: "" }));
    const improvements = getQualityImprovements(result);
    const add = improvements.find((i) => i.key === "hypothesis");
    const checks = result.sections.flatMap((s) => s.checks);
    const expected = checks
      .filter((c) => c.key === "hypothesis" || c.reason === "No hypothesis")
      .reduce((sum, c) => sum + c.possiblePoints - c.earnedPoints, 0);
    expect(add?.gain).toBeCloseTo(expected, 9);
    expect(improvements.some((i) => i.reason === "No hypothesis")).toBe(false);
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
      inputsHash: getAIQualityInputsHash(withVerdict, customSettings),
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

  it("invalidates verdicts when the experiment changes", () => {
    const experiment = baseExperiment();
    const base = {
      hypothesis: experiment.hypothesis,
      goalMetrics: experiment.goalMetrics,
      experimentDigest: getExperimentDigestForCustomRules(
        experiment,
        experiment.goalMetrics,
      ),
    };
    const hash = computeAIQualityInputsHash(base);

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

describe("getQualityScoreBand", () => {
  it("splits at 50 and 80", () => {
    expect(getQualityScoreBand(49)).toBe("weak");
    expect(getQualityScoreBand(50)).toBe("fair");
    expect(getQualityScoreBand(79)).toBe("fair");
    expect(getQualityScoreBand(80)).toBe("strong");
  });
});

describe("quality summaries", () => {
  const passing = () => {
    const experiment = baseExperiment();
    experiment.aiQualityResults = freshAIResults(experiment);
    return experiment;
  };

  it("says when every check passes", () => {
    expect(getQualitySummaryTemplate(score(passing()))).toBe(
      "Passes every check.",
    );
  });

  it("names a strong section, then the biggest problems", () => {
    const experiment = passing();
    experiment.guardrailMetrics = [];
    experiment.aiQualityResults = {
      ...freshAIResults(experiment),
      checks: [
        { key: "ai-hypothesis-quality", score: 0, reason: "Vague" },
        { key: "ai-hypothesis-metric-alignment", score: 1, reason: "Fine" },
      ],
    };
    expect(getQualitySummaryTemplate(score(experiment))).toMatch(
      /^[A-Z].*, but the hypothesis is vague and there are no guardrail metrics\.$/,
    );
  });

  it("keys on the outcome, not the wording", () => {
    const a = passing();
    const b = passing();
    b.description = "Another description";
    expect(getQualitySummaryKey(score(a))).toBe(getQualitySummaryKey(score(b)));
    b.description = "";
    expect(getQualitySummaryKey(score(a))).not.toBe(
      getQualitySummaryKey(score(b)),
    );
  });
});

describe("share math", () => {
  it("roundToTotal produces integers that sum to the total", () => {
    expect(roundToTotal([33.33, 33.33, 33.34])).toEqual([33, 33, 34]);
    const rounded = roundToTotal([35.5, 24.5, 20.0, 20.0]);
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(100);
    expect(roundToTotal([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
