import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ApiAutoRun } from "shared/validators";
import {
  EppoAllocation,
  EppoData,
  EppoExperiment,
  EppoFlag,
  EppoMetric,
  getCappingSettings,
  getImportedIds,
  getVariationValue,
  mergePhase,
  rulesToCondition,
  toEnvironmentId,
  toExperimentUpdate,
  toPhaseDate,
  TransformContext,
  updatedByLaterRuns,
  transformExperiment,
  transformFactSource,
  transformFlag,
  transformMetric,
  widenValues,
} from "@/services/importing/eppo/eppo-importing";

const EPPO: EppoData = {
  environments: [],
  tags: [],
  audiences: [
    {
      id: 7,
      name: "Beta users",
      description: "",
      targeting_rules: [
        {
          conditions: [
            { attribute: "beta", operator: "ONE_OF", values: ["true"] },
          ],
        },
      ],
    },
  ],
  flags: [],
  entities: [{ id: 1, name: "User" }],
  factSources: [
    {
      id: 10,
      name: "Purchases",
      sql: "SELECT * FROM purchases",
      timestamp_column: "created_at",
      entities: [{ id: 1, entity_join_column_name: "uid" }],
      dimensions: [{ id: 99, name: "Country", column: "country" }],
    },
  ],
  metrics: [],
  experiments: [],
};

const DATASOURCE = {
  id: "ds_1",
  settings: { userIdTypes: [{ userIdType: "user_id" }] },
} as DataSourceInterfaceWithParams;

function mkCtx(overrides: Partial<TransformContext> = {}): TransformContext {
  return {
    eppo: EPPO,
    project: "",
    datasource: DATASOURCE,
    environmentIds: new Set(["production", "test"]),
    savedGroupIds: new Map(),
    factTableIds: new Map([[10, "ftb_purchases"]]),
    metricIds: new Map(),
    experiments: new Map(),
    factTableColumns: new Map(),
    ...overrides,
  };
}

function mkAllocation(overrides: Partial<EppoAllocation>): EppoAllocation {
  return {
    id: 1,
    key: "alloc",
    name: "Allocation",
    type: "FEATURE_GATE",
    variation_weight: [{ variation_id: 1, weight: 100 }],
    targeting_rules: [],
    audiences: [],
    percent_exposure: 1,
    is_default: false,
    environment_id: 100,
    ...overrides,
  };
}

function mkFlag(allocations: EppoAllocation[]): EppoFlag {
  return {
    id: 1,
    key: "new-checkout",
    name: "new-checkout",
    description: "",
    variation_type: "BOOLEAN",
    tag_names: ["checkout"],
    environments: [
      { id: 100, name: "Production", active: true, is_production: true },
      { id: 101, name: "Test", active: false, is_production: false },
    ],
    variations: [
      { id: 1, name: "On", variant_key: "on" },
      { id: 2, name: "Off", variant_key: "off" },
    ],
    allocations,
  };
}

describe("rulesToCondition", () => {
  it("ORs rules and ANDs conditions", () => {
    expect(
      rulesToCondition([
        {
          conditions: [
            { attribute: "country", operator: "ONE_OF", values: ["US", "CA"] },
            { attribute: "age", operator: "GTE", values: ["18"] },
            { attribute: "appVersion", operator: "LT", values: ["2.1.0"] },
          ],
        },
        {
          conditions: [
            {
              attribute: "email",
              operator: "MATCHES",
              values: ["@acme\\.com$"],
            },
            { attribute: "plan", operator: "IS_NULL", values: ["false"] },
            { attribute: "tier", operator: "NOT_ONE_OF", values: ["free"] },
          ],
        },
      ]),
    ).toEqual({
      $or: [
        {
          country: { $in: ["US", "CA"] },
          age: { $gte: 18 },
          appVersion: { $vlt: "2.1.0" },
        },
        {
          email: { $regex: "@acme\\.com$" },
          plan: { $exists: true },
          tier: { $exists: true, $nin: ["free"] },
        },
      ],
    });
  });

  it("uses $and when an attribute repeats", () => {
    expect(
      rulesToCondition([
        {
          conditions: [
            { attribute: "age", operator: "GT", values: ["18"] },
            { attribute: "age", operator: "LT", values: ["65"] },
          ],
        },
      ]),
    ).toEqual({ $and: [{ age: { $gt: 18 } }, { age: { $lt: 65 } }] });
  });

  it("returns null without rules", () => {
    expect(rulesToCondition([])).toBeNull();
  });
});

