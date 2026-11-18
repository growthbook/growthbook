import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FactMetricInterface } from "shared/types/fact-table";
import { ApiAutoRun } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import {
  EppoAllocation,
  EppoData,
  EppoExperiment,
  fetchEppoData,
  importableFlags,
  matchItems,
  buildImportData,
  EppoFlag,
  EppoMetric,
  getCappingSettings,
  getImportedIds,
  getVariationValue,
  runEppoImport,
  EppoImportData,
  ExistingIds,
  teardownRun,
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
  ApiCall,
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
          age: { $exists: true, $gte: 18 },
          appVersion: { $exists: true, $vlt: "2.1.0" },
        },
        {
          email: { $exists: true, $regex: "@acme\\.com$" },
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
    ).toEqual({
      $and: [
        { age: { $exists: true, $gt: 18 } },
        { age: { $exists: true, $lt: 65 } },
      ],
    });
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
  it("lists number and boolean forms alongside the string", () => {
    expect(widenValues(["2", "3"])).toEqual(["2", 2, "3", 3]);
    expect(widenValues(["true"])).toEqual(["true", true]);
    expect(widenValues(["US"])).toEqual(["US"]);
    expect(widenValues(["001"])).toEqual(["001"]);
    expect(widenValues([" 2", "1.0", " true"])).toEqual([" 2", "1.0", " true"]);
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
        condition: JSON.stringify({
          email: { $exists: true, $regex: "@acme" },
        }),
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

  // Eppo's docs don't say how an excluded audience combines with the rest
  it("rejects allocations that exclude an audience", () => {
    expect(() =>
      transformFlag(
        mkFlag([
          mkAllocation({ audiences: [{ audience_id: 7, type: "IS_NOT_IN" }] }),
        ]),
        mkCtx({ savedGroupIds: new Map([[7, "grp_beta"]]) }),
      ),
    ).toThrow("exclude an audience");
  });

  it("rejects switchback allocations", () => {
    expect(() =>
      transformFlag(mkFlag([mkAllocation({ type: "SWITCHBACK" })]), mkCtx()),
    ).toThrow("Switchback");
  });

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

  // A date filter can leave out an experiment an earlier run imported; the
  // flag keeps pointing at it rather than falling back to an inline rule
  it("keeps links to experiments this fetch left out", () => {
    const flag = mkFlag([
      mkAllocation({
        id: 2,
        type: "EXPERIMENT",
        variation_weight: [
          { variation_id: 1, weight: 1 },
          { variation_id: 2, weight: 1 },
        ],
        experiment: { id: 77, name: "Older test", status: "RUNNING" },
      }),
    ]);
    const eppo = { ...EPPO, flags: [flag], experiments: [] };
    const existing: ExistingIds = {
      environments: new Set(["production", "test"]),
      tags: new Set(),
      imported: {
        audiences: new Map(),
        factSources: new Map(),
        metrics: new Map(),
        experiments: new Map([[77, "exp_older"]]),
        flags: new Map(),
      },
      savedGroups: new Map(),
      features: new Set(),
      factTables: new Map(),
      factMetrics: new Map(),
      experiments: new Map(),
      experimentRefs: new Map([
        [
          "exp_older",
          {
            status: "running",
            variations: [
              { id: "var_a", key: "off" },
              { id: "var_b", key: "on" },
            ],
            phase: {
              condition: "",
              savedGroups: [],
              coverage: 1,
              variationWeights: [0.5, 0.5],
            },
          },
        ],
      ]),
      factTableColumns: new Map(),
    };
    const data = buildImportData(
      eppo,
      existing,
      matchItems(eppo, existing),
      "",
      DATASOURCE,
      () => true,
    );
    expect(
      (data.flags[0].preview as { rules: { type: string }[] }).rules[0],
    ).toMatchObject({ type: "experiment-ref", experimentId: "exp_older" });
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
        eppo: { ...EPPO, flags: [flag] },
        experiments: new Map([
          [
            5,
            {
              id: "exp_1",
              status: "running",
              variations: [
                { id: "var_a", key: "off" },
                { id: "var_b", key: "on" },
              ],
              phase: {
                condition: "",
                savedGroups: [],
                coverage: 1,
                variationWeights: [0.5, 0.5],
              },
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

    expect(transformFlag(flag, mkCtx()).rules[0]).toMatchObject({
      type: "experiment",
    });
  });

  it("links a targeted allocation only when the phase targets the same users", () => {
    const flag = mkFlag([
      mkAllocation({
        id: 2,
        type: "EXPERIMENT",
        percent_exposure: 0.5,
        targeting_rules: [
          {
            conditions: [
              { attribute: "country", operator: "ONE_OF", values: ["US"] },
            ],
          },
        ],
        variation_weight: [
          { variation_id: 1, weight: 1 },
          { variation_id: 2, weight: 1 },
        ],
        experiment: { id: 5, name: "Checkout test", status: "RUNNING" },
      }),
    ]);
    const eppo = {
      ...EPPO,
      flags: [flag],
      experiments: [
        {
          id: 5,
          name: "Checkout test",
          status: "RUNNING",
          variations: [
            {
              variation_id: 1,
              variant_key: "on",
              name: "On",
              is_control: true,
              is_active: true,
            },
            {
              variation_id: 2,
              variant_key: "off",
              name: "Off",
              is_control: false,
              is_active: true,
            },
          ],
        } as EppoExperiment,
      ],
    };
    const targeting = {
      condition: JSON.stringify({ country: { $in: ["US"] } }),
      savedGroups: [],
      coverage: 0.5,
    };
    expect(
      transformExperiment(eppo.experiments[0], mkCtx({ eppo })).phases?.[0],
    ).toMatchObject(targeting);

    const variations = [
      { id: "var_a", key: "off" },
      { id: "var_b", key: "on" },
    ];
    const ruleFor = (
      phase?: typeof targeting & { variationWeights?: number[] },
      status: "running" | "stopped" = "running",
    ) =>
      transformFlag(
        flag,
        mkCtx({
          eppo,
          experiments: new Map([
            [5, { id: "exp_1", status, variations, phase }],
          ]),
        }),
      ).rules[0];
    const live = { ...targeting, variationWeights: [0.5, 0.5] };
    expect(ruleFor(live)).toMatchObject({ type: "experiment-ref" });
    expect(ruleFor()).toMatchObject({ type: "experiment" });
    expect(ruleFor(live, "stopped")).toMatchObject({ type: "experiment" });
    expect(
      ruleFor({ ...targeting, variationWeights: [0.9, 0.1] }),
    ).toMatchObject({ type: "experiment" });
    expect(
      ruleFor({ condition: "", savedGroups: [], coverage: 1 }),
    ).toMatchObject({
      type: "experiment",
      coverage: 0.5,
      condition: targeting.condition,
    });
  });

  it("keeps a default allocation that splits traffic as an experiment rule", () => {
    const feature = transformFlag(
      mkFlag([
        mkAllocation({
          id: 1,
          key: "holdback",
          type: "EXPERIMENT",
          is_default: true,
          variation_weight: [
            { variation_id: 1, weight: 50 },
            { variation_id: 2, weight: 50 },
          ],
        }),
      ]),
      mkCtx(),
    );
    expect(feature.defaultValue).toBe("false");
    expect(feature.rules).toEqual([
      expect.objectContaining({
        id: "fr_eppo_1",
        type: "experiment",
        trackingKey: "new-checkout-holdback",
      }),
    ]);
  });

  it("keeps another environment's default where it serves something else", () => {
    const feature = transformFlag(
      mkFlag([
        mkAllocation({
          id: 1,
          is_default: true,
          variation_weight: [{ variation_id: 2, weight: 100 }],
        }),
        mkAllocation({ id: 2, is_default: true, environment_id: 101 }),
      ]),
      mkCtx(),
    );
    expect(feature.defaultValue).toBe("false");
    expect(feature.rules).toEqual([
      expect.objectContaining({
        id: "fr_eppo_2",
        type: "force",
        value: "true",
        environments: ["test"],
      }),
    ]);
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

    expect(sum("revenue").numerator).toMatchObject({ column: "REVENUE" });
    expect(
      transformMetric(
        mkMetric({ numerator_aggregation: agg("sum", { column: "revenue" }) }),
        mkCtx({
          factTableColumns: new Map([
            ["ftb_purchases", ["REVENUE", "revenue"]],
          ]),
        }),
      ).numerator,
    ).toMatchObject({ column: "revenue" });
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

    expect(
      transformMetric(
        mkMetric({ numerator_aggregation: agg("count", { column: null }) }),
        ctx,
      ).numerator,
    ).toMatchObject({ column: "$$count" });
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

  it("keeps a READY experiment running until its end date passes", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(
      transformExperiment(
        { ...experiment, status: "READY", assignments_end_date: future },
        mkCtx(),
      ).status,
    ).toBe("running");
    expect(
      transformExperiment(
        { ...experiment, status: "READY", assignments_end_date: undefined },
        mkCtx(),
      ).status,
    ).toBe("running");
    expect(
      transformExperiment({ ...experiment, status: "READY" }, mkCtx()).status,
    ).toBe("stopped");
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

  it("forgets what a teardown deleted so the next import creates it", () => {
    const ids = getImportedIds(
      [
        run("2024-01-01", [
          { kind: "feature", id: "flag-a", externalId: "flags:3" },
          { kind: "feature", id: "flag-b", externalId: "flags:4" },
        ]),
        run("2024-01-02", [
          {
            kind: "feature",
            id: "flag-a",
            externalId: "flags:3",
            action: "deleted",
          },
          {
            kind: "feature",
            id: "flag-b",
            externalId: "flags:4",
            action: "failed",
          },
        ]),
      ],
      () => true,
    );
    expect(ids.flags).toEqual(new Map([[4, "flag-b"]]));
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

describe("teardownRun", () => {
  const artifact = (
    kind: ApiAutoRun["artifacts"][number]["kind"],
    id: string,
  ): ApiAutoRun["artifacts"][number] => ({
    kind,
    id,
    label: id,
    by: "growthbook",
    detail: "Created from Eppo",
    action: "created",
    dateCreated: "2024-01-01",
  });
  const run = (artifacts: ApiAutoRun["artifacts"]): ApiAutoRun =>
    ({ id: "arun_1", source: "eppo-import", artifacts }) as ApiAutoRun;

  const mockApi = (
    fail: (url: string, method: string) => string | undefined = () => undefined,
    usage: {
      experiments?: Partial<ExperimentInterfaceStringDates>[];
      factMetrics?: Partial<FactMetricInterface>[];
      features?: Partial<FeatureInterface>[];
    } = {},
  ) => {
    const calls: string[] = [];
    const respond = async (
      url: string,
      options?: RequestInit,
    ): Promise<unknown> => {
      const method = options?.method ?? "GET";
      calls.push(`${method} ${url}`);
      const error = fail(url, method);
      if (error) throw new Error(error);
      if (method === "GET" && url.startsWith("/feature/")) {
        return { feature: { archived: false } };
      }
      if (method === "GET" && url.startsWith("/saved-groups/")) {
        return { savedGroup: { archived: true } };
      }
      if (method === "GET" && url.startsWith("/experiments?")) {
        return { experiments: usage.experiments ?? [] };
      }
      if (method === "GET" && url === "/organization/definitions") {
        return { factMetrics: usage.factMetrics ?? [] };
      }
      if (method === "GET" && url === "/feature") {
        return { features: usage.features ?? [] };
      }
      if (method === "GET" && url.startsWith("/experiment/")) {
        return {
          linkedFeatures: url.endsWith("exp_linked")
            ? [{ feature: { id: "flag-kept" } }]
            : [],
        };
      }
      return {};
    };
    const apiCall = <T>(url: string, options?: RequestInit) =>
      respond(url, options) as Promise<T>;
    return { calls, apiCall };
  };

  it("deletes dependents first, archiving where required, and records each", async () => {
    const { calls, apiCall } = mockApi();
    const result = await teardownRun(
      run([
        artifact("saved-group", "grp_1"),
        artifact("fact-table", "ftb_1"),
        artifact("feature", "flag-a"),
        artifact("metric", "fact__1"),
      ]),
      apiCall,
    );
    expect(result).toEqual({ deleted: 4, failures: [] });
    expect(calls.filter((c) => !c.includes("/auto-runs/"))).toEqual([
      "GET /feature/flag-a",
      "POST /feature/flag-a/archive",
      "DELETE /feature/flag-a",
      "GET /experiments?includeArchived=1",
      "DELETE /fact-metrics/fact__1",
      "GET /organization/definitions",
      "DELETE /fact-tables/ftb_1",
      "GET /saved-groups/grp_1",
      "DELETE /saved-groups/grp_1",
    ]);
    // One record for the whole run, not one per item
    expect(calls.filter((c) => c.includes("/auto-runs/"))).toHaveLength(1);
  });

  it("treats something already removed as deleted and keeps experiments flags still use", async () => {
    const { apiCall } = mockApi((url, method) =>
      method === "DELETE" && url === "/fact-metrics/fact__gone"
        ? "Could not find metric"
        : undefined,
    );
    const linked = await teardownRun(
      run([artifact("experiment", "exp_linked")]),
      apiCall,
    );
    expect(linked.deleted).toBe(0);
    expect(linked.failures.map((f) => [f.artifact.id, f.error])).toEqual([
      ["exp_linked", "Still used by Feature Flag flag-kept"],
    ]);

    const gone = await teardownRun(
      run([
        artifact("experiment", "exp_free"),
        artifact("metric", "fact__gone"),
      ]),
      apiCall,
    );
    expect(gone).toEqual({ deleted: 2, failures: [] });
  });

  it("keeps metrics and Fact Tables that something outside the run still uses", async () => {
    const { calls, apiCall } = mockApi(undefined, {
      experiments: [
        { id: "exp_run", name: "Run", goalMetrics: ["fact__1"] },
        { id: "exp_kept", name: "Kept", secondaryMetrics: ["fact__2"] },
      ],
      factMetrics: [
        { id: "fact__3", name: "Revenue", numerator: { factTableId: "ftb_1" } },
        {
          id: "fact__updated",
          name: "Orders",
          numerator: { factTableId: "ftb_2" },
        },
        {
          id: "fact__funnel",
          name: "Checkout funnel",
          funnelSettings: { steps: [{ factTableId: "ftb_3" }] },
        },
      ] as Partial<FactMetricInterface>[],
    });
    const metrics = await teardownRun(
      run([
        artifact("experiment", "exp_run"),
        artifact("metric", "fact__1"),
        artifact("metric", "fact__2"),
      ]),
      apiCall,
    );
    expect(metrics.deleted).toBe(2);
    expect(metrics.failures.map((f) => [f.artifact.id, f.error])).toEqual([
      ["fact__2", "Still used by experiment Kept"],
    ]);
    expect(
      calls.filter((c) => c === "GET /experiments?includeArchived=1"),
    ).toHaveLength(1);

    const tables = await teardownRun(
      run([
        artifact("metric", "fact__3"),
        artifact("fact-table", "ftb_1"),
        artifact("fact-table", "ftb_2"),
        artifact("fact-table", "ftb_3"),
      ]),
      apiCall,
    );
    expect(tables.deleted).toBe(2);
    // A funnel metric uses its tables through its steps
    expect(tables.failures.map((f) => [f.artifact.id, f.error])).toEqual([
      ["ftb_2", "Still used by Fact Metric Orders"],
      ["ftb_3", "Still used by Fact Metric Checkout funnel"],
    ]);
    expect(calls).not.toContain("DELETE /fact-metrics/fact__2");
    expect(calls).not.toContain("DELETE /fact-tables/ftb_2");
  });

  it("keeps environments and tags that surviving flags still use", async () => {
    const { apiCall } = mockApi(() => undefined, {
      features: [
        {
          id: "flag-live",
          tags: ["checkout"],
          environmentSettings: { staging: { enabled: true } },
          rules: [],
        },
      ] as Partial<FeatureInterface>[],
    });
    const result = await teardownRun(
      run([
        artifact("environment", "staging"),
        artifact("environment", "dev"),
        artifact("tag", "checkout"),
        artifact("tag", "growth"),
      ]),
      apiCall,
    );
    expect(result.deleted).toBe(2);
    expect(result.failures.map((f) => [f.artifact.id, f.error])).toEqual([
      ["staging", "Still used by Feature Flag flag-live"],
      ["checkout", "Still used by Feature Flag flag-live"],
    ]);
  });

  it("restores the archive state when a delete fails and keeps what a failure still uses", async () => {
    const { calls, apiCall } = mockApi((url, method) =>
      method === "DELETE" && url === "/fact-metrics/fact__1"
        ? "Metric is in use"
        : method === "DELETE" && url === "/feature/flag-a"
          ? "Still a prerequisite"
          : undefined,
    );
    const result = await teardownRun(
      run([
        artifact("feature", "flag-a"),
        artifact("metric", "fact__1"),
        artifact("fact-table", "ftb_1"),
        artifact("saved-group", "grp_1"),
        artifact("tag", "checkout"),
      ]),
      apiCall,
    );
    expect(result.deleted).toBe(1);
    // A kept experiment keeps its metrics, which keep their fact table
    expect(result.failures.map((f) => [f.artifact.id, f.error])).toEqual([
      ["flag-a", "Still a prerequisite"],
      ["fact__1", "Kept because something that uses it couldn't be deleted"],
      ["ftb_1", "Kept because something that uses it couldn't be deleted"],
      ["grp_1", "Kept because something that uses it couldn't be deleted"],
    ]);
    expect(calls).toContain("POST /feature/flag-a/archive");
    expect(
      calls.filter((c) => c === "POST /feature/flag-a/archive"),
    ).toHaveLength(2);
    expect(calls).not.toContain("DELETE /fact-tables/ftb_1");
    expect(calls).toContain("DELETE /tag");
  });
});

describe("runEppoImport", () => {
  const emptyExisting = (): ExistingIds => ({
    environments: new Set(),
    tags: new Set(),
    imported: {
      audiences: new Map(),
      factSources: new Map(),
      metrics: new Map(),
      experiments: new Map(),
      flags: new Map(),
    },
    savedGroups: new Map(),
    features: new Set(),
    factTables: new Map(),
    factMetrics: new Map(),
    experiments: new Map(),
    experimentRefs: new Map(),
    factTableColumns: new Map(),
  });
  const data = (): EppoImportData => ({
    environments: [],
    tags: [],
    audiences: EPPO.audiences.map((a) => ({
      key: String(a.id),
      name: a.name,
      eppo: a,
      status: "pending",
    })),
    factSources: [],
    metrics: [],
    experiments: [],
    flags: [],
  });

  const mockApi = (
    onRecord: () => unknown,
    get: (url: string) => unknown = () => ({}),
  ) => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const respond = async (
      url: string,
      options?: RequestInit,
    ): Promise<unknown> => {
      const method = options?.method ?? "GET";
      const body =
        typeof options?.body === "string"
          ? JSON.parse(options.body)
          : undefined;
      calls.push({ method, url, body });
      if (url === "/auto-runs") return { autoRun: { id: "arun_1" } };
      if (url === "/auto-runs/arun_1/artifacts") return onRecord();
      if (url === "/saved-groups") {
        return { savedGroup: { id: `grp_${body.groupName}` } };
      }
      return method === "GET" ? get(url) : {};
    };
    const apiCall = <T>(url: string, options?: RequestInit) =>
      respond(url, options) as Promise<T>;
    return { calls, apiCall };
  };

  const run = (apiCall: ApiCall, importData: EppoImportData = data()) => {
    const results: Record<string, { status: string; error?: string }> = {};
    return runEppoImport({
      data: importData,
      eppo: EPPO,
      isSelected: () => true,
      existing: emptyExisting(),
      project: "",
      datasource: null,
      attributeSchema: [{ property: "id", datatype: "string" }],
      apiCall,
      setItem: (category, key, update) => {
        results[`${category}:${key}`] = {
          ...results[`${category}:${key}`],
          ...update,
        };
      },
    }).then((outcome) => ({ outcome, results }));
  };

  it("records what it created on the run and reports the outcome", async () => {
    const { calls, apiCall } = mockApi(() => ({}));
    const { outcome, results } = await run(apiCall);
    expect(outcome).toEqual({ runId: "arun_1", completed: 1, failed: 0 });
    expect(results["audiences:7"]).toEqual({
      status: "completed",
      error: undefined,
    });
    const recorded = calls.find((c) => c.url === "/auto-runs/arun_1/artifacts");
    expect(recorded?.body).toEqual({
      artifacts: [
        expect.objectContaining({
          kind: "saved-group",
          id: "grp_Beta users",
          externalId: "audiences:7",
          action: "created",
        }),
      ],
    });
    expect(calls.at(-1)).toMatchObject({
      method: "PUT",
      url: "/auto-runs/arun_1",
      body: { outcome: "completed" },
    });
  });

  it("stops an experiment that was a draft when Eppo has since completed it", async () => {
    const eppoExperiment: EppoExperiment = {
      id: 5,
      name: "Checkout test",
      status: "COMPLETED",
      experiment_key: "checkout-test",
      assignments_start_date: "2024-01-01T00:00:00Z",
      assignments_end_date: "2024-02-01T00:00:00Z",
      outcome: "POSITIVE",
      winning_variant_key: "on",
      variations: [
        {
          name: "Off",
          variant_key: "off",
          is_control: true,
          weighted_expected_traffic: 1,
          is_active: true,
          variation_id: 12,
        },
        {
          name: "On",
          variant_key: "on",
          is_control: false,
          weighted_expected_traffic: 1,
          is_active: true,
          variation_id: 11,
        },
      ],
    };
    const { calls, apiCall } = mockApi(
      () => ({}),
      (url) =>
        url === "/experiment/exp_1"
          ? {
              experiment: {
                id: "exp_1",
                status: "draft",
                variations: [
                  { id: "var_off", key: "off" },
                  { id: "var_on", key: "on" },
                ],
                phases: [
                  {
                    name: "Main",
                    dateStarted: "2024-01-01T00:00:00Z",
                    coverage: 1,
                    condition: "",
                    savedGroups: [],
                  },
                ],
              },
            }
          : {},
    );
    const { results } = await run(apiCall, {
      ...data(),
      audiences: [],
      experiments: [
        {
          key: "5",
          name: eppoExperiment.name,
          eppo: eppoExperiment,
          existingId: "exp_1",
          status: "pending",
        },
      ],
    });
    expect(results["experiments:5"]).toMatchObject({ status: "completed" });
    expect(calls).toContainEqual({
      method: "POST",
      url: "/experiment/exp_1/status",
      body: { status: "stopped" },
    });
    expect(calls.some((c) => c.url === "/experiment/exp_1/stop")).toBe(false);
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: "PUT",
        url: "/experiment/exp_1/phase/0",
        body: expect.objectContaining({ dateEnded: "2024-02-01T00:00" }),
      }),
    );
  });

  it("marks an import failed when the run rejects its record", async () => {
    const { calls, apiCall } = mockApi(() => {
      throw new Error("Label too long");
    });
    const { outcome, results } = await run(apiCall);
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/saved-groups"),
    ).toBe(true);
    expect(outcome).toEqual({ runId: "arun_1", completed: 0, failed: 1 });
    expect(results["audiences:7"]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("couldn't be recorded"),
    });
    expect(calls.at(-1)).toMatchObject({
      url: "/auto-runs/arun_1",
      body: { outcome: "failed" },
    });
  });
});

describe("fetchEppoData", () => {
  const fetchWith = async (since: Date | null) => {
    const seen: string[] = [];
    const apiCall = <T>(url: string, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body ?? "{}"));
      seen.push(body.endpoint);
      const flags = body.endpoint.startsWith("feature-flags")
        ? [
            {
              ...mkFlag([]),
              id: 1,
              key: "old",
              created_at: "2025-01-01T00:00:00Z",
            },
            {
              ...mkFlag([]),
              id: 2,
              key: "new",
              created_at: "2026-06-01T00:00:00Z",
            },
            { ...mkFlag([]), id: 3, key: "undated" },
          ]
        : [];
      return Promise.resolve(flags as unknown as T);
    };
    const data = await fetchEppoData("key", apiCall, { createdSince: since });
    return {
      seen,
      allFlags: data.flags.map((f) => f.key),
      offered: importableFlags(data).map((f) => f.key),
    };
  };

  it("fetches everything unless a start date is given", async () => {
    const all = await fetchWith(null);
    expect(all.seen).toContain("experiments?limit=250&offset=0");
    expect(all.offered).toEqual(["old", "new", "undated"]);
  });

  // Every flag stays in the data so experiment targeting can still read its
  // allocations; the cutoff only limits which flags are offered for import
  it("filters experiments server-side and offers only flags created since", async () => {
    const since = await fetchWith(new Date("2026-04-01T00:00:00Z"));
    expect(since.seen).toContain(
      "experiments?created_since=2026-04-01T00%3A00%3A00.000Z&limit=250&offset=0",
    );
    expect(since.allFlags).toEqual(["old", "new", "undated"]);
    expect(since.offered).toEqual(["new", "undated"]);
  });
});
