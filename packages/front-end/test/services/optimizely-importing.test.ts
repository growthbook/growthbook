import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ApiAutoRun } from "shared/validators";
import {
  audienceToCondition,
  buildImportData,
  ExistingIds,
  getImportedIds,
  getMetrics,
  getRuleTargeting,
  matchItems,
  metricExternalId,
  metricKey,
  OptimizelyData,
  OptimizelyMetric,
  OptimizelyRule,
  TransformContext,
  transformFlag,
  transformMetric,
} from "@/services/importing/optimizely/optimizely-importing";

const audience = (id: number, conditions: unknown) => ({
  id,
  name: `Audience ${id}`,
  conditions: JSON.stringify(conditions),
});

const leaf = (name: string, match_type: string, value?: unknown) => ({
  type: "custom_attribute",
  name,
  match_type,
  value,
});

const PURCHASES: OptimizelyMetric = {
  aggregator: "unique",
  event_id: 100,
  scope: "visitor",
  winning_direction: "increasing",
};
const REVENUE: OptimizelyMetric = {
  aggregator: "sum",
  event_id: 100,
  field: "revenue",
  scope: "visitor",
  winning_direction: "increasing",
};

const AB_RULE: OptimizelyRule = {
  id: 11,
  key: "checkout_test",
  name: "Checkout Test",
  type: "a/b",
  enabled: true,
  status: "running",
  percentage_included: 5000,
  audience_conditions: ["or", { audience_id: 1 }],
  baseline_variation_id: 501,
  variations: {
    on: { key: "on", name: "On", percentage_included: 2500, variation_id: 502 },
    off: {
      key: "off",
      name: "Off",
      percentage_included: 7500,
      variation_id: 501,
    },
  },
  metrics: [PURCHASES, REVENUE],
};

const OPT: OptimizelyData = {
  project: { id: 1, name: "Shop", is_flags_enabled: true },
  environments: [
    { id: 1, key: "production", name: "Production", is_primary: true },
    { id: 2, key: "development", name: "Development" },
  ],
  audiences: [
    // The nesting Optimizely's UI produces
    audience(1, ["and", ["or", ["or", leaf("plan", "exact", "pro")]]]),
    audience(2, ["and", leaf("age", "ge", 18), leaf("country", "exists")]),
  ],
  events: [{ id: 100, key: "purchase", name: "Purchase" }],
  flags: [
    {
      id: 9,
      key: "checkout",
      name: "Checkout",
      variable_definitions: {
        color: { key: "color", type: "string", default_value: "blue" },
        limit: { key: "limit", type: "integer", default_value: "3" },
      },
      variations: [
        { key: "off", enabled: false },
        { key: "on", enabled: true, variables: { color: { value: "red" } } },
      ],
      rulesets: {
        production: {
          enabled: true,
          rule_priorities: ["checkout_test", "beta", "everyone"],
          default_variation_key: "off",
          rules: {
            everyone: {
              id: 13,
              key: "everyone",
              type: "targeted_delivery",
              status: "running",
              percentage_included: 10000,
              audience_conditions: [],
              variations: { on: { key: "on" } },
            },
            beta: {
              id: 12,
              key: "beta",
              type: "targeted_delivery",
              status: "running",
              percentage_included: 2000,
              audience_conditions: [
                "and",
                { audience_id: 1 },
                ["not", { audience_id: 2 }],
              ],
              variations: { on: { key: "on" } },
              allow_list: { a: { user_id: "u1", variation: { key: "on" } } },
            },
            checkout_test: AB_RULE,
          },
        },
        development: { enabled: false, default_variation_key: "on" },
      },
    },
  ],
};

const DATASOURCE = {
  id: "ds_1",
  settings: {},
} as DataSourceInterfaceWithParams;

const SETTINGS = {
  project: "prj_1",
  datasource: DATASOURCE,
  eventsFactTable: {
    id: "ch_events",
    eventNameColumn: "event_name",
    revenueColumn: "properties.revenue",
    valueColumn: "amount",
    propertyColumns: { sku: "product_sku" },
  },
};

function mkCtx(overrides: Partial<TransformContext> = {}): TransformContext {
  return {
    opt: OPT,
    ...SETTINGS,
    environmentIds: new Set(["production", "development"]),
    savedGroupIds: new Map([
      ["1", "grp_1"],
      ["2", "grp_2"],
    ]),
    metricIds: new Map([
      [metricKey(PURCHASES), "fact__purchases"],
      [metricKey(REVENUE), "fact__revenue"],
    ]),
    ...overrides,
  };
}

