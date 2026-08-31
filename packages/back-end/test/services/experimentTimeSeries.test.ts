import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import { FunnelFactMetricInterface } from "shared/types/fact-table";
import { funnelStepMetricId } from "shared/experiments";
import { ExperimentInterface } from "shared/validators";
import {
  getMetricSettingsHash,
  updateExperimentAnalysisTimeSeries,
} from "back-end/src/services/experimentTimeSeries";
import {
  getTimeSeriesAnalyses,
  getTimeSeriesAnalysisSettings,
} from "back-end/src/services/experimentDimensionTimeSeries";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";

function makeAnalysisSettings(
  overrides: Partial<ExperimentSnapshotAnalysisSettings> = {},
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: [],
    statsEngine: "bayesian",
    regressionAdjusted: false,
    sequentialTesting: false,
    baselineVariationIndex: 0,
    differenceType: "relative",
    pValueCorrection: null,
    numGoalMetrics: 1,
    numGuardrailMetrics: 0,
    ...overrides,
  };
}

function makeAnalysis({
  differenceType,
  value,
  errored = false,
  benignError = false,
  settings = {},
}: {
  differenceType: "relative" | "absolute" | "scaled";
  value: number;
  errored?: boolean;
  benignError?: boolean;
  settings?: Partial<ExperimentSnapshotAnalysisSettings>;
}): ExperimentSnapshotAnalysis {
  // A stats-engine compute failure zeroes the metric and flags computeFailed on
  // every variation, mirroring getFailedMetricResult in stats.ts.
  const erroredMetric = {
    value: 0,
    cr: 0,
    users: 0,
    buckets: [],
    errorMessage: "boom",
    computeFailed: true,
  };
  return {
    analysisKey: `analysis_${differenceType}_${value}`,
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    status: "success",
    settings: makeAnalysisSettings({
      differenceType,
      ...settings,
    }),
    results: [
      {
        name: "All",
        srm: 0.9,
        variations: [
          {
            users: 100,
            metrics: {
              met_1: errored
                ? erroredMetric
                : {
                    value: 10,
                    cr: 0.1,
                    users: 100,
                    stats: { users: 100, mean: 0.1, stddev: 0.2 },
                  },
            },
          },
          {
            users: 120,
            metrics: {
              met_1: errored
                ? erroredMetric
                : {
                    value,
                    cr: 0.2,
                    users: 120,
                    ci: [value - 0.1, value + 0.1],
                    pValue: 0.03,
                    expected: value,
                    stats: { users: 120, mean: 0.2, stddev: 0.3 },
                    // A successful metric can still carry an errorMessage (e.g.
                    // gbstats null, or a benign "no units" note). It must not be
                    // dropped, only computeFailed is.
                    ...(benignError ? { errorMessage: "no units" } : {}),
                  },
            },
          },
        ],
      },
    ],
  };
}

function makeSnapshot(
  overrides: Partial<ExperimentSnapshotInterface> = {},
): ExperimentSnapshotInterface {
  return {
    id: "snp_1",
    organization: "org_1",
    experiment: "exp_1",
    phase: 0,
    dimension: null,
    dateCreated: new Date("2025-01-02T00:00:00Z"),
    runStarted: null,
    status: "success",
    settings: {
      manual: false,
      dimensions: [],
      metricSettings: [],
      goalMetrics: ["met_1"],
      secondaryMetrics: [],
      guardrailMetrics: [],
      activationMetric: null,
      defaultMetricPriorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: 1,
      },
      regressionAdjustmentEnabled: false,
      attributionModel: "firstExposure",
      experimentId: "exp_1",
      queryFilter: "",
      segment: "",
      skipPartialData: false,
      datasourceId: "ds_1",
      exposureQueryId: "eq_1",
      startDate: new Date("2025-01-01T00:00:00Z"),
      endDate: new Date("2025-01-02T00:00:00Z"),
      variations: [
        { id: "0", weight: 0.5 },
        { id: "1", weight: 0.5 },
      ],
    },
    type: "standard",
    queries: [],
    unknownVariations: [],
    multipleExposures: 0,
    analyses: [],
    ...overrides,
  };
}