describe("getVariationValue", () => {
  it("prefers a value when Eppo sends one", () => {
    expect(
      getVariationValue("json", {
        id: 1,
        name: "",
        variant_key: "a",
        value: { x: 1 },
      }),
    ).toBe('{"x":1}');
  });

  it("falls back to the variant key", () => {
    const v = (variant_key: string) => ({ id: 1, name: "", variant_key });
    expect(getVariationValue("boolean", v("on"))).toBe("true");
    expect(getVariationValue("boolean", v("off"))).toBe("false");
    expect(getVariationValue("number", v("3.5"))).toBe("3.5");
    expect(getVariationValue("string", v("blue"))).toBe("blue");
    expect(getVariationValue("json", v('{"a":1}'))).toBe('{"a":1}');
  });

  // Guessing "0" or "false" for every variation would import cleanly and
  // serve the wrong value, so a key that isn't a value of the type is an error
  it("rejects keys that aren't values of the flag's type", () => {
    const v = (variant_key: string) => ({ id: 1, name: "", variant_key });
    expect(() => getVariationValue("number", v("control"))).toThrow(
      'Variation "control" isn\'t a number',
    );
    expect(() => getVariationValue("boolean", v("enabled"))).toThrow(
      "isn't true or false",
    );
    expect(() => getVariationValue("json", v("control"))).toThrow("isn't JSON");
  });
});

describe("widenValues", () => {
  // Eppo casts attributes to strings before ONE_OF; the SDK compares strictly
  it("lists number and boolean forms alongside the string", () => {
    expect(widenValues(["2", "3"])).toEqual(["2", 2, "3", 3]);
    expect(widenValues(["true"])).toEqual(["true", true]);
    expect(widenValues(["US"])).toEqual(["US"]);
  });
});

describe("toEnvironmentId", () => {
  it("lowercases and slugifies", () => {
    expect(toEnvironmentId(" Production ")).toBe("production");
    expect(toEnvironmentId("Staging (EU)")).toBe("staging-eu");
  });
});