const NOTHING_EXISTS: ExistingIds = {
  environments: new Set(["production"]),
  imported: getImportedIds([], () => true),
  savedGroups: new Map(),
  factMetrics: new Map(),
  features: new Set(),
};

describe("audienceToCondition", () => {
  it("collapses the UI's nesting around a single condition", () => {
    expect(audienceToCondition(OPT.audiences[0])).toEqual({ plan: "pro" });
  });

  it("maps match types and merges an and", () => {
    expect(audienceToCondition(OPT.audiences[1])).toEqual({
      age: { $gte: 18 },
      country: { $exists: true },
    });
    expect(
      audienceToCondition(
        audience(3, [
          "or",
          leaf("v", "semver_gt", "1.2.0"),
          leaf("email", "substring", "@a.b"),
        ]),
      ),
    ).toEqual({
      $or: [{ v: { $vgt: "1.2.0" } }, { email: { $regex: "@a\\.b" } }],
    });
  });

  it("keeps both conditions when an and repeats an attribute", () => {
    expect(
      audienceToCondition(
        audience(3, ["and", leaf("age", "ge", 18), leaf("age", "lt", 65)]),
      ),
    ).toEqual({ $and: [{ age: { $gte: 18 } }, { age: { $lt: 65 } }] });
  });

  it("requires the attribute under a not, as Optimizely does", () => {
    expect(
      audienceToCondition(audience(3, ["not", leaf("plan", "exact", "free")])),
    ).toEqual({
      $and: [{ plan: { $exists: true } }, { $not: { plan: "free" } }],
    });
  });

  it("rejects conditions GrowthBook can't evaluate", () => {
    expect(() =>
      audienceToCondition(
        audience(3, ["and", { type: "third_party_dimension", name: "x" }]),
      ),
    ).toThrow("Unsupported audience condition type");
  });
});

// Pro plan, and not (adult with a country): excluding a Saved Group would also
// match users with no age or country
const NOT_AUDIENCE_2 = {
  plan: "pro",
  $and: [
    { age: { $exists: true } },
    { country: { $exists: true } },
    { $not: { age: { $gte: 18 }, country: { $exists: true } } },
  ],
};

describe("getRuleTargeting", () => {
  const rule = (audience_conditions: OptimizelyRule["audience_conditions"]) =>
    ({ ...AB_RULE, audience_conditions }) as OptimizelyRule;

  it("targets everyone with no conditions", () => {
    const everyone = { condition: "", savedGroups: [] };
    expect(getRuleTargeting(rule([]), mkCtx())).toEqual(everyone);
    expect(getRuleTargeting(rule("everyone"), mkCtx())).toEqual(everyone);
  });

  it("uses Saved Groups for and and or of audiences", () => {
    expect(
      getRuleTargeting(
        rule(["or", { audience_id: 1 }, { audience_id: 2 }]),
        mkCtx(),
      ).savedGroups,
    ).toEqual([{ match: "any", ids: ["grp_1", "grp_2"] }]);
    expect(
      getRuleTargeting(
        rule(["and", { audience_id: 1 }, { audience_id: 2 }]),
        mkCtx(),
      ).savedGroups,
    ).toEqual([
      { match: "any", ids: ["grp_1"] },
      { match: "any", ids: ["grp_2"] },
    ]);
  });

  it("copies conditions for a negated audience, keeping the attribute guard", () => {
    expect(
      getRuleTargeting(
        rule(["and", { audience_id: 1 }, ["not", { audience_id: 2 }]]),
        mkCtx(),
      ),
    ).toEqual({ condition: JSON.stringify(NOT_AUDIENCE_2), savedGroups: [] });
  });

  it("copies the audience's conditions when it has no Saved Group", () => {
    expect(
      getRuleTargeting(
        rule(["or", { audience_id: 1 }]),
        mkCtx({ savedGroupIds: new Map() }),
      ),
    ).toEqual({ condition: JSON.stringify({ plan: "pro" }), savedGroups: [] });
  });
});

