import {
  enrichAnalysisResults,
  fillLegacyPValueCorrection,
  getAnalysisPValueCorrection,
  getAnalysisPValueThreshold,
  restoreOpenAdjustedCI,
} from "shared/experiments";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "shared/types/report";

const baseline: SnapshotMetric = { value: 0, cr: 0, users: 100 };

// A treatment result. With a lift, it also gets the fields a CI needs.
function stat(pValue: number, lift?: number): SnapshotMetric {
  return {
    value: 0,
    cr: 0,
    users: 100,
    pValue,
    ...(lift !== undefined
      ? {
          ci: [lift - 0.01, lift + 0.01] as [number, number],
          uplift: { dist: "normal", mean: lift, stddev: 0.005 },
        }
      : {}),
  };
}

// One dimension level: the baseline and one result per treatment variation.
function level(
  name: string,
  ...treatments: Record<string, SnapshotMetric>[]
): ExperimentReportResultDimension {
  const metricIds = Object.keys(treatments[0]);
  return {
    name,
    srm: 1,
    variations: [
      {
        users: 100,
        metrics: Object.fromEntries(metricIds.map((id) => [id, baseline])),
      },
      ...treatments.map((metrics) => ({ users: 100, metrics })),
    ],
  };
}

// As saved before analyses recorded their correction.
const unstamped: ExperimentSnapshotAnalysisSettings = {
  statsEngine: "frequentist",
  dimensions: [],
  differenceType: "relative",
  pValueThreshold: 0.05,
  numGoalMetrics: 2,
  numGuardrailMetrics: 0,
};
const frequentist: ExperimentSnapshotAnalysisSettings = {
  ...unstamped,
  pValueCorrection: "holm-bonferroni",
};

function enrich(
  results: ExperimentReportResultDimension[],
  goalMetrics: string[],
  settings: Partial<ExperimentSnapshotAnalysisSettings> = {},
) {
  enrichAnalysisResults({
    results,
    analysisSettings: { ...frequentist, ...settings },
    snapshotSettings: { goalMetrics },
  });
  return results;
}

const adjusted = (
  results: ExperimentReportResultDimension[],
  metricId: string,
  { level = 0, variation = 1 } = {},
) => results[level].variations[variation].metrics[metricId].pValueAdjusted;