describe("transformFlag", () => {
  it("maps allocations to environment-scoped rules", () => {
    const feature = transformFlag(
      mkFlag([
        mkAllocation({
          id: 1,
          name: "Internal",
          targeting_rules: [
            {
              conditions: [
                { attribute: "email", operator: "MATCHES", values: ["@acme"] },
              ],
            },
          ],
        }),
        mkAllocation({
          id: 2,
          key: "checkout-test",
          name: "Experiment",
          type: "EXPERIMENT",
          percent_exposure: 0.5,
          variation_weight: [
            { variation_id: 1, weight: 1 },
            { variation_id: 2, weight: 3 },
          ],
        }),
        mkAllocation({ id: 3, name: "Rollout", percent_exposure: 0.2 }),
        // Only the default allocation is redundant with defaultValue
        mkAllocation({
          id: 4,
          name: "Default",
          is_default: true,
          variation_weight: [{ variation_id: 2, weight: 100 }],
        }),
        mkAllocation({ id: 5, archived_at: "2024-01-01", environment_id: 101 }),
        mkAllocation({ id: 6, name: "Test default", environment_id: 101 }),
        mkAllocation({ id: 7, name: "Everywhere", environment_id: undefined }),
      ]),
      mkCtx({ project: "prj_1" }),
    );

    expect(feature).toMatchObject({
      id: "new-checkout",
      valueType: "boolean",
      defaultValue: "false",
      project: "prj_1",
      tags: ["checkout"],
    });
    expect(feature.environmentSettings).toEqual({
      production: { enabled: true },
      test: { enabled: false },
    });
    expect(feature.rules).toEqual([
      expect.objectContaining({
        id: "fr_eppo_1",
        type: "force",
        value: "true",
        condition: JSON.stringify({ email: { $regex: "@acme" } }),
        environments: ["production"],
      }),
      expect.objectContaining({
        id: "fr_eppo_2",
        type: "experiment",
        trackingKey: "new-checkout-checkout-test",
        hashAttribute: "id",
        coverage: 0.5,
        values: [
          { value: "true", weight: 0.25, name: "On" },
          { value: "false", weight: 0.75, name: "Off" },
        ],
      }),
      expect.objectContaining({
        id: "fr_eppo_3",
        type: "rollout",
        value: "true",
        coverage: 0.2,
      }),
      expect.objectContaining({
        id: "fr_eppo_6",
        type: "force",
        environments: ["test"],
      }),
      expect.objectContaining({
        id: "fr_eppo_7",
        environments: ["production", "test"],
      }),
    ]);
  });

  it("references imported audiences and inlines the rest", () => {
    const flag = mkFlag([
      mkAllocation({ audiences: [{ audience_id: 7, type: "IS_IN" }] }),
    ]);

    const [linked] = transformFlag(
      flag,
      mkCtx({ savedGroupIds: new Map([[7, "grp_beta"]]) }),
    ).rules;
    expect(linked).toMatchObject({
      condition: "",
      savedGroups: [{ match: "any", ids: ["grp_beta"] }],
    });

    const [inlined] = transformFlag(flag, mkCtx()).rules;
    expect(inlined).toMatchObject({
      condition: JSON.stringify({ beta: { $in: ["true", true] } }),
      savedGroups: [],
    });
  });

  it("ORs targeting rules with excluded audiences", () => {
    const [rule] = transformFlag(
      mkFlag([
        mkAllocation({
          targeting_rules: [
            {
              conditions: [
                { attribute: "id", operator: "ONE_OF", values: ["123"] },
              ],
            },
          ],
          audiences: [{ audience_id: 7, type: "IS_NOT_IN" }],
        }),
      ]),
      mkCtx({ savedGroupIds: new Map([[7, "grp_beta"]]) }),
    ).rules;
    expect(JSON.parse(rule.condition || "")).toEqual({
      $or: [
        { id: { $in: ["123", 123] } },
        { $not: { beta: { $in: ["true", true] } } },
      ],
    });
  });

  it("rejects switchback allocations", () => {
    expect(() =>
      transformFlag(mkFlag([mkAllocation({ type: "SWITCHBACK" })]), mkCtx()),
    ).toThrow("Switchback");
  });

  // Eppo evaluates allocations top-down, so a rule-less 100% allocation above
  // others shadows them even when it serves the default value
  it("keeps a non-default catch-all that serves the default value", () => {
    const { rules } = transformFlag(
      mkFlag([
        mkAllocation({
          id: 1,
          name: "Kill switch",
          variation_weight: [{ variation_id: 2, weight: 100 }],
        }),
        mkAllocation({
          id: 2,
          targeting_rules: [
            {
              conditions: [
                { attribute: "email", operator: "MATCHES", values: ["@acme"] },
              ],
            },
          ],
        }),
        mkAllocation({
          id: 3,
          is_default: true,
          variation_weight: [{ variation_id: 2, weight: 100 }],
        }),
      ]),
      mkCtx(),
    );
    expect(rules.map((r) => r.id)).toEqual(["fr_eppo_1", "fr_eppo_2"]);
    expect(rules[0]).toMatchObject({ type: "force", value: "false" });
  });

  it("links experiment allocations to imported experiments", () => {
    const flag = mkFlag([
      mkAllocation({
        id: 2,
        type: "EXPERIMENT",
        variation_weight: [
          { variation_id: 1, weight: 1 },
          { variation_id: 2, weight: 1 },
        ],
        experiment: { id: 5, name: "Checkout test", status: "RUNNING" },
      }),
    ]);
    const [rule] = transformFlag(
      flag,
      mkCtx({
        experiments: new Map([
          [
            5,
            {
              id: "exp_1",
              variations: [
                { id: "var_a", key: "off" },
                { id: "var_b", key: "on" },
              ],
            },
          ],
        ]),
      }),
    ).rules;
    expect(rule).toMatchObject({
      type: "experiment-ref",
      experimentId: "exp_1",
      variations: [
        { variationId: "var_a", value: "false" },
        { variationId: "var_b", value: "true" },
      ],
    });

    // Without the experiment (not imported), fall back to an inline rule
    expect(transformFlag(flag, mkCtx()).rules[0]).toMatchObject({
      type: "experiment",
    });
  });

  it("only references environments the org will have", () => {
    const feature = transformFlag(
      mkFlag([mkAllocation({ id: 1, environment_id: undefined })]),
      mkCtx({ environmentIds: new Set(["production"]) }),
    );
    expect(feature.environmentSettings).toEqual({
      production: { enabled: true },
    });
    expect(feature.rules[0]).toMatchObject({ environments: ["production"] });
  });

  it("rejects variations that would share a value", () => {
    const flag = mkFlag([]);
    flag.variation_type = "INTEGER";
    flag.variations = [
      { id: 1, name: "A", variant_key: "control" },
      { id: 2, name: "B", variant_key: "treatment" },
    ];
    expect(() => transformFlag(flag, mkCtx())).toThrow("isn't a number");
    flag.variations = [
      { id: 1, name: "A", variant_key: "1" },
      { id: 2, name: "B", variant_key: "1.0" },
    ];
    expect(() => transformFlag(flag, mkCtx())).toThrow("same value");
  });
});

