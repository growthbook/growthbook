import { ExperimentHealthSettings } from "shared/types/experiment";
import {
  ExperimentForQualityScore,
  computeAIQualityInputsHash,
  getExperimentQualityScore,
  resolveExperimentQualityScoreSettings,
} from "../../src/enterprise/experimentQualityScore";

const healthSettings: ExperimentHealthSettings = {
  decisionFrameworkEnabled: true,
  srmThreshold: 0.001,
  multipleExposureMinPercent: 0.01,
  experimentMinLengthDays: 3,
};

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
) {
  return {
    inputsHash: computeAIQualityInputsHash({
      hypothesis: experiment.hypothesis,
      analysis: experiment.analysis,
      goalMetricNames: ["Signups"],
      aiContext: settings.aiContext,
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

describe("resolveExperimentQualityScoreSettings", () => {
  it("defaults to disabled with all checks on at weight 1", () => {
    const resolved = resolveExperimentQualityScoreSettings();
    expect(resolved.enabled).toBe(false);
    expect(resolved.aiChecksEnabled).toBe(true);
    expect(Object.values(resolved.checks).every((c) => c.enabled)).toBe(true);
    expect(Object.values(resolved.checks).every((c) => c.weight === 1)).toBe(
      true,
    );
  });

  it("applies per-check overrides", () => {
    const resolved = resolveExperimentQualityScoreSettings({
      enabled: true,
      aiChecksEnabled: false,
      checks: {
        description: { enabled: false },
        hypothesis: { enabled: true, weight: 3 },
      },
    });
    expect(resolved.checks.description.enabled).toBe(false);
    expect(resolved.checks.hypothesis.weight).toBe(3);
    expect(resolved.checks.learnings.enabled).toBe(true);
  });
});

describe("computeAIQualityInputsHash", () => {
  it("is stable regardless of metric name order", () => {
    const a = computeAIQualityInputsHash({
      hypothesis: "h",
      analysis: "a",
      goalMetricNames: ["Revenue", "Signups"],
      aiContext: "",
    });
    const b = computeAIQualityInputsHash({
      hypothesis: "h",
      analysis: "a",
      goalMetricNames: ["Signups", "Revenue"],
      aiContext: "",
    });
    expect(a).toBe(b);
  });

  it("changes when any input changes", () => {
    const base = {
      hypothesis: "h",
      analysis: "a",
      goalMetricNames: ["Signups"],
      aiContext: "",
    };
    const hash = computeAIQualityInputsHash(base);
    expect(computeAIQualityInputsHash({ ...base, hypothesis: "h2" })).not.toBe(
      hash,
    );
    expect(computeAIQualityInputsHash({ ...base, analysis: "a2" })).not.toBe(
      hash,
    );
    expect(
      computeAIQualityInputsHash({ ...base, goalMetricNames: ["Rev"] }),
    ).not.toBe(hash);
    expect(computeAIQualityInputsHash({ ...base, aiContext: "ctx" })).not.toBe(
      hash,
    );
  });
});

describe("getExperimentQualityScore", () => {
  const settings = resolveExperimentQualityScoreSettings({
    enabled: true,
    aiChecksEnabled: true,
  });

  it("scores 100 when everything passes including fresh AI results", () => {
    const experiment = baseExperiment();
    experiment.aiQualityResults = freshAIResults(experiment);
    const result = getExperimentQualityScore({
      experiment,
      settings,
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    expect(result.score).toBe(100);
    expect(result.pending).toBe(false);
  });

  it("penalizes missing documentation fields", () => {
    const experiment = baseExperiment({
      hypothesis: "",
      description: "  ",
      analysis: undefined,
    });
    const result = getExperimentQualityScore({
      experiment,
      settings,
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    const byKey = Object.fromEntries(result.checks.map((c) => [c.key, c]));
    expect(byKey["hypothesis"].score).toBe(0);
    expect(byKey["description"].score).toBe(0);
    expect(byKey["learnings"].score).toBe(0);
    // AI checks require a hypothesis (and learnings) so they are inapplicable
    expect(byKey["ai-hypothesis-quality"].applicable).toBe(false);
    expect(byKey["ai-learnings-quality"].applicable).toBe(false);
    expect(result.pending).toBe(false);
  });

  it("does not penalize running experiments for missing decision/learnings", () => {
    const experiment = baseExperiment({
      status: "running",
      results: undefined,
      analysis: undefined,
      releasedVariationId: "",
    });
    experiment.aiQualityResults = freshAIResults(experiment);
    const result = getExperimentQualityScore({
      experiment,
      settings,
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    const byKey = Object.fromEntries(result.checks.map((c) => [c.key, c]));
    expect(byKey["decision"].applicable).toBe(false);
    expect(byKey["learnings"].applicable).toBe(false);
    expect(byKey["ai-learnings-quality"].applicable).toBe(false);
    expect(result.score).toBe(100);
  });

  it("excludes screenshots for holdouts and health when no snapshot data", () => {
    const experiment = baseExperiment({
      type: "holdout",
      analysisSummary: undefined,
    });
    const result = getExperimentQualityScore({
      experiment,
      settings,
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    const byKey = Object.fromEntries(result.checks.map((c) => [c.key, c]));
    expect(byKey["screenshots"].applicable).toBe(false);
    expect(byKey["health-no-issues"].applicable).toBe(false);
    expect(byKey["health-powered"].applicable).toBe(false);
  });

  it("fails the decision check when won without a released variation", () => {
    const experiment = baseExperiment({ releasedVariationId: "" });
    const result = getExperimentQualityScore({
      experiment,
      settings,
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    const decision = result.checks.find((c) => c.key === "decision");
    expect(decision?.score).toBe(0);
  });

  it("fails health checks on SRM and low power, passes when low-power dismissed", () => {
    const experiment = baseExperiment({
      analysisSummary: {
        snapshotId: "snap_1",
        health: {
          srm: 0.0001,
          multipleExposures: 0,
          totalUsers: 10000,
          power: {
            type: "success",
            isLowPowered: true,
            additionalDaysNeeded: 14,
          },
        },
      },
    });
    const result = getExperimentQualityScore({
      experiment,
      settings,
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    const byKey = Object.fromEntries(result.checks.map((c) => [c.key, c]));
    expect(byKey["health-no-issues"].score).toBe(0);
    expect(byKey["health-no-issues"].reason).toMatch(/SRM/);
    expect(byKey["health-powered"].score).toBe(0);

    const dismissed = getExperimentQualityScore({
      experiment: { ...experiment, dismissedWarnings: ["low-power"] },
      settings,
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    expect(
      dismissed.checks.find((c) => c.key === "health-powered")?.score,
    ).toBe(1);
  });

  it("treats stale AI results as pending and excludes them from the score", () => {
    const experiment = baseExperiment();
    experiment.aiQualityResults = {
      ...freshAIResults(experiment),
      inputsHash: "stale-hash",
    };
    const result = getExperimentQualityScore({
      experiment,
      settings,
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    expect(result.pending).toBe(true);
    const aiCheck = result.checks.find(
      (c) => c.key === "ai-hypothesis-quality",
    );
    expect(aiCheck?.applicable).toBe(true);
    expect(aiCheck?.score).toBeNull();
    // Deterministic checks all pass, so score is 100 without AI
    expect(result.score).toBe(100);
  });

  it("excludes AI checks when aiChecksEnabled is false", () => {
    const experiment = baseExperiment();
    const result = getExperimentQualityScore({
      experiment,
      settings: resolveExperimentQualityScoreSettings({
        enabled: true,
        aiChecksEnabled: false,
      }),
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    expect(result.pending).toBe(false);
    expect(
      result.checks
        .filter((c) => c.type === "ai")
        .every((c) => !c.applicable && c.score === null),
    ).toBe(true);
  });

  it("respects weight overrides", () => {
    const experiment = baseExperiment({
      hypothesis: "",
      analysisSummary: undefined,
    });
    // Only two applicable checks: hypothesis (fail, weight 3) and
    // description (pass, weight 1) → 25
    const result = getExperimentQualityScore({
      experiment,
      settings: resolveExperimentQualityScoreSettings({
        enabled: true,
        aiChecksEnabled: false,
        checks: {
          hypothesis: { enabled: true, weight: 3 },
          description: { enabled: true, weight: 1 },
          screenshots: { enabled: false },
          "tags-or-project": { enabled: false },
          "goal-metrics": { enabled: false },
          decision: { enabled: false },
          learnings: { enabled: false },
        },
      }),
      healthSettings,
      goalMetricNames: [],
    });
    expect(result.score).toBe(25);
  });

  it("returns a null score when no checks are scorable", () => {
    const experiment = baseExperiment();
    const allDisabled = resolveExperimentQualityScoreSettings({
      enabled: true,
      aiChecksEnabled: false,
      checks: Object.fromEntries(
        Object.keys(resolveExperimentQualityScoreSettings().checks).map(
          (key) => [key, { enabled: false }],
        ),
      ),
    });
    const result = getExperimentQualityScore({
      experiment,
      settings: allDisabled,
      healthSettings,
      goalMetricNames: ["Signups"],
    });
    expect(result.score).toBeNull();
    expect(result.pending).toBe(false);
  });
});
