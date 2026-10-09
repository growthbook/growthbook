import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  EppoAllocation,
  EppoData,
  EppoExperiment,
  EppoFlag,
  EppoMetric,
  getVariationValue,
  rulesToCondition,
  toEnvironmentId,
  toPhaseDate,
  TransformContext,
  transformExperiment,
  transformFactSource,
  transformFlag,
  transformMetric,
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
    savedGroupIds: new Map(),
    factTableIds: new Map([[10, "ftb_purchases"]]),
    metricIds: new Map(),
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
          tier: { $nin: ["free"] },
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
    expect(getVariationValue("json", v("control"))).toBe('"control"');
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
        // Catch-all matching the default value is dropped
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
      condition: JSON.stringify({ beta: { $in: ["true"] } }),
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
      $or: [{ id: { $in: ["123"] } }, { $not: { beta: { $in: ["true"] } } }],
    });
  });

  it("rejects switchback allocations", () => {
    expect(() =>
      transformFlag(mkFlag([mkAllocation({ type: "SWITCHBACK" })]), mkCtx()),
    ).toThrow("Switchback");
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

    // Warehouses fold column names differently
    expect(sum("revenue").numerator).toMatchObject({ column: "revenue" });
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
    // Columns aren't known until the Fact Table exists
    expect(
      transformMetric(
        mkMetric({ numerator_aggregation: agg("sum", { column: "anything" }) }),
        mkCtx(),
      ).numerator,
    ).toMatchObject({ column: "anything" });
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
  });
});

describe("toPhaseDate", () => {
  it("formats UTC dates for the phase endpoint", () => {
    expect(toPhaseDate("2024-02-01T00:00:00Z")).toBe("2024-02-01T00:00");
    expect(toPhaseDate("2024-02-01T02:30:00+02:00")).toBe("2024-02-01T00:30");
    expect(toPhaseDate(undefined)).toBe("");
  });
});