describe("metrics", () => {
  const eventFilter = {
    column: "event_name",
    operator: "in",
    values: ["purchase"],
  };

  it("defines each distinct rule metric once", () => {
    expect(getMetrics(OPT)).toEqual([PURCHASES, REVENUE]);
  });

  it("maps unique conversions to a proportion on the events table", () => {
    expect(transformMetric(PURCHASES, mkCtx())).toMatchObject({
      name: "Purchase: unique conversions",
      metricType: "proportion",
      datasource: "ds_1",
      numerator: {
        factTableId: "ch_events",
        column: "$$distinctUsers",
        rowFilters: [eventFilter],
      },
      inverse: false,
    });
  });

  it("maps totals to means over the count or an event property", () => {
    expect(
      transformMetric({ ...PURCHASES, aggregator: "count" }, mkCtx()),
    ).toMatchObject({ metricType: "mean", numerator: { column: "$$count" } });
    expect(transformMetric(REVENUE, mkCtx())).toMatchObject({
      metricType: "mean",
      numerator: { column: "properties.revenue", rowFilters: [eventFilter] },
    });
  });

  it("maps per-conversion and ratio metrics to ratios", () => {
    expect(
      transformMetric({ ...REVENUE, scope: "event" }, mkCtx()),
    ).toMatchObject({
      metricType: "ratio",
      numerator: { column: "properties.revenue" },
      denominator: { column: "$$count", rowFilters: [eventFilter] },
    });
    expect(
      transformMetric(
        {
          aggregator: "ratio",
          winning_direction: "decreasing",
          metrics: [
            { aggregator: "unique", event_id: 100, role: "denominator" },
            { aggregator: "count", event_id: 100, role: "numerator" },
          ],
        },
        mkCtx(),
      ),
    ).toMatchObject({
      metricType: "ratio",
      numerator: { column: "$$count" },
      denominator: { column: "$$distinctUsers" },
      inverse: true,
    });
  });

  it("filters on event properties", () => {
    expect(
      transformMetric(
        {
          ...PURCHASES,
          event_properties: {
            filter: {
              conditions: [{ name: "sku", operator: "equal_to", value: "a1" }],
            },
          },
        },
        mkCtx(),
      ).numerator?.rowFilters,
    ).toEqual([
      eventFilter,
      { column: "product_sku", operator: "=", values: ["a1"] },
    ]);
  });

  it("reads the columns the events Fact Table is mapped to", () => {
    expect(
      transformMetric({ ...REVENUE, field: "value" }, mkCtx()).numerator
        ?.column,
    ).toBe("amount");
  });

  it("blocks only the metrics that need an unmapped column", () => {
    const unmapped = (column: string) =>
      mkCtx({
        eventsFactTable: { ...SETTINGS.eventsFactTable, [column]: "" },
      });
    expect(() => transformMetric(REVENUE, unmapped("revenueColumn"))).toThrow(
      "Choose a revenue column",
    );
    expect(
      transformMetric(PURCHASES, unmapped("revenueColumn")).metricType,
    ).toBe("proportion");
    expect(
      transformMetric({ ...REVENUE, field: "value" }, unmapped("revenueColumn"))
        .metricType,
    ).toBe("mean");

    expect(() =>
      transformMetric(PURCHASES, unmapped("eventNameColumn")),
    ).toThrow("Choose an event name column");
    expect(() =>
      transformMetric(
        {
          ...PURCHASES,
          event_properties: {
            filter: {
              conditions: [{ name: "size", operator: "equal_to", value: "L" }],
            },
          },
        },
        mkCtx(),
      ),
    ).toThrow('Choose a column for the "size" property');
    // Overall revenue has no event to filter on
    expect(
      transformMetric(
        { ...REVENUE, event_id: null },
        unmapped("eventNameColumn"),
      ).numerator?.rowFilters,
    ).toEqual([]);
  });

  it("explains what it can't import", () => {
    expect(() =>
      transformMetric(PURCHASES, mkCtx({ eventsFactTable: null })),
    ).toThrow("Select a Data Source and an events Fact Table");
    expect(() =>
      transformMetric({ ...PURCHASES, scope: "session" }, mkCtx()),
    ).toThrow("Per-session");
    expect(() =>
      transformMetric({ ...PURCHASES, event_id: 404 }, mkCtx()),
    ).toThrow("Unknown event 404");
  });
});

