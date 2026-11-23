import {
  AdjustmentImpactArgs,
  DEFAULT_ADJUSTMENT_IMPACT_SETTINGS,
  ExperimentMetricInterface,
  getAdjustmentImpactSummaries,
  getVariationForSupplementalResult,
  MetricResults,
  parseAdjustmentImpactSettings,
  SupplementalField,
} from "shared/experiments";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { MetricDefaults } from "shared/types/organization";

// A result as the stats engine reports it: the lift, its standard error, and
// the p-value that decides significance at the 0.05 threshold used below.
// `pValueAdjusted` is the multiple-testing-corrected p-value that the results
// pipeline sets on the displayed result.
type Result = {
  lift: number;
  standardError?: number;
  pValue: number;
  pValueAdjusted?: number;
  ci?: [number, number];
  ciAdjusted?: [number, number];
};

const SIGNIFICANT = 0.01;
const NOT_SIGNIFICANT = 0.4;

function toStats({
  lift,
  standardError,
  pValue,
  pValueAdjusted,
  ci,
  ciAdjusted,
}: Result) {
  return {
    value: 1000,
    cr: 1,
    users: 1000,
    expected: lift,
    pValue,
    ...(pValueAdjusted !== undefined ? { pValueAdjusted } : {}),
    ...(ci !== undefined ? { ci } : {}),
    ...(ciAdjusted !== undefined ? { ciAdjusted } : {}),
    ...(standardError !== undefined
      ? { uplift: { dist: "normal", mean: lift, stddev: standardError } }
      : {}),
  };
}

function makeVariation(
  primary: Result,
  supplemental: Partial<Record<SupplementalField, Result>>,
): SnapshotMetric {
  return {
    ...toStats(primary),
    supplementalResults: Object.fromEntries(
      Object.entries(supplemental).map(([field, result]) => [
        field,
        toStats(result),
      ]),
    ),
  } as SnapshotMetric;
}

function makeMetricResults(
  variations: SnapshotMetric[],
  metricId = "m",
): MetricResults {
  return {
    metric: {
      id: metricId,
      metricType: "mean",
    } as unknown as ExperimentMetricInterface,
    variations: [{ value: 1000, cr: 1, users: 1000 }, ...variations],
  };
}

const commonArgs = {
  baselineIndex: 0,
  metricDefaults: { minimumSampleSize: 150 } as MetricDefaults,
  statsEngine: "frequentist" as const,
  differenceType: "relative" as const,
  ciUpper: 0.95,
  ciLower: 0.05,
  pValueThreshold: 0.05,
};

// One adjustment's impact on one metric, or null when it cannot be compared.
function impactFor({
  metricResults,
  field,
  ...args
}: AdjustmentImpactArgs & {
  metricResults: MetricResults;
  field: SupplementalField;
}) {
  const [summary] = getAdjustmentImpactSummaries({
    ...args,
    metrics: [metricResults],
  });
  return summary.find((impact) => impact.field === field) ?? null;
}

function classify(
  field: SupplementalField,
  primary: Result,
  alternative: Result,
) {
  return impactFor({
    ...commonArgs,
    metricResults: makeMetricResults([
      makeVariation(primary, { [field]: alternative }),
    ]),
    field,
  });
}