describe("transformFactSource", () => {
  it("maps entities to identifier types", () => {
    expect(transformFactSource(EPPO.factSources[0], mkCtx())).toMatchObject({
      datasource: "ds_1",
      sql: "SELECT * FROM purchases",
      userIdTypes: ["user_id"],
      userIdColumns: { user_id: "uid" },
      timestampColumn: "created_at",
    });
  });

  it("requires a matching identifier type", () => {
    expect(() =>
      transformFactSource(
        EPPO.factSources[0],
        mkCtx({
          datasource: {
            ...DATASOURCE,
            settings: { userIdTypes: [{ userIdType: "device_id" }] },
          } as DataSourceInterfaceWithParams,
        }),
      ),
    ).toThrow('Eppo entity "User"');
  });
});

describe("transformMetric", () => {
  const agg = (operation: string, extra = {}) => ({
    metric_event_source_id: 10,
    operation,
    column: "revenue",
    ...extra,
  });
  const mkMetric = (overrides: Partial<EppoMetric>): EppoMetric => ({
    id: 1,
    name: "Metric",
    description: "",
    desired_change: "increase",
    ...overrides,
  });

  it("maps a filtered, capped sum", () => {
    expect(
      transformMetric(
        mkMetric({
          desired_change: "decrease",
          numerator_aggregation: agg("sum", {
            winsor_upper_percentile: 0.99,
            aggregation_timeframe_unit: "days",
            aggregation_timeframe_start_value: 1,
            aggregation_timeframe_end_value: 8,
            filters: [
              {
                metric_event_dimension_id: 99,
                operation: "DOES_NOT_EQUAL",
                values: ["CA"],
              },
            ],
          }),
        }),
        mkCtx(),
      ),
    ).toMatchObject({
      metricType: "mean",
      inverse: true,
      numerator: {
        factTableId: "ftb_purchases",
        column: "revenue",
        aggregation: "sum",
        rowFilters: [{ column: "country", operator: "not_in", values: ["CA"] }],
      },
      cappingSettings: { type: "percentile", value: 0.99 },
      windowSettings: {
        type: "conversion",
        delayValue: 1,
        delayUnit: "days",
        windowValue: 7,
        windowUnit: "days",
      },
    });
  });

  it("maps conversions, ratios and percentiles", () => {
    expect(
      transformMetric(
        mkMetric({
          numerator_aggregation: agg("conversion", {
            conversion_threshold_days: 3,
          }),
        }),
        mkCtx(),
      ),
    ).toMatchObject({
      metricType: "proportion",
      numerator: {
        column: "$$distinctUsers",
        rowFilters: [],
      },
      windowSettings: { type: "conversion", windowValue: 3 },
    });

    expect(
      transformMetric(
        mkMetric({
          numerator_aggregation: agg("sum"),
          denominator_aggregation: agg("count"),
        }),
        mkCtx(),
      ),
    ).toMatchObject({
      metricType: "ratio",
      numerator: { column: "revenue", rowFilters: [] },
      denominator: {
        column: "$$count",
        rowFilters: [],
      },
    });

    expect(
      transformMetric(
        mkMetric({
          percentile: {
            metric_event_source_id: 10,
            column: "latency",
            percentile_value: 0.95,
          },
        }),
        mkCtx(),
      ),
    ).toMatchObject({
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.95 },
    });
  });

  it("maps thresholds to an aggregate filter", () => {
    const threshold = (settings: object) =>
      transformMetric(
        mkMetric({
          numerator_aggregation: agg("threshold", {
            threshold_metric_settings: {
              comparison_operator: "gt",
              aggregation_type: "sum",
              breach_value: 100,
              timeframe_value: 7,
              timeframe_dimension: "days",
              ...settings,
            },
          }),
        }),
        mkCtx(),
      );

    expect(threshold({})).toMatchObject({
      metricType: "proportion",
      numerator: {
        column: "$$distinctUsers",
        aggregateFilterColumn: "revenue",
        aggregateFilter: "> 100",
        rowFilters: [],
      },
      windowSettings: {
        type: "conversion",
        windowValue: 7,
        windowUnit: "days",
      },
    });
    expect(
      threshold({ aggregation_type: "count", comparison_operator: "lte" }),
    ).toMatchObject({
      numerator: {
        aggregateFilterColumn: "$$count",
        aggregateFilter: "<= 100",
      },
    });
    expect(() => threshold({ breach_value: -1 })).toThrow("threshold");
  });

  it("maps funnels", () => {
    const funnel = (extra: object) =>
      transformMetric(
        mkMetric({
          funnel_aggregation: {
            funnel_steps: [
              {
                metric_event_source_id: 10,
                measure_name: "View",
              },
              {
                metric_event_source_id: 10,
                measure_name: "Buy",
              },
            ],
            conversion_time_from: "experimentAssignment",
            conversion_time_seconds: 2 * 86400,
            order: "thisOrder",
            ...extra,
          },
        }),
        mkCtx(),
      );

    expect(funnel({})).toMatchObject({
      metricType: "funnel",
      numerator: null,
      funnelSettings: {
        ordering: "sequential",
        steps: [
          {
            name: "View",
            factTableId: "ftb_purchases",
            rowFilters: [],
            optional: false,
          },
          { name: "Buy", factTableId: "ftb_purchases" },
        ],
      },
      windowSettings: {
        type: "conversion",
        windowValue: 2,
        windowUnit: "days",
      },
    });

    const fromFirstEvent = funnel({
      conversion_time_from: "firstEvent",
      conversion_time_seconds: 5400,
    });
    expect(fromFirstEvent.windowSettings.type).toBe("");
    expect(fromFirstEvent.funnelSettings?.steps[1].conversionWindow).toEqual({
      value: 90,
      unit: "minutes",
    });
  });

  it("requires a value column the Fact Table has", () => {
    const ctx = mkCtx({
      factTableColumns: new Map([["ftb_purchases", ["REVENUE", "uid"]]]),
    });
    const sum = (column: string | null) =>
      transformMetric(
        mkMetric({ numerator_aggregation: agg("sum", { column }) }),
        ctx,
      );

    // Warehouses fold column names differently; the Fact Table's spelling is
    // the one the metric endpoints look up
    expect(sum("revenue").numerator).toMatchObject({ column: "REVENUE" });
    expect(() => sum("__count__")).toThrow(
      'Column "__count__" isn\'t in the "Purchases" Fact Table',
    );
    expect(() => sum(null)).toThrow("needs a value column");
    expect(() => sum("")).toThrow("needs a value column");
    expect(() =>
      transformMetric(
        mkMetric({
          percentile: {
            metric_event_source_id: 10,
            column: "latency",
            percentile_value: 0.5,
          },
        }),
        ctx,
      ),
    ).toThrow('Column "latency"');
    expect(() =>
      transformMetric(
        mkMetric({
          numerator_aggregation: agg("threshold", {
            column: "__count__",
            threshold_metric_settings: {
              comparison_operator: "gt",
              aggregation_type: "sum",
              breach_value: 1,
              timeframe_value: null,
              timeframe_dimension: null,
            },
          }),
        }),
        ctx,
      ),
    ).toThrow('Column "__count__"');

    // Counts don't read the column
    expect(
      transformMetric(
        mkMetric({ numerator_aggregation: agg("count", { column: null }) }),
        ctx,
      ).numerator,
    ).toMatchObject({ column: "$$count" });
    // Columns aren't known until the Fact Table exists, or detection has run
    expect(
      transformMetric(
        mkMetric({ numerator_aggregation: agg("sum", { column: "anything" }) }),
        mkCtx(),
      ).numerator,
    ).toMatchObject({ column: "anything" });
    expect(
      transformMetric(
        mkMetric({ numerator_aggregation: agg("sum", { column: "anything" }) }),
        mkCtx({ factTableColumns: new Map([["ftb_purchases", []]]) }),
      ).numerator,
    ).toMatchObject({ column: "anything" });
  });

  it("maps both winsorization tails", () => {
    expect(
      getCappingSettings({
        metric_event_source_id: 10,
        operation: "sum",
        column: "revenue",
        winsor_upper_percentile: 0.999,
        winsor_lower_fixed_value: 0,
        winsor_basis_filter: "positiveOnly",
      }),
    ).toEqual({
      cappingSettings: { type: "percentile", value: 0.999, ignoreZeros: true },
      lowerCappingSettings: { type: "absolute", value: 0 },
    });
  });

  it("rejects unsupported metrics and missing fact tables", () => {
    expect(() =>
      transformMetric(
        mkMetric({ numerator_aggregation: agg("timeTo") }),
        mkCtx(),
      ),
    ).toThrow("timeTo");
    expect(() =>
      transformMetric(
        mkMetric({ numerator_aggregation: agg("sum") }),
        mkCtx({ factTableIds: new Map() }),
      ),
    ).toThrow('"Purchases" fact source');
  });
});