describe("transformFlag", () => {
  const ctx = mkCtx();
  const on = JSON.stringify({
    enabled: true,
    variables: { color: "red", limit: 3 },
  });
  const off = JSON.stringify({
    enabled: false,
    variables: { color: "blue", limit: 3 },
  });

  it("turns variables into a JSON value shaped like the SDK decision", () => {
    const flag = transformFlag(OPT.flags[0], ctx);
    expect(flag).toMatchObject({
      id: "checkout",
      valueType: "json",
      defaultValue: off,
      environmentSettings: {
        production: { enabled: true },
        development: { enabled: false },
      },
    });
  });

  it("is a boolean when the flag has no variables", () => {
    const flag = transformFlag(
      { ...OPT.flags[0], variable_definitions: {} },
      ctx,
    );
    expect(flag.valueType).toBe("boolean");
    expect(flag.defaultValue).toBe("false");
  });

  it("keeps delivery rules in order and leaves out A/B rules", () => {
    const rules = transformFlag(OPT.flags[0], ctx).rules ?? [];
    expect(rules.map((r) => [r.id, r.type, r.environments])).toEqual([
      ["fr_opt_12_allow_on", "force", ["production"]],
      ["fr_opt_12", "rollout", ["production"]],
      // In the audience but outside the 20% gets the default, not "everyone"
      ["fr_opt_12_rest", "force", ["production"]],
      ["fr_opt_13", "force", ["production"]],
      // development's default differs from the Feature Flag's
      ["fr_opt_default_development", "force", ["development"]],
    ]);
    expect(rules[0]).toMatchObject({
      condition: JSON.stringify({ id: { $in: ["u1"] } }),
      value: on,
    });
    expect(rules[1]).toMatchObject({
      coverage: 0.2,
      value: on,
      condition: JSON.stringify(NOT_AUDIENCE_2),
      savedGroups: [],
    });
    expect(rules[2]).toMatchObject({ value: off });
    expect(rules[4]).toMatchObject({ value: on });
  });

  it("rejects rule types it can't serve", () => {
    const flag = structuredClone(OPT.flags[0]);
    flag.rulesets.production.rules!.beta.type = "multi_armed_bandit";
    expect(() => transformFlag(flag, ctx)).toThrow(
      "Bandit rules aren't supported",
    );
  });
});

describe("buildImportData", () => {
  const build = (existing: ExistingIds, selected = true) =>
    buildImportData(
      OPT,
      existing,
      matchItems(OPT, existing),
      SETTINGS,
      () => selected,
    );

  it("previews everything a fresh import would create", () => {
    const data = build(NOTHING_EXISTS);
    expect(
      Object.values(data)
        .flat()
        .filter((i) => i.status === "invalid"),
    ).toEqual([]);
    expect(data.environments.map((e) => e.existingId)).toEqual([
      "production",
      undefined,
    ]);
  });

  it("matches items an earlier run imported, and by name otherwise", () => {
    const run = {
      source: "optimizely-import",
      dateCreated: "2026-01-01",
      artifacts: [
        {
          kind: "feature",
          id: "checkout",
          action: "created",
          externalId: "flags:9",
        },
        {
          kind: "metric",
          id: "fact__gone",
          action: "created",
          externalId: `metrics:${metricExternalId(REVENUE)}`,
        },
      ],
    } as unknown as ApiAutoRun;
    const data = build({
      ...NOTHING_EXISTS,
      imported: getImportedIds([run], (kind) => kind === "feature"),
      savedGroups: new Map([["Audience 1", "grp_7"]]),
    });
    expect(data.flags[0]).toMatchObject({
      existingId: "checkout",
      match: "run",
    });
    expect(data.audiences[0]).toMatchObject({
      existingId: "grp_7",
      match: "name",
    });
    // Deleted in GrowthBook since, so it is created again
    expect(data.metrics[1].existingId).toBeUndefined();
  });

  it("keeps metric ids within the run artifact limit", () => {
    const filtered = {
      ...PURCHASES,
      event_properties: {
        filter: {
          conditions: [
            { name: "category", operator: "equal_to", value: "x".repeat(300) },
          ],
        },
      },
    };
    expect(metricKey(filtered).length).toBeGreaterThan(200);
    expect(`metrics:${metricExternalId(filtered)}`.length).toBeLessThan(200);
    expect(metricExternalId(filtered)).not.toBe(metricExternalId(PURCHASES));
  });
});
