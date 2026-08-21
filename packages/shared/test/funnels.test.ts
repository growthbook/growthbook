import {
  buildPrevResolvedExpr,
  conversionWindowToSeconds,
  deriveFunnelUnit,
  funnelDatasetToFunnelSettings,
  funnelSettingsToFunnelDataset,
  getFunnelBuilderViolations,
  getFunnelRuleViolations,
  getFunnelSaveBlockers,
  MAX_FUNNEL_STEPS,
  type FunnelRuleFactTable,
  type FunnelRuleInput,
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
import {
  explorationConfigValidator,
  funnelSettingsValidator,
} from "shared/validators";
import {
  FunnelFactMetricInterface,
  FunnelStep,
  RowFilter,
} from "shared/types/fact-table";

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

describe("getFunnelRuleViolations", () => {
  const factTables: Record<string, FunnelRuleFactTable> = {
    ft_events: {
      id: "ft_events",
      datasource: "ds_1",
      userIdTypes: ["user_id", "anonymous_id"],
    },
    ft_other: { id: "ft_other", datasource: "ds_1", userIdTypes: ["user_id"] },
    ft_wrong_ds: {
      id: "ft_wrong_ds",
      datasource: "ds_2",
      userIdTypes: ["user_id"],
    },
  };
  const getFactTable = (id: string) => factTables[id];

  const step = (overrides: Partial<FunnelStep> = {}): FunnelStep => ({
    name: "Step",
    factTableId: "ft_events",
    rowFilters: [],
    optional: false,
    ...overrides,
  });

  const codes = (input: Partial<FunnelRuleInput>) =>
    getFunnelRuleViolations({
      steps: [step(), step()],
      datasourceId: "ds_1",
      getFactTable,
      ...input,
    }).map((v) => v.code);

  it("accepts a valid funnel", () => {
    expect(codes({})).toEqual([]);
  });

  it("requires at least two steps", () => {
    expect(codes({ steps: [step()] })).toContain("too_few_steps");
  });

  it("rejects more steps than the cap but allows exactly the cap", () => {
    const atCap = Array.from({ length: MAX_FUNNEL_STEPS }, () => step());
    expect(codes({ steps: atCap })).toEqual([]);
    expect(codes({ steps: [...atCap, step()] })).toContain("too_many_steps");
  });

  it("rejects non-sequential ordering and session-based funnels", () => {
    expect(codes({ ordering: "unordered" })).toContain("unsupported_ordering");
    expect(codes({ ordering: "strict" })).toContain("unsupported_ordering");
    expect(codes({ sessionBased: true })).toContain("session_based");
    expect(codes({ ordering: "sequential" })).toEqual([]);
  });

  it("names the steps that are missing a fact table", () => {
    const violations = getFunnelRuleViolations({
      steps: [step(), step({ factTableId: "" }), step({ factTableId: "" })],
      datasourceId: "ds_1",
      getFactTable,
    });
    expect(
      violations.find((v) => v.code === "missing_step_fact_table")?.message,
    ).toContain("step 2, 3");
  });

  it("rejects steps spanning more than one fact table", () => {
    expect(
      codes({ steps: [step(), step({ factTableId: "ft_other" })] }),
    ).toContain("multi_fact_table");
  });

  it("rejects an unresolvable fact table", () => {
    expect(
      codes({ steps: [step({ factTableId: "ft_nope" }), step()] }),
    ).toContain("unknown_fact_table");
  });

  it("rejects a fact table belonging to another datasource", () => {
    expect(
      codes({
        steps: [
          step({ factTableId: "ft_wrong_ds" }),
          step({ factTableId: "ft_wrong_ds" }),
        ],
      }),
    ).toContain("datasource_mismatch");
  });

  it("requires every step to be named", () => {
    const violations = getFunnelRuleViolations({
      steps: [step(), step({ name: "" })],
      datasourceId: "ds_1",
      getFactTable,
    });
    expect(
      violations.find((v) => v.code === "missing_step_name")?.message,
    ).toBe("Funnel step 2 must have a name");
  });

  it("orders violations so callers that throw report the most basic problem", () => {
    expect(codes({ steps: [step({ factTableId: "" })] })[0]).toBe(
      "too_few_steps",
    );
  });
});

describe("getFunnelSaveBlockers", () => {
  const getFactTable = (id: string) =>
    id === "ft_events"
      ? { id, datasource: "ds_1", userIdTypes: ["user_id"] }
      : undefined;

  const steps: FunnelStep[] = [
    { name: "View", factTableId: "ft_events", rowFilters: [], optional: false },
    { name: "Buy", factTableId: "ft_events", rowFilters: [], optional: false },
  ];

  it("returns nothing for a savable funnel", () => {
    expect(
      getFunnelSaveBlockers({
        dataset: { steps },
        datasourceId: "ds_1",
        getFactTable,
      }),
    ).toEqual([]);
  });

  it("passes rule messages through verbatim so the UI can show a reason", () => {
    expect(
      getFunnelSaveBlockers({
        dataset: { steps: [steps[0]] },
        datasourceId: "ds_1",
        getFactTable,
      }),
    ).toEqual(["Funnel metrics need at least 2 steps"]);
  });

  it("blocks a warehouse that cannot run funnels", () => {
    const blockers = getFunnelSaveBlockers({
      dataset: { steps },
      datasourceId: "ds_1",
      getFactTable,
      datasourceSupportsFunnels: false,
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/warehouse type/);
  });
});

describe("funnel dataset <-> funnel settings", () => {
  const steps: FunnelStep[] = [
    { name: "View", factTableId: "ft_events", rowFilters: [], optional: false },
    {
      name: "Buy",
      factTableId: "ft_events",
      rowFilters: [],
      optional: false,
      conversionWindow: { unit: "days", value: 3 },
    },
  ];

  it("drops the unit and y-axis when saving", () => {
    const settings = funnelDatasetToFunnelSettings({
      steps,
      concurrencyWindowSeconds: 60,
    });
    expect(settings).toEqual({
      steps,
      ordering: "sequential",
      concurrencyWindowSeconds: 60,
    });
  });

  it("omits the concurrency window rather than defaulting it", () => {
    expect(funnelDatasetToFunnelSettings({ steps })).not.toHaveProperty(
      "concurrencyWindowSeconds",
    );
    expect(
      funnelSettingsToFunnelDataset({ steps }, "user_id"),
    ).not.toHaveProperty("concurrencyWindowSeconds");
  });

  it("keeps a zero concurrency window, which is meaningful", () => {
    expect(
      funnelDatasetToFunnelSettings({ steps, concurrencyWindowSeconds: 0 })
        .concurrencyWindowSeconds,
    ).toBe(0);
  });

  it("attaches the supplied unit when loading", () => {
    expect(
      funnelSettingsToFunnelDataset(
        { steps, concurrencyWindowSeconds: 30 },
        "user_id",
      ),
    ).toEqual({
      type: "funnel",
      unit: "user_id",
      steps,
      concurrencyWindowSeconds: 30,
    });
  });

  it("treats a null unit as a valid pre-submission state", () => {
    expect(funnelSettingsToFunnelDataset({ steps }, null).unit).toBeNull();
  });

  it("round-trips steps and conversion windows unchanged", () => {
    const back = funnelSettingsToFunnelDataset(
      funnelDatasetToFunnelSettings({ steps, concurrencyWindowSeconds: 120 }),
      "user_id",
    );
    expect(back.steps).toEqual(steps);
    expect(back.concurrencyWindowSeconds).toBe(120);
  });
});

describe("deriveFunnelUnit", () => {
  const tables: Record<string, FunnelRuleFactTable> = {
    a: { id: "a", datasource: "ds_1", userIdTypes: ["user_id", "device_id"] },
    b: {
      id: "b",
      datasource: "ds_1",
      userIdTypes: ["device_id", "session_id"],
    },
    none: { id: "none", datasource: "ds_1", userIdTypes: [] },
  };
  const getFactTable = (id: string) => tables[id];

  const stepsOn = (...ids: string[]): FunnelStep[] =>
    ids.map((factTableId, i) => ({
      name: `Step ${i + 1}`,
      factTableId,
      rowFilters: [],
      optional: false,
    }));

  it("takes the first shared unit by default", () => {
    expect(deriveFunnelUnit({ steps: stepsOn("a", "a"), getFactTable })).toBe(
      "user_id",
    );
  });

  it("prefers the requested unit when every step has it", () => {
    expect(
      deriveFunnelUnit({
        steps: stepsOn("a", "a"),
        getFactTable,
        preferredUnit: "device_id",
      }),
    ).toBe("device_id");
  });

  it("ignores a preferred unit that is not on every step", () => {
    expect(
      deriveFunnelUnit({
        steps: stepsOn("a", "b"),
        getFactTable,
        preferredUnit: "user_id",
      }),
    ).toBe("device_id");
  });

  it("intersects across fact tables rather than trusting the first", () => {
    expect(deriveFunnelUnit({ steps: stepsOn("a", "b"), getFactTable })).toBe(
      "device_id",
    );
  });

  it("returns null when the fact tables share no unit", () => {
    expect(
      deriveFunnelUnit({ steps: stepsOn("a", "none"), getFactTable }),
    ).toBeNull();
  });

  it("returns null rather than guessing when a step is unresolved", () => {
    expect(
      deriveFunnelUnit({ steps: stepsOn("a", "missing"), getFactTable }),
    ).toBeNull();
    expect(
      deriveFunnelUnit({ steps: stepsOn("a", ""), getFactTable }),
    ).toBeNull();
  });

  it("returns null for an empty funnel", () => {
    expect(deriveFunnelUnit({ steps: [], getFactTable })).toBeNull();
  });
});

describe("multi-fact-table funnels: buildable, not savable", () => {
  // A funnel builder exploration may draw each step from a different fact
  // table. Only funnel *fact metrics* are limited to one, so that rule must
  // never leak into builder-side validation.
  const tables: Record<string, FunnelRuleFactTable> = {
    ft_views: { id: "ft_views", datasource: "ds_1", userIdTypes: ["user_id"] },
    ft_orders: {
      id: "ft_orders",
      datasource: "ds_1",
      userIdTypes: ["user_id"],
    },
  };
  const getFactTable = (id: string) => tables[id];

  const multiTableSteps: FunnelStep[] = [
    {
      name: "Viewed",
      factTableId: "ft_views",
      rowFilters: [],
      optional: false,
    },
    {
      name: "Ordered",
      factTableId: "ft_orders",
      rowFilters: [],
      optional: false,
    },
  ];

  it("is valid to build", () => {
    expect(
      getFunnelBuilderViolations({
        steps: multiTableSteps,
        datasourceId: "ds_1",
        getFactTable,
      }),
    ).toEqual([]);
  });

  it("is blocked from being saved as a fact metric", () => {
    expect(
      getFunnelSaveBlockers({
        dataset: { steps: multiTableSteps },
        datasourceId: "ds_1",
        getFactTable,
      }),
    ).toEqual(["All funnel steps must come from the same fact table for now"]);
  });

  it("never surfaces a fact-metric-only rule to the builder", () => {
    // Guards the whole class, not just multi_fact_table: if a metric-only rule
    // is ever added without a scope, this fails.
    const metricOnly = getFunnelRuleViolations({
      steps: multiTableSteps,
      ordering: "unordered",
      sessionBased: true,
      datasourceId: "ds_1",
      getFactTable,
    }).filter((v) => v.scope === "fact_metric");

    expect(metricOnly.map((v) => v.code).sort()).toEqual([
      "multi_fact_table",
      "session_based",
      "unsupported_ordering",
    ]);
    expect(
      getFunnelBuilderViolations({
        steps: multiTableSteps,
        datasourceId: "ds_1",
        getFactTable,
      }),
    ).toEqual([]);
  });

  it("still reports genuinely broken multi-table funnels to the builder", () => {
    // Scoping must not make the builder permissive about real problems.
    const codes = getFunnelBuilderViolations({
      steps: [multiTableSteps[0], { ...multiTableSteps[1], factTableId: "" }],
      datasourceId: "ds_1",
      getFactTable,
    }).map((v) => v.code);
    expect(codes).toContain("missing_step_fact_table");
  });

  it("converts a multi-fact-table funnel faithfully if the limit is lifted", () => {
    // funnelDatasetToFunnelSettings must not silently collapse to one table.
    expect(
      funnelDatasetToFunnelSettings({ steps: multiTableSteps }).steps.map(
        (s) => s.factTableId,
      ),
    ).toEqual(["ft_views", "ft_orders"]);
  });

  it("derives a unit across differing fact tables", () => {
    expect(deriveFunnelUnit({ steps: multiTableSteps, getFactTable })).toBe(
      "user_id",
    );
  });
});

describe("step cap is unified across both surfaces", () => {
  const step = (i: number): FunnelStep => ({
    name: `Step ${i + 1}`,
    factTableId: "ft_events",
    rowFilters: [],
    optional: false,
  });

  it("the builder dataset schema rejects more steps than the cap", () => {
    const atCap = {
      type: "funnel" as const,
      unit: "user_id",
      steps: Array.from({ length: MAX_FUNNEL_STEPS }, (_, i) => step(i)),
    };
    expect(
      explorationConfigValidator.safeParse({
        type: "funnel",
        datasource: "ds_1",
        dimensions: [],
        chartType: "bar",
        dateRange: { predefined: "last7Days" },
        dataset: atCap,
      }).success,
    ).toBe(true);

    expect(
      explorationConfigValidator.safeParse({
        type: "funnel",
        datasource: "ds_1",
        dimensions: [],
        chartType: "bar",
        dateRange: { predefined: "last7Days" },
        dataset: { ...atCap, steps: [...atCap.steps, step(MAX_FUNNEL_STEPS)] },
      }).success,
    ).toBe(false);
  });

  it("the builder schema still allows a single step, unlike the metric schema", () => {
    // A funnel legitimately has one step while being built; only the metric
    // side requires two, enforced at submit by the run guard.
    expect(
      explorationConfigValidator.safeParse({
        type: "funnel",
        datasource: "ds_1",
        dimensions: [],
        chartType: "bar",
        dateRange: { predefined: "last7Days" },
        dataset: { type: "funnel", unit: null, steps: [step(0)] },
      }).success,
    ).toBe(true);
  });

  it("both surfaces read the same constant", () => {
    expect(
      funnelSettingsValidator.safeParse({
        steps: Array.from({ length: MAX_FUNNEL_STEPS }, (_, i) => step(i)),
      }).success,
    ).toBe(true);
    expect(
      funnelSettingsValidator.safeParse({
        steps: Array.from({ length: MAX_FUNNEL_STEPS + 1 }, (_, i) => step(i)),
      }).success,
    ).toBe(false);
  });
});
