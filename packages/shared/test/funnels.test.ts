import {
  buildPrevResolvedExpr,
  conversionWindowToSeconds,
} from "shared/funnels";
import {
  expandDerivedMetricsInMap,
  ExperimentMetricInterface,
  funnelStepMetricId,
  getAllExpandedMetricIdsFromExperiment,
  getFunnelStepMetric,
  getFunnelStepMetrics,
  getMetricSnapshotSettings,
  parseFunnelStepMetricId,
} from "shared/experiments";
import { FunnelFactMetricInterface, RowFilter } from "shared/types/fact-table";

describe("conversionWindowToSeconds", () => {
  it("converts each supported unit", () => {
    expect(conversionWindowToSeconds({ unit: "minutes", value: 30 })).toBe(
      1800,
    );
    expect(conversionWindowToSeconds({ unit: "hours", value: 2 })).toBe(7200);
    expect(conversionWindowToSeconds({ unit: "days", value: 3 })).toBe(259200);
    expect(conversionWindowToSeconds({ unit: "weeks", value: 1 })).toBe(604800);
  });

  it("rounds fractional values and never returns less than one unit", () => {
    expect(conversionWindowToSeconds({ unit: "hours", value: 1.4 })).toBe(3600);
    expect(conversionWindowToSeconds({ unit: "hours", value: 1.6 })).toBe(7200);
    expect(conversionWindowToSeconds({ unit: "hours", value: 0.1 })).toBe(3600);
  });
});

describe("buildPrevResolvedExpr", () => {
  const resolvedTsColumn = (i: number) => `step_${i}_resolved_ts`;

  it("anchors on the immediately preceding step when it is required", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: false }, { optional: false }, { optional: false }],
        index: 2,
        resolvedTsColumn,
      }),
    ).toBe("step_1_resolved_ts");
  });

  it("skips optional steps and anchors on the nearest required one", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [
          { optional: false },
          { optional: true },
          { optional: true },
          { optional: false },
        ],
        index: 3,
        resolvedTsColumn,
      }),
    ).toBe("step_0_resolved_ts");
  });

  it("stops at the nearest required step even if earlier ones are optional", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: true }, { optional: false }, { optional: true }],
        index: 2,
        resolvedTsColumn,
      }),
    ).toBe("step_1_resolved_ts");
  });

  it("qualifies columns with the table alias when given one", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: false }, { optional: true }, { optional: false }],
        index: 2,
        resolvedTsColumn,
        alias: "r",
      }),
    ).toBe("r.step_0_resolved_ts");
  });

  it("falls through an optional step 0 to exposure when provided", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: true }, { optional: false }],
        index: 1,
        resolvedTsColumn,
        alias: "r",
        exposureColumn: "timestamp",
      }),
    ).toBe("r.timestamp");
  });

  it("does not use exposure when a required prior step exists", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: false }, { optional: false }],
        index: 1,
        resolvedTsColumn,
        exposureColumn: "timestamp",
      }),
    ).toBe("step_0_resolved_ts");
  });

  it("skips a run of optional steps onto exposure", () => {
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: true }, { optional: true }, { optional: false }],
        index: 2,
        resolvedTsColumn,
        exposureColumn: "timestamp",
      }),
    ).toBe("timestamp");
  });

  it("anchors on step 0 when every prior step is optional and there is no exposure", () => {
    // Product-analytics funnels have no exposure anchor but do guarantee step 0
    // is non-null, so this must never degrade to a NULL bound.
    expect(
      buildPrevResolvedExpr({
        steps: [{ optional: true }, { optional: false }],
        index: 1,
        resolvedTsColumn,
        alias: "r",
      }),
    ).toBe("r.step_0_resolved_ts");
  });
});

describe("funnel step metric ids", () => {
  it("round-trips", () => {
    const id = funnelStepMetricId("fact__abc", 2);
    expect(id).toBe("fact__abc?step=2");
    expect(parseFunnelStepMetricId(id)).toEqual({
      isFunnelStepMetric: true,
      baseMetricId: "fact__abc",
      stepIndex: 2,
    });
  });

  it("leaves plain metric ids alone", () => {
    expect(parseFunnelStepMetricId("fact__abc")).toEqual({
      isFunnelStepMetric: false,
      baseMetricId: "fact__abc",
      stepIndex: null,
    });
  });

  it("does not treat slice metric ids as funnel steps", () => {
    expect(
      parseFunnelStepMetricId("fact__abc?dim:country=US").isFunnelStepMetric,
    ).toBe(false);
  });
});

const signupRowFilter: RowFilter = {
  operator: "=",
  column: "event",
  values: ["signup"],
};