describe("enrichAnalysisResults", () => {
  it("corrects across goal metrics", () => {
    const results = enrich(
      [level("", { g1: stat(0.01), g2: stat(0.04) })],
      ["g1", "g2"],
    );
    expect(adjusted(results, "g1")).toBeCloseTo(0.02);
    expect(adjusted(results, "g2")).toBeCloseTo(0.04);
  });

  it("uses the recorded method", () => {
    // Holm-Bonferroni would double both.
    const results = enrich(
      [level("", { g1: stat(0.03), g2: stat(0.03) })],
      ["g1", "g2"],
      { pValueCorrection: "benjamini-hochberg" },
    );
    expect(adjusted(results, "g1")).toBeCloseTo(0.03);
    expect(adjusted(results, "g2")).toBeCloseTo(0.03);
  });

  it("counts every treatment variation and skips the baseline", () => {
    const results = enrich(
      [level("", { g1: stat(0.01) }, { g1: stat(0.02) })],
      ["g1"],
    );
    expect(adjusted(results, "g1", { variation: 0 })).toBeUndefined();
    expect(adjusted(results, "g1", { variation: 1 })).toBeCloseTo(0.02);
    expect(adjusted(results, "g1", { variation: 2 })).toBeCloseTo(0.02);
  });

  it("pools the dimension levels of one analysis", () => {
    const results = enrich(
      [
        level("US", { g1: stat(0.01) }),
        level("CA", { g1: stat(0.5) }),
        level("UK", { g1: stat(0.6) }),
      ],
      ["g1"],
      { dimensions: ["exp:country"] },
    );
    expect(adjusted(results, "g1", { level: 0 })).toBeCloseTo(0.03);
  });

  it("leaves a date breakdown uncorrected", () => {
    const results = enrich(
      [
        level("2026-01-01", { g1: stat(0.01) }),
        level("2026-01-02", { g1: stat(0.02) }),
      ],
      ["g1"],
      { dimensions: ["pre:date"] },
    );
    expect(adjusted(results, "g1", { level: 0 })).toBeUndefined();
    expect(adjusted(results, "g1", { level: 1 })).toBeUndefined();
  });

  it("leaves secondary, slice and funnel-step results out of the family", () => {
    const results = enrich(
      [
        level("", {
          g1: stat(0.01),
          g2: stat(0.04),
          secondary: stat(0.001),
          "g1?dim:country=US": stat(0.001),
          "g1?step=1": stat(0.001),
        }),
      ],
      ["g1", "g2"],
    );
    expect(adjusted(results, "g1")).toBeCloseTo(0.02);
    expect(adjusted(results, "secondary")).toBeUndefined();
    expect(adjusted(results, "g1?dim:country=US")).toBeUndefined();
    expect(adjusted(results, "g1?step=1")).toBeUndefined();
  });

  it("counts a goal metric once when it is listed twice", () => {
    const results = enrich(
      [level("", { g1: stat(0.01), g2: stat(0.04) })],
      ["g1", "g2", "g1"],
    );
    expect(adjusted(results, "g1")).toBeCloseTo(0.02);
  });

  it("ignores a goal metric with no result", () => {
    const results = enrich([level("", { g1: stat(0.01) })], ["g1", "missing"]);
    expect(adjusted(results, "g1")).toBeCloseTo(0.01);
  });

  it("widens the CI to match the corrected p-value", () => {
    const results = enrich(
      [level("", { g1: stat(0.01, 0.05), g2: stat(0.04, 0.02) })],
      ["g1", "g2"],
    );
    const { ci, ciAdjusted } = results[0].variations[1].metrics.g1;
    expect(ciAdjusted?.[0]).toBeLessThan(ci?.[0] ?? NaN);
    expect(ciAdjusted?.[1]).toBeGreaterThan(ci?.[1] ?? NaN);
  });

  it.each<{
    name: string;
    settings: Partial<ExperimentSnapshotAnalysisSettings>;
  }>([
    { name: "no correction", settings: { pValueCorrection: null } },
    {
      name: "an analysis that records none",
      settings: { pValueCorrection: undefined },
    },
    { name: "the Bayesian engine", settings: { statsEngine: "bayesian" } },
    {
      name: "the covariate analysis",
      settings: { useCovariateAsResponse: true },
    },
  ])("adds no corrected values for $name", ({ settings }) => {
    const results = enrich(
      [level("", { g1: stat(0.01, 0.05) })],
      ["g1"],
      settings,
    );
    expect(results[0].variations[1].metrics.g1.pValueAdjusted).toBeUndefined();
    expect(results[0].variations[1].metrics.g1.ciAdjusted).toBeUndefined();
  });

  describe("results without one adjustment", () => {
    // The uncapped results of two capped goal metrics, and a third goal
    // metric that capping does not apply to (gbstats sends null).
    const withUncapped = (pValue: number, uncappedPValue: number | null) => ({
      ...stat(pValue, 0.05),
      supplementalResults: {
        uncapped:
          uncappedPValue === null ? null : { ...stat(uncappedPValue, 0.04) },
      },
    });
    const results = enrich(
      [
        level("", {
          g1: withUncapped(0.01, 0.03) as SnapshotMetric,
          g2: withUncapped(0.04, 0.2) as SnapshotMetric,
          g3: withUncapped(0.5, null) as SnapshotMetric,
        }),
      ],
      ["g1", "g2", "g3"],
    );
    const uncapped = (metricId: string) =>
      results[0].variations[1].metrics[metricId].supplementalResults?.uncapped;

    it("corrects them as their own family, with a metric's own p-value where the adjustment does not apply", () => {
      // Holm over [0.03, 0.2, 0.5].
      expect(uncapped("g1")?.pValueAdjusted).toBeCloseTo(0.09);
      expect(uncapped("g2")?.pValueAdjusted).toBeCloseTo(0.4);
      expect(uncapped("g3")).toBeNull();
    });

    it("does not change the displayed results' family", () => {
      // Holm over [0.01, 0.04, 0.5].
      expect(adjusted(results, "g1")).toBeCloseTo(0.03);
      expect(adjusted(results, "g2")).toBeCloseTo(0.08);
    });

    it("widens their CI around their own lift", () => {
      const [lower, upper] = uncapped("g1")?.ciAdjusted ?? [NaN, NaN];
      expect((lower + upper) / 2).toBeCloseTo(0.04);
      expect(upper - lower).toBeGreaterThan(0.02);
    });
  });
  describe("power", () => {
    // What the stats engine returns for a goal metric: the inputs only.
    const powerInputs = {
      status: "successful",
      firstPeriodPairwiseSampleSize: 1000,
      sigmahat2Delta: 0.0009,
      targetMDE: 0.05,
    };
    const scalingFactor = (
      goalMetrics: string[],
      settings: Partial<ExperimentSnapshotAnalysisSettings> = {},
    ) =>
      enrich(
        [level("", { g1: { ...stat(0.01), power: powerInputs } })],
        goalMetrics,
        settings,
      )[0].variations[1].metrics.g1.power?.scalingFactor;

    it("works out how much more sample a test needs", () => {
      expect(scalingFactor(["g1"])).toBeCloseTo(1.8255615234375, 8);
    });

    it("asks more of each test when more goal metrics share the experiment's power", () => {
      expect(scalingFactor(["g1", "g2", "g3"])).toBeCloseTo(3.218994140625, 8);
    });

    it("counts the distinct goal metrics the snapshot lists, not the count the analysis stored", () => {
      expect(
        scalingFactor(["g1", "g2", "g3", "g2"], { numGoalMetrics: 1 }),
      ).toBe(scalingFactor(["g1", "g2", "g3"]));
      expect(scalingFactor(["g1"], { numGoalMetrics: 3 })).toBe(
        scalingFactor(["g1"]),
      );
    });

    it("leaves a test without power inputs alone", () => {
      const results = enrich([level("", { g1: stat(0.01) })], ["g1"]);
      expect(results[0].variations[1].metrics.g1.power).toBeUndefined();
    });
  });
});