describe("transformExperiment", () => {
  const experiment: EppoExperiment = {
    id: 5,
    name: "Checkout test",
    status: "COMPLETED",
    experiment_key: "new-checkout-checkout-test",
    assignments_start_date: "2024-01-01T00:00:00Z",
    assignments_end_date: "2024-02-01T00:00:00Z",
    traffic_allocation: 0.5,
    outcome: "POSITIVE",
    winning_variant_key: "on",
    metrics: [
      { metric_id: 1, is_primary: true },
      { metric_id: 2, is_primary: false, is_guardrail: true },
      { metric_id: 3, is_primary: false },
    ],
    variations: [
      {
        name: "On",
        variant_key: "on",
        is_control: false,
        weighted_expected_traffic: 3,
        is_active: true,
        variation_id: 11,
      },
      {
        name: "Off",
        variant_key: "off",
        is_control: true,
        weighted_expected_traffic: 1,
        is_active: true,
        variation_id: 12,
      },
    ],
  };

  it("puts the control first and maps results", () => {
    const result = transformExperiment(
      experiment,
      mkCtx({
        metricIds: new Map([
          [1, "fact_1"],
          [2, "fact_2"],
        ]),
      }),
    );
    expect(result).toMatchObject({
      trackingKey: "new-checkout-checkout-test",
      status: "stopped",
      datasource: "ds_1",
      variations: [
        { id: "var_eppo_12", key: "off" },
        { id: "var_eppo_11", key: "on" },
      ],
      goalMetrics: ["fact_1"],
      guardrailMetrics: ["fact_2"],
      secondaryMetrics: [],
      results: "won",
      winner: 1,
    });
    expect(result.phases?.[0]).toMatchObject({
      coverage: 0.5,
      variationWeights: [0.25, 0.75],
      dateEnded: "2024-02-01T00:00:00Z",
    });
    // Org analysis defaults apply unless Eppo has an explicit plan
    expect(result).not.toHaveProperty("statsEngine");
    expect(
      transformExperiment(
        {
          ...experiment,
          analysis_plan: { confidence_interval_method: "Sequential" },
        },
        mkCtx(),
      ),
    ).toMatchObject({
      statsEngine: "frequentist",
      sequentialTestingEnabled: true,
      regressionAdjustmentEnabled: false,
    });
  });

  it("leaves metric fields alone without a Data Source", () => {
    const result = transformExperiment(experiment, mkCtx({ datasource: null }));
    expect(result).not.toHaveProperty("datasource");
    expect(result).not.toHaveProperty("goalMetrics");
  });

  it("keeps the ids of an experiment being updated", () => {
    const result = transformExperiment(experiment, mkCtx(), {
      id: "exp_1",
      variations: [
        { id: "var_a", key: "off" },
        { id: "var_b", key: "on" },
      ],
    });
    expect(result.variations?.map((v) => v.id)).toEqual(["var_a", "var_b"]);
    expect(result.phases?.[0].variations.map((v) => v.id)).toEqual([
      "var_a",
      "var_b",
    ]);
  });

  it("rejects experiments GrowthBook can't model", () => {
    expect(() =>
      transformExperiment(
        { ...experiment, computation_type: "SWITCHBACK" },
        mkCtx(),
      ),
    ).toThrow("SWITCHBACK");
    expect(() =>
      transformExperiment(
        { ...experiment, is_holdout_analysis: true },
        mkCtx(),
      ),
    ).toThrow("Holdout");
  });

  it("limits updates to what Eppo owns", () => {
    const transformed = transformExperiment(experiment, mkCtx());
    const running = toExperimentUpdate(transformed, true);
    expect(Object.keys(running.update).sort()).toEqual([
      "analysis",
      "hypothesis",
      "name",
    ]);
    expect(running.phase).toBeUndefined();

    const stopped = toExperimentUpdate(transformed, false);
    expect(stopped.update).not.toHaveProperty("tags");
    expect(stopped.update).not.toHaveProperty("project");
    expect(stopped.update).not.toHaveProperty("trackingKey");
    expect(stopped.phase).toBeDefined();
  });

  it("lays Eppo's phase over the existing one", () => {
    const existing = {
      name: "Phase 1",
      dateStarted: "2023-12-01T00:00:00Z",
      dateEnded: "",
      reason: "",
      coverage: 1,
      condition: '{"country":"US"}',
      savedGroups: [{ match: "any" as const, ids: ["grp_1"] }],
      prerequisites: [],
      variationWeights: [0.5, 0.5],
      variations: [],
    };
    const incoming = transformExperiment(experiment, mkCtx()).phases?.[0];
    if (!incoming) throw new Error("no phase");
    expect(mergePhase(existing, incoming)).toMatchObject({
      name: "Phase 1",
      condition: '{"country":"US"}',
      savedGroups: [{ match: "any", ids: ["grp_1"] }],
      coverage: 0.5,
      variationWeights: [0.25, 0.75],
      dateStarted: "2024-01-01T00:00",
      dateEnded: "2024-02-01T00:00",
    });
    // Dates GrowthBook has and Eppo lacks survive
    expect(
      mergePhase(existing, {
        ...incoming,
        dateStarted: "",
        dateEnded: "",
      }),
    ).toMatchObject({ dateStarted: "2023-12-01T00:00", dateEnded: "" });
  });
});