function makeExperiment(): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    phases: [
      {
        name: "Main",
        dateStarted: new Date("2025-01-01T00:00:00Z"),
        reason: "",
        coverage: 1,
        variationWeights: [0.5, 0.5],
      },
    ],
    variations: [
      { id: "0", name: "Control", key: "0" },
      { id: "1", name: "Variation", key: "1" },
    ],
  } as ExperimentInterface;
}

function makeContext(extraFns: Record<string, unknown> = {}) {
  return {
    models: {
      metricTimeSeries: {
        upsertMultipleSingleDataPoint: jest.fn().mockResolvedValue(undefined),
      },
      ...extraFns,
    },
  };
}

describe("updateExperimentAnalysisTimeSeries dimension gate", () => {
  it("rejects on-demand unit-dim analyses when the snapshot did not precompute that unit dimension", async () => {
    const context = makeContext();
    await expect(
      updateExperimentAnalysisTimeSeries({
        context: context as never,
        experiment: makeExperiment(),
        experimentSnapshot: makeSnapshot({
          dimension: "dim_country",
          triggeredBy: "manual",
        }),
        analyses: [
          makeAnalysis({
            differenceType: "relative",
            value: 1.2,
            settings: { dimensions: ["dim_country"] },
          }),
        ],
        allMetricIds: ["met_1"],
        factMetrics: undefined,
        factTableMap: new Map(),
      }),
    ).rejects.toThrow(/unsupported dimension: dim_country/);
  });

  it("accepts a unit-dim analysis when the parent snapshot precomputed that unit dimension", async () => {
    const context = makeContext();
    await expect(
      updateExperimentAnalysisTimeSeries({
        context: context as never,
        experiment: makeExperiment(),
        experimentSnapshot: makeSnapshot({
          settings: {
            ...makeSnapshot().settings,
            precomputedUnitDimensionIds: ["dim_country"],
          },
        }),
        analyses: [
          makeAnalysis({
            differenceType: "relative",
            value: 1.2,
            settings: { dimensions: ["dim_country"] },
          }),
        ],
        allMetricIds: ["met_1"],
        factMetrics: undefined,
        factTableMap: new Map(),
      }),
    ).resolves.toBeUndefined();
    expect(
      context.models.metricTimeSeries.upsertMultipleSingleDataPoint,
    ).toHaveBeenCalled();
  });

  it("still accepts precomputed dim analyses regardless of triggeredBy (no regression)", async () => {
    const context = makeContext();
    await expect(
      updateExperimentAnalysisTimeSeries({
        context: context as never,
        experiment: makeExperiment(),
        experimentSnapshot: makeSnapshot({
          triggeredBy: "manual",
        }),
        analyses: [
          makeAnalysis({
            differenceType: "relative",
            value: 1.2,
            settings: { dimensions: ["precomputed:country"] },
          }),
        ],
        allMetricIds: ["met_1"],
        factMetrics: undefined,
        factTableMap: new Map(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("updateExperimentAnalysisTimeSeries", () => {
  it("does not let covariate absolute analyses replace regular absolute results", async () => {
    const upsertMultipleSingleDataPoint = jest
      .fn()
      .mockResolvedValue(undefined);
    const context = {
      models: {
        metricTimeSeries: {
          upsertMultipleSingleDataPoint,
        },
      },
    };

    await updateExperimentAnalysisTimeSeries({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot(),
      analyses: [
        makeAnalysis({ differenceType: "relative", value: 1.2 }),
        makeAnalysis({
          differenceType: "absolute",
          value: 999,
          settings: {
            statsEngine: "frequentist",
            sequentialTesting: false,
            useCovariateAsResponse: true,
          },
        }),
        makeAnalysis({ differenceType: "absolute", value: 12 }),
        makeAnalysis({ differenceType: "scaled", value: 120 }),
      ],
      allMetricIds: ["met_1"],
      factMetrics: undefined,
      factTableMap: new Map(),
    });

    expect(upsertMultipleSingleDataPoint).toHaveBeenCalledTimes(1);
    const [dataPoints] = upsertMultipleSingleDataPoint.mock.calls[0];
    expect(dataPoints[0].singleDataPoint.variations[1].absolute?.value).toBe(
      12,
    );
  });

  it("records difference types that computed even when the base analysis errored", async () => {
    const upsertMultipleSingleDataPoint = jest
      .fn()
      .mockResolvedValue(undefined);
    const context = {
      models: {
        metricTimeSeries: {
          upsertMultipleSingleDataPoint,
        },
      },
    };

    await updateExperimentAnalysisTimeSeries({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot(),
      analyses: [
        makeAnalysis({ differenceType: "relative", value: 1.2, errored: true }),
        makeAnalysis({ differenceType: "absolute", value: 12 }),
        makeAnalysis({ differenceType: "scaled", value: 120 }),
      ],
      allMetricIds: ["met_1"],
      factMetrics: undefined,
      factTableMap: new Map(),
    });

    expect(upsertMultipleSingleDataPoint).toHaveBeenCalledTimes(1);
    const [dataPoints] = upsertMultipleSingleDataPoint.mock.calls[0];
    const variation = dataPoints[0].singleDataPoint.variations[1];
    expect(variation.relative).toBeUndefined();
    expect(variation.absolute?.value).toBe(12);
    expect(variation.scaled?.value).toBe(120);
    // stats must come from a computed difference type, not the errored base.
    expect(variation.stats).toEqual({ users: 120, mean: 0.2, stddev: 0.3 });
  });

  it("drops an errored difference type instead of writing a zeroed value", async () => {
    const upsertMultipleSingleDataPoint = jest
      .fn()
      .mockResolvedValue(undefined);
    const context = {
      models: {
        metricTimeSeries: {
          upsertMultipleSingleDataPoint,
        },
      },
    };

    await updateExperimentAnalysisTimeSeries({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot(),
      analyses: [
        makeAnalysis({ differenceType: "relative", value: 1.2 }),
        makeAnalysis({ differenceType: "absolute", value: 12 }),
        makeAnalysis({ differenceType: "scaled", value: 120, errored: true }),
      ],
      allMetricIds: ["met_1"],
      factMetrics: undefined,
      factTableMap: new Map(),
    });

    expect(upsertMultipleSingleDataPoint).toHaveBeenCalledTimes(1);
    const [dataPoints] = upsertMultipleSingleDataPoint.mock.calls[0];
    const variation = dataPoints[0].singleDataPoint.variations[1];
    expect(variation.relative?.value).toBe(1.2);
    expect(variation.absolute?.value).toBe(12);
    expect(variation.scaled).toBeUndefined();
  });

  it("skips a metric when every difference type errored", async () => {
    const upsertMultipleSingleDataPoint = jest
      .fn()
      .mockResolvedValue(undefined);
    const context = {
      models: {
        metricTimeSeries: {
          upsertMultipleSingleDataPoint,
        },
      },
    };

    await updateExperimentAnalysisTimeSeries({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot(),
      analyses: [
        makeAnalysis({ differenceType: "relative", value: 1.2, errored: true }),
        makeAnalysis({ differenceType: "absolute", value: 12, errored: true }),
        makeAnalysis({ differenceType: "scaled", value: 120, errored: true }),
      ],
      allMetricIds: ["met_1"],
      factMetrics: undefined,
      factTableMap: new Map(),
    });

    expect(upsertMultipleSingleDataPoint).not.toHaveBeenCalled();
  });

  it("records a successful metric that carries a non-fatal errorMessage", async () => {
    const upsertMultipleSingleDataPoint = jest
      .fn()
      .mockResolvedValue(undefined);
    const context = {
      models: {
        metricTimeSeries: {
          upsertMultipleSingleDataPoint,
        },
      },
    };

    await updateExperimentAnalysisTimeSeries({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot(),
      analyses: [
        makeAnalysis({
          differenceType: "relative",
          value: 1.2,
          benignError: true,
        }),
        makeAnalysis({ differenceType: "absolute", value: 12 }),
        makeAnalysis({ differenceType: "scaled", value: 120 }),
      ],
      allMetricIds: ["met_1"],
      factMetrics: undefined,
      factTableMap: new Map(),
    });

    expect(upsertMultipleSingleDataPoint).toHaveBeenCalledTimes(1);
    const [dataPoints] = upsertMultipleSingleDataPoint.mock.calls[0];
    const variation = dataPoints[0].singleDataPoint.variations[1];
    expect(variation.relative?.value).toBe(1.2);
  });

  it("skips writes when there are no time-series-compatible analyses", async () => {
    const upsertMultipleSingleDataPoint = jest
      .fn()
      .mockResolvedValue(undefined);
    const context = {
      models: {
        metricTimeSeries: {
          upsertMultipleSingleDataPoint,
        },
      },
    };

    await updateExperimentAnalysisTimeSeries({
      context: context as never,
      experiment: makeExperiment(),
      experimentSnapshot: makeSnapshot(),
      analyses: [
        makeAnalysis({
          differenceType: "relative",
          value: 1.2,
          settings: { baselineVariationIndex: 1 },
        }),
      ],
      allMetricIds: ["met_1"],
      factMetrics: undefined,
      factTableMap: new Map(),
    });

    expect(upsertMultipleSingleDataPoint).not.toHaveBeenCalled();
  });
});

describe("time series analysis settings", () => {
  it("derives dimension settings from a compatible base analysis", () => {
    expect(
      getTimeSeriesAnalysisSettings({
        baseSettings: makeAnalysisSettings({
          pValueThreshold: 0.01,
        }),
        dimensionId: "precomputed:country",
      }),
    ).toEqual([
      {
        dimensions: ["precomputed:country"],
        statsEngine: "bayesian",
        regressionAdjusted: false,
        sequentialTesting: false,
        baselineVariationIndex: 0,
        differenceType: "relative",
        pValueCorrection: null,
        pValueThreshold: 0.01,
        numGoalMetrics: 1,
        numGuardrailMetrics: 0,
      },
      {
        dimensions: ["precomputed:country"],
        statsEngine: "bayesian",
        regressionAdjusted: false,
        sequentialTesting: false,
        baselineVariationIndex: 0,
        differenceType: "absolute",
        pValueCorrection: null,
        pValueThreshold: 0.01,
        numGoalMetrics: 1,
        numGuardrailMetrics: 0,
      },
      {
        dimensions: ["precomputed:country"],
        statsEngine: "bayesian",
        regressionAdjusted: false,
        sequentialTesting: false,
        baselineVariationIndex: 0,
        differenceType: "scaled",
        pValueCorrection: null,
        pValueThreshold: 0.01,
        numGoalMetrics: 1,
        numGuardrailMetrics: 0,
      },
    ]);
  });

  it("selects the standard baseline-zero analyses and skips special analyses", () => {
    const selected = getTimeSeriesAnalyses({
      analyses: [
        makeAnalysis({
          differenceType: "relative",
          value: 99,
          settings: { baselineVariationIndex: 1 },
        }),
        makeAnalysis({
          differenceType: "absolute",
          value: 999,
          settings: { useCovariateAsResponse: true },
        }),
        makeAnalysis({ differenceType: "relative", value: 1.2 }),
        makeAnalysis({ differenceType: "absolute", value: 12 }),
        makeAnalysis({ differenceType: "scaled", value: 120 }),
      ],
    });

    expect(
      selected.map((analysis) => analysis.settings.differenceType),
    ).toEqual(["relative", "absolute", "scaled"]);
    expect(
      selected.map((analysis) => analysis.results[0].variations[1]),
    ).toEqual([
      expect.objectContaining({
        metrics: { met_1: expect.objectContaining({ value: 1.2 }) },
      }),
      expect.objectContaining({
        metrics: { met_1: expect.objectContaining({ value: 12 }) },
      }),
      expect.objectContaining({
        metrics: { met_1: expect.objectContaining({ value: 120 }) },
      }),
    ]);
  });

  it("treats omitted baseline variation as control baseline", () => {
    const selected = getTimeSeriesAnalyses({
      analyses: [
        makeAnalysis({
          differenceType: "relative",
          value: 1.2,
          settings: { baselineVariationIndex: undefined },
        }),
        makeAnalysis({
          differenceType: "absolute",
          value: 12,
          settings: { baselineVariationIndex: undefined },
        }),
        makeAnalysis({
          differenceType: "scaled",
          value: 120,
          settings: { baselineVariationIndex: undefined },
        }),
      ],
    });

    expect(
      selected.map((analysis) => analysis.settings.differenceType),
    ).toEqual(["relative", "absolute", "scaled"]);
  });
});

describe("getMetricSettingsHash funnel settings", () => {
  const now = new Date("2025-01-01T00:00:00Z");
  const factTable = factTableFactory.build({
    id: "ft_events",
    filters: [
      {
        id: "purchase_filter",
        name: "Purchases",
        description: "",
        value: "event_name = 'purchase'",
        dateCreated: now,
        dateUpdated: now,
        managedBy: "",
      },
    ],
  });
  const metric: FunnelFactMetricInterface = {
    ...factMetricFactory.build({ id: "fact__checkout_funnel" }),
    id: "fact__checkout_funnel",
    metricType: "funnel",
    numerator: null,
    denominator: null,
    funnelSettings: {
      steps: [
        {
          name: "Viewed product",
          factTableId: factTable.id,
          rowFilters: [],
          optional: false,
          conversionWindow: null,
        },
        {
          name: "Purchased",
          factTableId: factTable.id,
          rowFilters: [
            { operator: "saved_filter", values: ["purchase_filter"] },
          ],
          optional: false,
          conversionWindow: { unit: "hours", value: 24 },
        },
      ],
    },
  };

  it("changes when funnel step settings change", () => {
    const originalHash = getMetricSettingsHash(
      metric.id,
      undefined,
      [metric],
      new Map([[factTable.id, factTable]]),
    );
    const changedMetric: FunnelFactMetricInterface = {
      ...metric,
      funnelSettings: {
        ...metric.funnelSettings,
        steps: metric.funnelSettings.steps.map((step, index) =>
          index === 1
            ? {
                ...step,
                conversionWindow: { unit: "hours", value: 48 },
              }
            : step,
        ),
      },
    };

    expect(
      getMetricSettingsHash(
        changedMetric.id,
        undefined,
        [changedMetric],
        new Map([[factTable.id, factTable]]),
      ),
    ).not.toEqual(originalHash);
  });

  it("hashes a funnel step against its parent definition", () => {
    const stepId = funnelStepMetricId(metric.id, 0);
    const originalHash = getMetricSettingsHash(
      stepId,
      undefined,
      [metric],
      new Map([[factTable.id, factTable]]),
    );
    const changedMetric: FunnelFactMetricInterface = {
      ...metric,
      funnelSettings: {
        ...metric.funnelSettings,
        steps: metric.funnelSettings.steps.map((step, index) =>
          index === 1
            ? { ...step, conversionWindow: { unit: "hours", value: 48 } }
            : step,
        ),
      },
    };

    // Step 0's own definition is untouched, but the funnel it comes from
    // changed, so the step is flagged too rather than silently continuing.
    expect(
      getMetricSettingsHash(
        stepId,
        undefined,
        [changedMetric],
        new Map([[factTable.id, factTable]]),
      ),
    ).not.toEqual(originalHash);
  });

  it("keeps the steps of one funnel distinct from each other", () => {
    const hashForStep = (stepIndex: number) => {
      const id = funnelStepMetricId(metric.id, stepIndex);
      return getMetricSettingsHash(
        id,
        { id } as MetricForSnapshot,
        [metric],
        new Map([[factTable.id, factTable]]),
      );
    };

    expect(hashForStep(0)).not.toEqual(hashForStep(1));
  });

  it("changes when a referenced saved filter changes", () => {
    const originalHash = getMetricSettingsHash(
      metric.id,
      undefined,
      [metric],
      new Map([[factTable.id, factTable]]),
    );
    const changedFactTable = {
      ...factTable,
      filters: factTable.filters.map((filter) => ({
        ...filter,
        value: "event_name = 'completed_purchase'",
      })),
    };

    expect(
      getMetricSettingsHash(
        metric.id,
        undefined,
        [metric],
        new Map([[changedFactTable.id, changedFactTable]]),
      ),
    ).not.toEqual(originalHash);
  });

  describe("steps spanning several fact tables", () => {
    const ordersFactTable = factTableFactory.build({
      id: "ft_orders",
      sql: "SELECT user_id, timestamp FROM orders",
      filters: [
        {
          id: "paid_filter",
          name: "Paid orders",
          description: "",
          value: "status = 'paid'",
          dateCreated: now,
          dateUpdated: now,
          managedBy: "",
        },
      ],
    });
    const crossTableMetric: FunnelFactMetricInterface = {
      ...metric,
      funnelSettings: {
        steps: [
          metric.funnelSettings.steps[0],
          {
            name: "Purchased",
            factTableId: ordersFactTable.id,
            rowFilters: [{ operator: "saved_filter", values: ["paid_filter"] }],
            optional: false,
            conversionWindow: { unit: "hours", value: 24 },
          },
        ],
      },
    };
    const buildFactTableMap = (
      orders: typeof ordersFactTable = ordersFactTable,
    ) =>
      new Map([
        [factTable.id, factTable],
        [orders.id, orders],
      ]);

    it("changes when a later step's fact table SQL changes", () => {
      const originalHash = getMetricSettingsHash(
        crossTableMetric.id,
        undefined,
        [crossTableMetric],
        buildFactTableMap(),
      );

      expect(
        getMetricSettingsHash(
          crossTableMetric.id,
          undefined,
          [crossTableMetric],
          buildFactTableMap({
            ...ordersFactTable,
            sql: "SELECT user_id, timestamp FROM orders_v2",
          }),
        ),
      ).not.toEqual(originalHash);
    });

    it("changes when a saved filter on a later step's own fact table changes", () => {
      const originalHash = getMetricSettingsHash(
        crossTableMetric.id,
        undefined,
        [crossTableMetric],
        buildFactTableMap(),
      );

      expect(
        getMetricSettingsHash(
          crossTableMetric.id,
          undefined,
          [crossTableMetric],
          buildFactTableMap({
            ...ordersFactTable,
            filters: ordersFactTable.filters.map((filter) => ({
              ...filter,
              value: "status = 'refunded'",
            })),
          }),
        ),
      ).not.toEqual(originalHash);
    });

    it("ignores changes to fact tables the funnel does not read", () => {
      const originalHash = getMetricSettingsHash(
        metric.id,
        undefined,
        [metric],
        buildFactTableMap(),
      );

      expect(
        getMetricSettingsHash(
          metric.id,
          undefined,
          [metric],
          buildFactTableMap({
            ...ordersFactTable,
            sql: "SELECT user_id, timestamp FROM orders_v2",
          }),
        ),
      ).toEqual(originalHash);
    });
  });
});