describe("fillLegacyPValueCorrection", () => {
  const makeSnapshot = (
    settings: Partial<ExperimentSnapshotAnalysisSettings>,
  ) => {
    const analysis: ExperimentSnapshotAnalysis = {
      analysisKey: "a",
      settings: { ...unstamped, ...settings },
      dateCreated: new Date(),
      status: "success",
      results: [level("", { g1: stat(0.01), g2: stat(0.04) })],
    };
    return {
      analyses: [analysis],
      settings: { goalMetrics: ["g1", "g2"] },
    } as Parameters<typeof fillLegacyPValueCorrection>[0]["snapshot"];
  };

  it("corrects an analysis that records no correction, with the given one", () => {
    const snapshot = makeSnapshot({});
    const settingsBefore = { ...snapshot.analyses[0].settings };
    fillLegacyPValueCorrection({
      snapshot,
      pValueCorrection: "holm-bonferroni",
    });
    expect(adjusted(snapshot.analyses[0].results, "g1")).toBeCloseTo(0.02);
    expect(snapshot.analyses[0].settings).toEqual(settingsBefore);
  });

  it.each([null, "benjamini-hochberg" as const])(
    "leaves an analysis that records %s alone",
    (recorded) => {
      const snapshot = makeSnapshot({ pValueCorrection: recorded });
      fillLegacyPValueCorrection({
        snapshot,
        pValueCorrection: "holm-bonferroni",
      });
      expect(adjusted(snapshot.analyses[0].results, "g1")).toBeUndefined();
    },
  );

  it.each([
    {
      when: "there is no correction to apply",
      pValueCorrection: null,
      settings: {},
    },
    {
      when: "the analysis is never corrected",
      pValueCorrection: "holm-bonferroni" as const,
      settings: { statsEngine: "bayesian" as const },
    },
  ])(
    "leaves the results alone when $when",
    ({ pValueCorrection, settings }) => {
      const snapshot = makeSnapshot(settings);
      const resultsBefore = structuredClone(snapshot.analyses[0].results);
      fillLegacyPValueCorrection({ snapshot, pValueCorrection });
      expect(snapshot.analyses[0].results).toEqual(resultsBefore);
    },
  );

  it("skips a partial read that is missing a goal metric", () => {
    const snapshot = makeSnapshot({});
    fillLegacyPValueCorrection({
      snapshot,
      pValueCorrection: "holm-bonferroni",
      hydratedMetricIds: ["g1"],
    });
    expect(adjusted(snapshot.analyses[0].results, "g1")).toBeUndefined();
  });

  it("leaves stored power alone", () => {
    const snapshot = makeSnapshot({});
    const power = { status: "successful", targetMDE: 0.05, scalingFactor: 9 };
    snapshot.analyses[0].results[0].variations[1].metrics.g1.power = power;
    fillLegacyPValueCorrection({
      snapshot,
      pValueCorrection: "holm-bonferroni",
    });
    expect(snapshot.analyses[0].results[0].variations[1].metrics.g1.power).toBe(
      power,
    );
  });

  it("fills a partial read that has every goal metric", () => {
    const snapshot = makeSnapshot({});
    fillLegacyPValueCorrection({
      snapshot,
      pValueCorrection: "holm-bonferroni",
      hydratedMetricIds: ["g2", "g1", "other"],
    });
    expect(adjusted(snapshot.analyses[0].results, "g1")).toBeCloseTo(0.02);
  });
});