describe("getImportedIds", () => {
  const run = (
    dateCreated: string,
    artifacts: Partial<ApiAutoRun["artifacts"][number]>[],
  ): ApiAutoRun =>
    ({
      id: `arun_${dateCreated}`,
      source: "eppo-import",
      dateCreated,
      artifacts: artifacts.map((a) => ({
        kind: "metric",
        id: "",
        label: "",
        by: "growthbook",
        detail: null,
        dateCreated,
        ...a,
      })),
    }) as ApiAutoRun;

  it("maps Eppo ids to what later runs created, if it still exists", () => {
    const ids = getImportedIds(
      [
        run("2024-02-01", [
          { kind: "metric", id: "fact__new", externalId: "metrics:1" },
        ]),
        run("2024-01-01", [
          { kind: "metric", id: "fact__old", externalId: "metrics:1" },
          { kind: "saved-group", id: "grp_gone", externalId: "audiences:7" },
          { kind: "feature", id: "flag-a", externalId: "flags:3" },
          { kind: "attribute", id: "country" },
        ]),
        {
          ...run("2024-03-01", [{ id: "x", externalId: "metrics:2" }]),
          source: "cli-wizard",
        },
      ],
      (kind, id) => id !== "grp_gone",
    );
    expect(ids.metrics).toEqual(new Map([[1, "fact__new"]]));
    expect(ids.audiences.size).toBe(0);
    expect(ids.flags).toEqual(new Map([[3, "flag-a"]]));
  });
});