const funnelMetric = {
  id: "fact__funnel",
  name: "Signup Funnel",
  metricType: "funnel",
  numerator: null,
  denominator: null,
  regressionAdjustmentOverride: true,
  regressionAdjustmentEnabled: true,
  regressionAdjustmentDays: 14,
  priorSettings: { override: false, proper: false, mean: 0, stddev: 1 },
  funnelSettings: {
    steps: [
      {
        name: "View",
        factTableId: "ft_views",
        rowFilters: [],
        optional: false,
      },
      {
        name: "Signup",
        factTableId: "ft_events",
        rowFilters: [signupRowFilter],
        optional: false,
      },
    ],
  },
} as unknown as FunnelFactMetricInterface;

function expandFunnelMetric(): Map<string, ExperimentMetricInterface> {
  const metricMap = new Map<string, ExperimentMetricInterface>([
    [funnelMetric.id, funnelMetric],
  ]);
  expandDerivedMetricsInMap({
    metricMap,
    factTableMap: new Map(),
    experiment: { goalMetrics: [funnelMetric.id] },
  });
  return metricMap;
}

describe("getFunnelStepMetrics", () => {
  it("mints one proportion metric per step, keyed by step id", () => {
    const steps = getFunnelStepMetrics(funnelMetric);

    expect(steps.map((s) => s.id)).toEqual([
      funnelStepMetricId(funnelMetric.id, 0),
      funnelStepMetricId(funnelMetric.id, 1),
    ]);
    expect(steps.map((s) => s.name)).toEqual([
      "Signup Funnel: View",
      "Signup Funnel: Signup",
    ]);
    steps.forEach((step) => {
      expect(step.metricType).toBe("proportion");
      expect(step.funnelSettings).toBeNull();
      expect(step.denominator).toBeNull();
    });
  });

  it("turns each step's own events into a distinct-users numerator", () => {
    expect(getFunnelStepMetrics(funnelMetric)[1].numerator).toEqual({
      factTableId: "ft_events",
      column: "$$distinctUsers",
      rowFilters: [signupRowFilter],
    });
  });
});

describe("getFunnelStepMetric", () => {
  it("returns the metric for a step the funnel has", () => {
    expect(getFunnelStepMetric(funnelMetric, 1)?.name).toBe(
      "Signup Funnel: Signup",
    );
  });

  it("returns null for a step index outside the funnel", () => {
    // Results and snapshots outlive edits that remove a step.
    expect(getFunnelStepMetric(funnelMetric, 2)).toBeNull();
    expect(getFunnelStepMetric(funnelMetric, -1)).toBeNull();
  });
});

describe("expandDerivedMetricsInMap funnel expansion", () => {
  it("adds the step metrics to the map", () => {
    const metricMap = expandFunnelMetric();

    getFunnelStepMetrics(funnelMetric).forEach((step) => {
      expect(metricMap.get(step.id)).toEqual(step);
    });
  });

  it("leaves the funnel itself untouched", () => {
    expect(expandFunnelMetric().get(funnelMetric.id)).toBe(funnelMetric);
  });
});

describe("getAllExpandedMetricIdsFromExperiment funnel expansion", () => {
  it("picks up the step ids minted into the map", () => {
    const ids = getAllExpandedMetricIdsFromExperiment({
      exp: { goalMetrics: [funnelMetric.id] },
      expandedMetricMap: expandFunnelMetric(),
    });
    expect(ids).toContain(funnelMetric.id);
    expect(ids).toContain(funnelStepMetricId(funnelMetric.id, 0));
    expect(ids).toContain(funnelStepMetricId(funnelMetric.id, 1));
  });
});

describe("regression adjustment for funnel metrics", () => {
  // The funnel SQL emits no covariate columns, so the settings must say so even
  // when the metric itself asks for CUPED.
  const getRegressionAdjustment = (metric: ExperimentMetricInterface) =>
    getMetricSnapshotSettings({
      metric,
      denominatorMetrics: [],
      experimentRegressionAdjustmentEnabled: true,
      organizationSettings: { regressionAdjustmentEnabled: true },
    }).metricSnapshotSettings;

  it("is disabled for the funnel", () => {
    const settings = getRegressionAdjustment(funnelMetric);
    expect(settings.regressionAdjustmentEnabled).toBe(false);
    expect(settings.regressionAdjustmentAvailable).toBe(false);
    expect(settings.regressionAdjustmentReason).toBe(
      "funnel metrics not supported",
    );
  });

  it("is disabled for its steps, which are proportions on their own", () => {
    getFunnelStepMetrics(funnelMetric).forEach((step) => {
      const settings = getRegressionAdjustment(step);
      expect(settings.regressionAdjustmentEnabled).toBe(false);
      expect(settings.regressionAdjustmentAvailable).toBe(false);
      expect(settings.regressionAdjustmentReason).toBe(
        "funnel metrics not supported",
      );
    });
  });
});