describe("getAnalysisPValueCorrection", () => {
  it("prefers what the analysis recorded, including none", () => {
    expect(
      getAnalysisPValueCorrection(
        { settings: { pValueCorrection: null } },
        "holm-bonferroni",
      ),
    ).toBeNull();
    expect(
      getAnalysisPValueCorrection(
        { settings: { pValueCorrection: "benjamini-hochberg" } },
        null,
      ),
    ).toBe("benjamini-hochberg");
  });

  it("falls back when the analysis recorded nothing", () => {
    expect(
      getAnalysisPValueCorrection({ settings: {} }, "holm-bonferroni"),
    ).toBe("holm-bonferroni");
    expect(getAnalysisPValueCorrection(undefined, undefined)).toBeNull();
  });
});

describe("getAnalysisPValueThreshold", () => {
  it("prefers the threshold the analysis ran at", () => {
    expect(
      getAnalysisPValueThreshold({ settings: { pValueThreshold: 0.01 } }, 0.05),
    ).toBe(0.01);
  });

  it("falls back when the analysis recorded none", () => {
    expect(getAnalysisPValueThreshold({ settings: {} }, 0.05)).toBe(0.05);
    expect(getAnalysisPValueThreshold(undefined, 0.05)).toBe(0.05);
  });
});

describe("restoreOpenAdjustedCI", () => {
  // What JSON makes of [-Infinity, Infinity].
  const fromJson = (ciAdjusted: [number, number]) =>
    JSON.parse(JSON.stringify({ ...stat(1), ciAdjusted })) as SnapshotMetric;

  it("restores the bounds JSON turned into null", () => {
    expect(
      restoreOpenAdjustedCI(fromJson([-Infinity, Infinity])).ciAdjusted,
    ).toEqual([-Infinity, Infinity]);
    expect(
      restoreOpenAdjustedCI(fromJson([-Infinity, 0.2])).ciAdjusted,
    ).toEqual([-Infinity, 0.2]);
  });

  it("returns the same object when there is nothing to restore", () => {
    const closed = fromJson([-0.1, 0.2]);
    expect(restoreOpenAdjustedCI(closed)).toBe(closed);
    const uncorrected = stat(0.5);
    expect(restoreOpenAdjustedCI(uncorrected)).toBe(uncorrected);
  });
});