describe("updatedByLaterRuns", () => {
  const run = (
    dateCreated: string,
    artifacts: Partial<ApiAutoRun["artifacts"][number]>[],
  ): ApiAutoRun =>
    ({
      id: `arun_${dateCreated}`,
      source: "eppo-import",
      dateCreated,
      artifacts: artifacts.map((a) => ({
        kind: "feature",
        id: "",
        label: "",
        by: "growthbook",
        detail: null,
        dateCreated,
        ...a,
      })),
    }) as ApiAutoRun;

  it("lists what this run created that a later import updated", () => {
    const target = run("2024-02-01", [
      { id: "flag-a", action: "created" },
      { id: "flag-b", action: "created" },
      { kind: "saved-group", id: "grp_1", detail: "Created from Eppo" },
      { id: "flag-c", action: "updated" },
    ]);
    const updated = updatedByLaterRuns(target, [
      target,
      run("2024-03-01", [
        { id: "flag-a", action: "updated" },
        { id: "flag-c", action: "updated" },
        { kind: "saved-group", id: "grp_1", detail: "Updated from Eppo" },
      ]),
      run("2024-01-01", [{ id: "flag-b", action: "updated" }]),
      {
        ...run("2024-04-01", [{ id: "flag-b", action: "updated" }]),
        source: "cli-wizard",
      },
    ]);
    expect(updated.map((a) => a.id)).toEqual(["flag-a", "grp_1"]);
  });
});

describe("toPhaseDate", () => {
  it("formats UTC dates for the phase endpoint", () => {
    expect(toPhaseDate("2024-02-01T00:00:00Z")).toBe("2024-02-01T00:00");
    expect(toPhaseDate("2024-02-01T02:30:00+02:00")).toBe("2024-02-01T00:30");
    expect(toPhaseDate(undefined)).toBe("");
  });
});