describe("one adjustment's impact", () => {
  describe("capping", () => {
    it("ignores a big relative change that is small next to the standard error", () => {
      // The lift halves, but the move is a tenth of a standard error.
      const result = classify(
        "uncapped",
        { lift: 0.002, standardError: 0.018, pValue: NOT_SIGNIFICANT },
        { lift: 0.004, standardError: 0.02, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("small");
      expect(result?.relativeChange).toBeCloseTo(0.5);
      expect(result?.standardErrorShift).toBeCloseTo(0.1);
    });

    it("is moderate from half a standard error", () => {
      const result = classify(
        "uncapped",
        { lift: 0.05, standardError: 0.018, pValue: SIGNIFICANT },
        { lift: 0.062, standardError: 0.02, pValue: SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
      expect(result?.standardErrorShift).toBeCloseTo(0.6);
    });

    it("is not large below two standard errors when the status holds", () => {
      const result = classify(
        "uncapped",
        { lift: 0.05, standardError: 0.018, pValue: SIGNIFICANT },
        { lift: 0.08, standardError: 0.02, pValue: SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
      expect(result?.standardErrorShift).toBeCloseTo(1.5);
    });

    it("is large from two standard errors that move the lift by half", () => {
      const result = classify(
        "uncapped",
        { lift: 0.05, standardError: 0.018, pValue: SIGNIFICANT },
        { lift: 0.12, standardError: 0.02, pValue: SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("large");
      expect(result?.standardErrorShift).toBeCloseTo(3.5);
      expect(result?.significanceChanged).toBe(false);
      expect(result?.signFlipped).toBe(false);
    });

    it("is not large when a strongly significant lift moves by less than half", () => {
      // Ten standard errors from zero against seven: three apart, but 30%.
      const result = classify(
        "uncapped",
        { lift: 0.1, standardError: 0.01, pValue: SIGNIFICANT },
        { lift: 0.07, standardError: 0.01, pValue: SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
      expect(result?.standardErrorShift).toBeCloseTo(3);
      expect(result?.relativeChange).toBeCloseTo(0.3);
    });

    it("is large when significance changes with half a standard error", () => {
      const result = classify(
        "uncapped",
        { lift: 0.05, standardError: 0.018, pValue: SIGNIFICANT },
        { lift: 0.035, standardError: 0.02, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("large");
      expect(result?.standardErrorShift).toBeCloseTo(0.75);
      expect(result?.significanceChanged).toBe(true);
    });

    it("is not large when significance changes but the estimate barely moves", () => {
      const result = classify(
        "uncapped",
        { lift: 0.04, standardError: 0.018, pValue: SIGNIFICANT },
        { lift: 0.038, standardError: 0.02, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("small");
      expect(result?.significanceChanged).toBe(false);
    });

    it("is large when the sign flips across two significant results", () => {
      const result = classify(
        "uncapped",
        { lift: 0.012, standardError: 0.004, pValue: SIGNIFICANT },
        { lift: -0.02, standardError: 0.04, pValue: SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("large");
      expect(result?.standardErrorShift).toBeCloseTo(0.8);
      expect(result?.signFlipped).toBe(true);
      expect(result?.significanceChanged).toBe(false);
    });

    it("does not count a sign flip between two non-significant results", () => {
      const result = classify(
        "uncapped",
        { lift: 0.012, standardError: 0.018, pValue: NOT_SIGNIFICANT },
        { lift: -0.012, standardError: 0.02, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
      expect(result?.standardErrorShift).toBeCloseTo(1.2);
      expect(result?.signFlipped).toBe(false);
    });

    describe("without a standard error", () => {
      it("falls back to the relative scale, where a shift alone is not large", () => {
        const result = classify(
          "uncapped",
          { lift: 0.02, pValue: SIGNIFICANT },
          { lift: 0.06, pValue: SIGNIFICANT },
        );
        expect(result?.effectSize).toBe("moderate");
        expect(result?.relativeChange).toBeCloseTo(2 / 3);
        expect(result?.standardErrorShift).toBeNull();
      });

      it("is large when the status changes with a 50% move", () => {
        const result = classify(
          "uncapped",
          { lift: 0.02, pValue: NOT_SIGNIFICANT },
          { lift: 0.06, pValue: SIGNIFICANT },
        );
        expect(result?.effectSize).toBe("large");
        expect(result?.significanceChanged).toBe(true);
      });
    });
  });

  describe("CUPED and post-stratification", () => {
    it("is not large when only significance changes", () => {
      const result = classify(
        "cupedUnadjusted",
        { lift: 0.05, standardError: 0.02, pValue: SIGNIFICANT },
        { lift: 0.02, standardError: 0.025, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
      expect(result?.standardErrorShift).toBeCloseTo(1.2);
      expect(result?.significanceChanged).toBe(false);
    });

    it("is large from two standard errors", () => {
      const result = classify(
        "cupedUnadjusted",
        { lift: 0.05, standardError: 0.02, pValue: SIGNIFICANT },
        { lift: 0.11, standardError: 0.025, pValue: SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("large");
      expect(result?.standardErrorShift).toBeCloseTo(2.4);
    });

    it("is large when the sign flips across a significant result with one standard error", () => {
      const result = classify(
        "cupedUnadjusted",
        { lift: 0.03, standardError: 0.012, pValue: SIGNIFICANT },
        { lift: -0.005, standardError: 0.025, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("large");
      expect(result?.standardErrorShift).toBeCloseTo(1.4);
      expect(result?.signFlipped).toBe(true);
      expect(result?.significanceChanged).toBe(true);
    });

    it("is not large when that sign flip is under one standard error", () => {
      const result = classify(
        "cupedUnadjusted",
        { lift: 0.012, standardError: 0.005, pValue: SIGNIFICANT },
        { lift: -0.005, standardError: 0.025, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
      expect(result?.standardErrorShift).toBeCloseTo(0.68);
      expect(result?.signFlipped).toBe(false);
    });

    it("is not large when the sign flips between non-significant results", () => {
      const result = classify(
        "cupedUnadjusted",
        { lift: 0.015, standardError: 0.02, pValue: NOT_SIGNIFICANT },
        { lift: -0.015, standardError: 0.025, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
      expect(result?.standardErrorShift).toBeCloseTo(1.2);
      expect(result?.signFlipped).toBe(false);
    });

    it("holds post-stratification to the same rule", () => {
      const result = classify(
        "unstratified",
        { lift: 0.05, standardError: 0.02, pValue: SIGNIFICANT },
        { lift: 0.02, standardError: 0.025, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
    });
  });

  describe("Bayesian prior", () => {
    it("is not large on shrinkage alone", () => {
      // 60% shrinkage, but the result was not significant either way.
      const result = classify(
        "flatPrior",
        { lift: 0.02, standardError: 0.045, pValue: NOT_SIGNIFICANT },
        { lift: 0.05, standardError: 0.05, pValue: NOT_SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
      expect(result?.relativeChange).toBeCloseTo(0.6);
      expect(result?.standardErrorShift).toBeNull();
    });

    it("is large when 50% shrinkage changes the status", () => {
      const result = classify(
        "flatPrior",
        { lift: 0.02, standardError: 0.015, pValue: NOT_SIGNIFICANT },
        { lift: 0.05, standardError: 0.02, pValue: SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("large");
      expect(result?.significanceChanged).toBe(true);
    });

    it("is not large when the status changes under 50% shrinkage", () => {
      const result = classify(
        "flatPrior",
        { lift: 0.04, standardError: 0.02, pValue: NOT_SIGNIFICANT },
        { lift: 0.05, standardError: 0.02, pValue: SIGNIFICANT },
      );
      expect(result?.effectSize).toBe("moderate");
      expect(result?.significanceChanged).toBe(false);
    });
  });

  describe("with a multiple-testing correction", () => {
    const primary = {
      lift: 0.05,
      standardError: 0.02,
      pValue: 0.02,
      pValueAdjusted: 0.04, // significant after correction
    };
    // Raw 0.03 is significant, but corrected to 0.06 it is not.
    const uncapped = { lift: 0.035, standardError: 0.025, pValue: 0.03 };
    const classifyUncapped = (alternative: Result) =>
      impactFor({
        ...commonArgs,
        metricResults: makeMetricResults([
          makeVariation(primary, { uncapped: alternative }),
        ]),
        field: "uncapped",
      });

    it("compares corrected with corrected", () => {
      const result = classifyUncapped({ ...uncapped, pValueAdjusted: 0.06 });
      expect(result?.effectSize).toBe("large");
      expect(result?.significanceChanged).toBe(true);
    });

    it("skips the significance comparison when the other result has no corrected p-value", () => {
      const result = classifyUncapped(uncapped);
      expect(result?.effectSize).toBe("moderate");
      expect(result?.significanceChanged).toBe(false);
    });
  });

  it("reports the most affected variation", () => {
    const steady = makeVariation(
      { lift: 0.05, standardError: 0.018, pValue: SIGNIFICANT },
      { uncapped: { lift: 0.051, standardError: 0.02, pValue: SIGNIFICANT } },
    );
    const moved = makeVariation(
      { lift: 0.05, standardError: 0.018, pValue: SIGNIFICANT },
      { uncapped: { lift: 0.12, standardError: 0.02, pValue: SIGNIFICANT } },
    );
    const result = impactFor({
      ...commonArgs,
      metricResults: makeMetricResults([steady, moved]),
      field: "uncapped",
    });
    expect(result?.effectSize).toBe("large");
    expect(result?.standardErrorShift).toBeCloseTo(3.5);
  });

  it("returns null without the supplemental result", () => {
    const result = impactFor({
      ...commonArgs,
      metricResults: makeMetricResults([
        makeVariation(
          { lift: 0.05, standardError: 0.018, pValue: SIGNIFICANT },
          {},
        ),
      ]),
      field: "uncapped",
    });
    expect(result).toBeNull();
  });

  describe("results that cannot be compared", () => {
    // Two and a half standard errors from zero: large if it were classified.
    const primary = { lift: 0.05, standardError: 0.02, pValue: SIGNIFICANT };

    it("skips an errored result, which the stats engine reports as a lift of zero", () => {
      const variation = makeVariation(primary, {});
      const errored = {
        ...toStats({ lift: 0, standardError: 0, pValue: 1 }),
        errorMessage: "ZERO_NEGATIVE_VARIANCE",
      };
      const result = impactFor({
        ...commonArgs,
        metricResults: makeMetricResults([
          {
            ...variation,
            supplementalResults: { uncapped: errored },
          } as SnapshotMetric,
        ]),
        field: "uncapped",
      });
      expect(result).toBeNull();
    });

    it("skips a metric short of its minimum sample size", () => {
      const result = impactFor({
        ...commonArgs,
        metricDefaults: { minimumSampleSize: 5000 } as MetricDefaults,
        metricResults: makeMetricResults([
          makeVariation(primary, {
            uncapped: { lift: 0.1, standardError: 0.02, pValue: SIGNIFICANT },
          }),
        ]),
        field: "uncapped",
      });
      expect(result).toBeNull();
    });
  });
});

describe("settings from the feature flag", () => {
  // The rules before they were tightened: large at 10% of the lift, or on any
  // change in status.
  const oldRule = {
    moderate: [{ relativeChange: 0.01 }],
    large: [{ relativeChange: 0.1 }, { requires: "statusChange" }],
  };
  const withRule = (rule: unknown) => ({
    unstratified: rule,
    cupedUnadjusted: rule,
    flatPrior: rule,
    uncapped: rule,
  });
  const oldSettings = parseAdjustmentImpactSettings(withRule(oldRule));

  it("classifies with the given rules in place of the defaults", () => {
    // Half the lift, but a tenth of a standard error.
    const shift = [
      "uncapped",
      { lift: 0.002, standardError: 0.018, pValue: NOT_SIGNIFICANT },
      { lift: 0.004, standardError: 0.02, pValue: NOT_SIGNIFICANT },
    ] as const;
    // 5% of the lift, with a change in significance.
    const significance = [
      "cupedUnadjusted",
      { lift: 0.04, standardError: 0.018, pValue: SIGNIFICANT },
      { lift: 0.038, standardError: 0.02, pValue: NOT_SIGNIFICANT },
    ] as const;

    for (const [field, primary, alternative] of [shift, significance]) {
      const args = {
        ...commonArgs,
        metricResults: makeMetricResults([
          makeVariation(primary, { [field]: alternative }),
        ]),
        field,
      };
      expect(impactFor(args)?.effectSize).toBe("small");
      expect(impactFor({ ...args, settings: oldSettings })?.effectSize).toBe(
        "large",
      );
    }
  });

  it("falls back to the defaults when malformed", () => {
    expect(oldSettings).not.toBe(DEFAULT_ADJUSTMENT_IMPACT_SETTINGS);
    for (const malformed of [
      { uncapped: oldRule },
      // A misspelt part or an empty condition would otherwise always be met.
      withRule({ ...oldRule, large: [{ relativChange: 0.1 }] }),
      withRule({ ...oldRule, large: [{}] }),
    ]) {
      expect(parseAdjustmentImpactSettings(malformed)).toBe(
        DEFAULT_ADJUSTMENT_IMPACT_SETTINGS,
      );
    }
  });
});

describe("getVariationForSupplementalResult", () => {
  const primary = {
    lift: 0.05,
    standardError: 0.02,
    pValue: 0.02,
    pValueAdjusted: 0.04,
    ci: [0.01, 0.09] as [number, number],
    ciAdjusted: [0.002, 0.098] as [number, number],
  };
  const uncapped = {
    lift: 0.035,
    standardError: 0.016,
    pValue: 0.03,
    ci: [0.003, 0.067] as [number, number],
  };

  it("uses the corrected p-value and interval stored on the result without the adjustment", () => {
    const [, variation] = getVariationForSupplementalResult({
      metricResults: makeMetricResults([
        makeVariation(primary, {
          uncapped: {
            ...uncapped,
            pValueAdjusted: 0.06,
            ciAdjusted: [-0.002, 0.072],
          },
        }),
      ]),
      field: "uncapped",
    });
    expect(variation.expected).toBe(0.035);
    expect(variation.pValueAdjusted).toBe(0.06);
    expect(variation.ciAdjusted).toEqual([-0.002, 0.072]);
  });

  const metricResults = makeMetricResults([
    makeVariation(primary, { uncapped }),
  ]);
  const args = { metricResults, field: "uncapped" as const };

  it("drops the displayed result's corrected values when the other result has none", () => {
    const [, variation] = getVariationForSupplementalResult(args);
    expect(variation.expected).toBe(0.035);
    expect(variation.pValue).toBe(0.03);
    expect(variation.ci).toEqual([0.003, 0.067]);
    expect(variation.pValueAdjusted).toBeUndefined();
    expect(variation.ciAdjusted).toBeUndefined();
  });

  it("leaves a variation without the supplemental result as it is", () => {
    const [baseline] = getVariationForSupplementalResult(args);
    expect(baseline).toBe(metricResults.variations[0]);
  });
});

describe("getAdjustmentImpactSummaries", () => {
  it("lists each metric's available adjustments, most severe first", () => {
    const unadjusted = makeMetricResults([
      makeVariation(
        { lift: 0.05, standardError: 0.02, pValue: SIGNIFICANT },
        {},
      ),
    ]);
    const adjusted = makeMetricResults([
      makeVariation(
        { lift: 0.05, standardError: 0.02, pValue: SIGNIFICANT },
        {
          // Moves more than a standard error, but CUPED needs two.
          cupedUnadjusted: {
            lift: 0.08,
            standardError: 0.025,
            pValue: SIGNIFICANT,
          },
          // Changes significance with a move of two thirds of a standard error.
          uncapped: {
            lift: 0.03,
            standardError: 0.03,
            pValue: NOT_SIGNIFICANT,
          },
        },
      ),
    ]);
    const summaries = getAdjustmentImpactSummaries({
      ...commonArgs,
      metrics: [unadjusted, adjusted],
    });
    expect(
      summaries.map((summary) =>
        summary.map(({ field, effectSize }) => [field, effectSize]),
      ),
    ).toEqual([
      [],
      [
        ["uncapped", "large"],
        ["cupedUnadjusted", "moderate"],
      ],
    ]);
  });
});
