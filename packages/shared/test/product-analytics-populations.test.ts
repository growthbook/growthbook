import { DatabaseSync } from "node:sqlite";
import {
  generateProductAnalyticsSQL,
  transformProductAnalyticsRowsToResult,
  encodeExplorationConfig,
  decodeExplorationConfigJson,
  getPopulationViolations,
} from "shared/enterprise";
import { createLikeStringMatchFn } from "shared/sql";
import {
  ExplorationDateRange,
  MetricExplorationConfig,
  ExplorationPopulation,
  ProductAnalyticsDimension,
  explorationPopulationValidator,
  metricTypeValidator,
  explorationConfigValidator,
  productAnalyticsExplorationValidator,
  populationExplorationConfigValidator,
} from "shared/validators";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { SqlDialect } from "shared/types/sql";

/*
 * One small event log drives every result below, so each expected number can
 * be checked by hand. It mirrors the manual-testing table pa_pop_test.events.
 *
 *   Alice  9/1 two mobile purchases ($6 + $6)        9/2 mobile login ($0)
 *   Bob    9/1 mobile login ($0)                     9/2 mobile login, mobile purchase ($5)
 *   Carol  9/1 desktop login ($0)
 *   Dylan  9/1 six desktop purchases ($1..$6)
 *   (none) 9/1 mobile purchase ($99) with a NULL user_id
 *   Erin                                             9/2 mobile purchase ($20)
 *   Gina                                             9/2 mobile login ($15)
 *   Frank                                                                    9/3 mobile login ($0)
 */
const EVENTS: [string | null, string, number, string, string][] = [
  ["Bob", "2026-09-01 09:00:00", 0, "mobile", "Login"],
  ["Carol", "2026-09-01 09:30:00", 0, "desktop", "Login"],
  ["Alice", "2026-09-01 10:00:00", 6, "mobile", "Purchase"],
  ["Alice", "2026-09-01 11:00:00", 6, "mobile", "Purchase"],
  ["Dylan", "2026-09-01 12:00:00", 1, "desktop", "Purchase"],
  ["Dylan", "2026-09-01 12:10:00", 2, "desktop", "Purchase"],
  ["Dylan", "2026-09-01 12:20:00", 3, "desktop", "Purchase"],
  ["Dylan", "2026-09-01 12:30:00", 4, "desktop", "Purchase"],
  ["Dylan", "2026-09-01 12:40:00", 5, "desktop", "Purchase"],
  ["Dylan", "2026-09-01 12:50:00", 6, "desktop", "Purchase"],
  [null, "2026-09-01 13:00:00", 99, "mobile", "Purchase"],
  ["Bob", "2026-09-02 09:00:00", 0, "mobile", "Login"],
  ["Bob", "2026-09-02 09:05:00", 5, "mobile", "Purchase"],
  ["Alice", "2026-09-02 10:00:00", 0, "mobile", "Login"],
  ["Erin", "2026-09-02 15:00:00", 20, "mobile", "Purchase"],
  ["Gina", "2026-09-02 16:00:00", 15, "mobile", "Login"],
  ["Frank", "2026-09-03 08:00:00", 0, "mobile", "Login"],
];

const table = {
  id: "events",
  datasource: "ds",
  sql: "SELECT * FROM events",
  userIdTypes: ["user_id"],
  filters: [],
  columns: [
    { column: "revenue", datatype: "number" },
    { column: "device_type", datatype: "string" },
    { column: "event_name", datatype: "string" },
    { column: "timestamp", datatype: "date" },
    { column: "user_id", datatype: "string" },
  ],
} as FactTableInterface;

const eventIs = (name: string) => [
  { column: "event_name", operator: "=" as const, values: [name] },
];
const proportion = (
  id: string,
  name: string,
  rowFilters = eventIs("Purchase"),
  extra: Partial<FactMetricInterface["numerator"]> = {},
) =>
  ({
    id,
    datasource: "ds",
    name,
    metricType: "proportion",
    numerator: {
      factTableId: "events",
      column: "$$distinctUsers",
      rowFilters,
      ...extra,
    },
    denominator: null,
    cappingSettings: { type: "", value: 0 },
    quantileSettings: null,
  }) as FactMetricInterface;
const mean = (
  id: string,
  name: string,
  column: string,
  aggregation: "sum" | "count distinct",
) =>
  ({
    ...proportion(id, name),
    metricType: "mean",
    numerator: {
      factTableId: "events",
      column,
      aggregation,
      rowFilters: eventIs("Purchase"),
    },
  }) as FactMetricInterface;

const purchasers = proportion("purchasers", "Purchasers");
const loggedIn = proportion("logged_in", "Logged in", eventIs("Login"));
const repeatPurchasers = proportion(
  "repeat_purchasers",
  "Repeat purchasers",
  eventIs("Purchase"),
  { aggregateFilter: ">=2", aggregateFilterColumn: "$$count" },
);
const revenue = mean("revenue", "Revenue", "revenue", "sum");
const purchaseDevices = mean(
  "purchase_devices",
  "Purchase devices",
  "device_type",
  "count distinct",
);
const revenuePerPurchase = {
  ...revenue,
  id: "revenue_per_purchase",
  name: "Revenue per purchase",
  metricType: "ratio",
  denominator: {
    factTableId: "events",
    column: "$$count",
    aggregation: "sum",
    rowFilters: eventIs("Purchase"),
  },
} as FactMetricInterface;
const ALL_METRICS = [
  purchasers,
  loggedIn,
  repeatPurchasers,
  revenue,
  purchaseDevices,
  revenuePerPurchase,
];

const mobileUsers = (
  extra: Partial<ExplorationPopulation> = {},
): ExplorationPopulation => ({
  source: { type: "factTable", factTableId: "events" },
  rowFilters: [{ column: "device_type", operator: "=", values: ["mobile"] }],
  unit: "user_id",
  ...extra,
});
const mobileRevenueOver10 = mobileUsers({
  aggregateFilter: ">10",
  aggregateFilterColumn: "revenue",
});

const DAILY: ProductAnalyticsDimension[] = [
  { dimensionType: "date", column: null, dateGranularity: "day" },
];
const SEPT_1_TO_3: ExplorationDateRange = {
  predefined: "customDateRange",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
};

function explore({
  metrics,
  population = null,
  overall = false,
  dimensions = overall ? [] : DAILY,
  dateRange = SEPT_1_TO_3,
  unit = "user_id",
}: {
  metrics: FactMetricInterface[];
  population?: ExplorationPopulation | null;
  overall?: boolean;
  dimensions?: ProductAnalyticsDimension[];
  dateRange?: ExplorationDateRange;
  unit?: string | null;
}): MetricExplorationConfig {
  return {
    type: "metric",
    datasource: "ds",
    chartType: overall ? "bigNumber" : "line",
    showAs: "total",
    dateRange,
    dimensions,
    dataset: {
      type: "metric",
      values: metrics.map((m) => ({
        type: "metric",
        metricId: m.id,
        name: m.name,
        unit,
        denominatorUnit: m.metricType === "ratio" ? unit : null,
        rowFilters: [],
      })),
      population,
    },
  };
}

const dialect: SqlDialect = {
  escapeStringLiteral: (v) => v.replace(/'/g, "''"),
  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral: (v) => v,
    emitEscapeClause: false,
  }),
  jsonExtract: (col) => col,
  evalBoolean: (col, value) => `${col} = ${value ? 1 : 0}`,
  dateTrunc: (col) => `date(${col})`,
  concatStrings: (parts) => parts.join(" || "),
  percentileApprox: () => {
    throw new Error("Not supported");
  },
  hllReaggregate: () => {
    throw new Error("Not supported");
  },
  hllCardinality: () => {
    throw new Error("Not supported");
  },
  quantileSketchMergePartial: () => {
    throw new Error("Not supported");
  },
  quantileSketchExtractPoint: () => {
    throw new Error("Not supported");
  },
  toTimestamp: (d) => `'${d.toISOString().slice(0, 19).replace("T", " ")}'`,
  formatDialect: "sqlite",
  castToFloat: (col) => `CAST(${col} AS REAL)`,
  castToString: (col) => `CAST(${col} AS TEXT)`,
};

function violations(
  config: MetricExplorationConfig,
  metrics: FactMetricInterface[] = ALL_METRICS,
) {
  return getPopulationViolations({
    dataset: config.dataset,
    dimensions: config.dimensions,
    datasource: config.datasource,
    metricMap: new Map(metrics.map((m) => [m.id, m])),
    factTableMap: new Map([[table.id, table]]),
  }).join(" ");
}

function generate(config: MetricExplorationConfig) {
  return generateProductAnalyticsSQL(
    config,
    new Map([[table.id, table]]),
    new Map(ALL_METRICS.map((m) => [m.id, m])),
    dialect,
    {},
  );
}

// Per bucket: each metric's [numerator, denominator], plus the population count
// when the request has a population.
type Results = Record<
  string,
  { populationCount?: number; values: (number | null)[][] }
>;

function run(config: MetricExplorationConfig): Results {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE events(user_id TEXT, timestamp TEXT, revenue REAL, device_type TEXT, event_name TEXT)",
    );
    const insert = db.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?)");
    EVENTS.forEach((event) => insert.run(...event));
    const { sql, orderedMetricIds } = generate(config);
    const { rows } = transformProductAnalyticsRowsToResult(
      config,
      db.prepare(sql).all(),
      orderedMetricIds,
    );
    return Object.fromEntries(
      rows.map((row) => [
        row.dimensions[0] ?? "overall",
        {
          ...("populationCount" in row
            ? { populationCount: row.populationCount }
            : {}),
          values: (row.values ?? []).map((v) => [v.numerator, v.denominator]),
        },
      ]),
    );
  } finally {
    db.close();
  }
}

describe("metric explorations with a population", () => {
  // Proportions report: numerator = members who converted (null when none did,
  // as without a population), denominator = members with any matching
  // activity, and populationCount = all members in the bucket.
  it.each<[string, MetricExplorationConfig, Results]>([
    [
      "applies one population to every metric (mobile users spending over $10 that day)",
      explore({
        metrics: [purchasers, loggedIn],
        population: mobileRevenueOver10,
      }),
      {
        // Member: Alice ($12). She purchased but didn't log in.
        "2026-09-01": {
          populationCount: 1,
          values: [
            [1, 1],
            [null, 0],
          ],
        },
        // Members: Erin ($20, purchased) and Gina ($15, logged in).
        "2026-09-02": {
          populationCount: 2,
          values: [
            [1, 1],
            [1, 1],
          ],
        },
        // Frank has events but spent $0: the day is kept, with no members.
        "2026-09-03": {
          populationCount: 0,
          values: [
            [null, 0],
            [null, 0],
          ],
        },
      },
    ],
    [
      "evaluates membership over the whole range for an overall total",
      explore({
        metrics: [purchasers, loggedIn],
        population: mobileRevenueOver10,
        overall: true,
      }),
      {
        // Members: Alice ($12), Erin ($20), Gina ($15). Bob's $5 doesn't qualify.
        // Purchased: Alice, Erin. Logged in: Alice, Gina.
        overall: {
          populationCount: 3,
          values: [
            [2, 2],
            [2, 2],
          ],
        },
      },
    ],
    [
      "uses row filters alone when there's no aggregate condition, never counting a NULL user_id",
      explore({ metrics: [purchasers], population: mobileUsers() }),
      {
        // Members: Alice, Bob (the $99 NULL-user row doesn't count). Alice purchased.
        "2026-09-01": { populationCount: 2, values: [[1, 1]] },
        // Members: Alice, Bob, Erin, Gina. Bob and Erin purchased.
        "2026-09-02": { populationCount: 4, values: [[2, 2]] },
        // Member: Frank, who didn't purchase.
        "2026-09-03": { populationCount: 1, values: [[null, 0]] },
      },
    ],
    [
      "supports a row-count condition (at least two mobile events that day)",
      explore({
        metrics: [purchasers],
        population: mobileUsers({
          aggregateFilter: ">=2",
          aggregateFilterColumn: "$$count",
        }),
      }),
      {
        "2026-09-01": { populationCount: 1, values: [[1, 1]] }, // Alice (2 purchases)
        "2026-09-02": { populationCount: 1, values: [[1, 1]] }, // Bob (login + purchase)
        "2026-09-03": { populationCount: 0, values: [[null, 0]] },
      },
    ],
    [
      "requires population activity even when the condition accepts zero (mobile spend <= $0)",
      explore({
        metrics: [purchasers],
        population: mobileUsers({
          aggregateFilter: "<=0",
          aggregateFilterColumn: "revenue",
        }),
      }),
      {
        // Bob qualifies; Carol's desktop-only $0 doesn't make her a member.
        "2026-09-01": { populationCount: 1, values: [[null, 0]] },
        "2026-09-02": { populationCount: 1, values: [[null, 0]] }, // Alice ($0 login)
        "2026-09-03": { populationCount: 1, values: [[null, 0]] }, // Frank ($0 login)
      },
    ],
    [
      "still applies the metric's own conditions within the population",
      explore({ metrics: [repeatPurchasers], population: mobileUsers() }),
      {
        // Alice made 2 purchases. Dylan made 6 but on desktop, so isn't a member.
        "2026-09-01": { populationCount: 2, values: [[1, 1]] },
        // Bob and Erin made one purchase each.
        "2026-09-02": { populationCount: 4, values: [[null, 0]] },
        "2026-09-03": { populationCount: 1, values: [[null, 0]] },
      },
    ],
    [
      "returns an empty overall row when nothing happened in the date range",
      explore({
        metrics: [purchasers],
        population: mobileRevenueOver10,
        overall: true,
        dateRange: {
          predefined: "customDateRange",
          startDate: "2025-01-01",
          endDate: "2025-01-02",
        },
      }),
      { overall: { populationCount: 0, values: [[null, 0]] } },
    ],
  ])("%s", (_, config, expected) => {
    expect(run(config)).toEqual(expected);
  });

  describe("rejected requests", () => {
    it.each<[string, MetricExplorationConfig, string]>([
      [
        "a mean metric alongside a proportion",
        explore({
          metrics: [purchasers, revenue],
          population: mobileRevenueOver10,
        }),
        'Metric "Revenue" can\'t be combined with a Population.',
      ],
      [
        "an unsupported metric listed first",
        explore({
          metrics: [purchaseDevices, purchasers],
          population: mobileRevenueOver10,
        }),
        'Metric "Purchase devices" can\'t be combined with a Population.',
      ],
      [
        "a ratio metric",
        explore({
          metrics: [revenuePerPurchase],
          population: mobileRevenueOver10,
        }),
        'Metric "Revenue per purchase" can\'t be combined with a Population.',
      ],
      [
        "a population on a different Fact Table",
        explore({
          metrics: [purchasers],
          population: mobileUsers({
            source: { type: "factTable", factTableId: "other" },
          }),
        }),
        'Metric "Purchasers" must use the same Fact Table as the Population.',
      ],
      [
        "a population unit the Fact Table doesn't have",
        explore({
          metrics: [purchasers],
          population: mobileUsers({ unit: "anonymous_id" }),
        }),
        "does not support identifier types: anonymous_id",
      ],
      [
        "a metric unit that doesn't match the population",
        explore({
          metrics: [purchasers],
          population: mobileRevenueOver10,
          unit: null,
        }),
        'Metric "Purchasers" must use the population\'s identifier type "user_id".',
      ],
      [
        "grouping by something other than date",
        explore({
          metrics: [purchasers],
          population: mobileRevenueOver10,
          dimensions: [
            { dimensionType: "dynamic", column: "device_type", maxValues: 5 },
          ],
        }),
        "Metrics with populations can only be grouped by date.",
      ],
      [
        "an invalid aggregate condition",
        explore({
          metrics: [purchasers],
          population: mobileUsers({
            aggregateFilter: "invalid",
            aggregateFilterColumn: "revenue",
          }),
        }),
        "Invalid aggregate filter",
      ],
    ])("rejects %s", (_, config, message) => {
      expect(violations(config)).toContain(message);
      // Only the population makes these invalid.
      expect(
        violations({
          ...config,
          dataset: { ...config.dataset, population: null },
        }),
      ).toBe("");
    });

    it.each(
      metricTypeValidator.options.filter((type) => type !== "proportion"),
    )("rejects a %s metric", (metricType) => {
      const config = explore({
        metrics: [purchasers],
        population: mobileRevenueOver10,
      });
      const metric = {
        ...purchasers,
        metricType,
        numerator: metricType === "funnel" ? null : purchasers.numerator,
      } as FactMetricInterface;
      expect(violations(config, [metric])).toContain(
        "Populations currently support only proportion metrics",
      );
    });
  });

  describe("request schema", () => {
    const config = explore({
      metrics: [purchasers],
      population: mobileRevenueOver10,
    });

    it("keeps the population through URLs, the public API, and saved explorations", () => {
      expect(
        explorationConfigValidator.parse(
          decodeExplorationConfigJson(encodeExplorationConfig(config)),
        ),
      ).toEqual(config);
      expect(
        productAnalyticsExplorationValidator.shape.config.parse(config),
      ).toEqual(config);
    });

    it("defaults omitted row filters to an empty list", () => {
      expect(
        explorationPopulationValidator.parse({
          source: mobileRevenueOver10.source,
          unit: "user_id",
        }),
      ).toEqual({
        source: mobileRevenueOver10.source,
        rowFilters: [],
        unit: "user_id",
      });
    });

    it.each<[string, Record<string, unknown>]>([
      ["a missing unit", { unit: undefined }],
      ["a name", { name: "Mobile users" }],
      ["window settings", { windowSettings: { type: "lookback" } }],
      ["steps", { steps: [] }],
    ])("rejects %s", (_, change) => {
      expect(
        explorationPopulationValidator.safeParse({
          ...mobileRevenueOver10,
          ...change,
        }).success,
      ).toBe(false);
    });

    it("still requires names on standalone population series", () => {
      const standalone = {
        ...config,
        type: "population",
        dataset: {
          type: "population",
          values: [{ ...mobileRevenueOver10, type: "population" }],
        },
      };
      expect(
        populationExplorationConfigValidator.safeParse(standalone).success,
      ).toBe(false);
      expect(
        populationExplorationConfigValidator.safeParse({
          ...standalone,
          dataset: {
            ...standalone.dataset,
            values: [{ ...standalone.dataset.values[0], name: "Mobile users" }],
          },
        }).success,
      ).toBe(true);
    });
  });

  describe("generated SQL", () => {
    it("adds the population as one extra series shared by all metrics", () => {
      const { sql, orderedMetricIds } = generate(
        explore({
          metrics: [purchasers, loggedIn],
          population: mobileRevenueOver10,
        }),
      );
      // The population count isn't returned as a metric, and its columns are
      // named, not numbered after the metrics.
      expect(orderedMetricIds).toEqual([purchasers.id, loggedIn.id]);
      expect(sql).not.toMatch(/\bm2\b/);
      // The population count has no denominator column.
      expect(sql).not.toContain("population_count_denominator");
      // Each metric is read only for members, in a named CTE; no joins.
      expect(sql).toContain("_factTable0_unit0_members AS");
      expect(
        sql.match(
          /WHEN population_count IS NOT NULL\s+AND unit0 IS NOT NULL THEN m[01]\s/g,
        ),
      ).toHaveLength(2);
      expect(sql).not.toContain("JOIN");
    });

    it.each([
      ["without a population", null],
      ["with a population", mobileRevenueOver10],
    ])("matches the snapshot %s", (_, population) => {
      expect(
        generate(explore({ metrics: [purchasers], population })).sql,
      ).toMatchSnapshot();
    });
  });
});

describe("metric explorations without a population", () => {
  // Hand-checked results for each metric type, to show the population changes
  // didn't affect requests without one. Without a population, the NULL user_id
  // row counts as one unit; that's existing behavior.
  it.each<[string, FactMetricInterface, Results]>([
    [
      "proportion",
      purchasers,
      {
        "2026-09-01": { values: [[3, 3]] }, // Alice, Dylan, NULL user
        "2026-09-02": { values: [[2, 2]] }, // Bob, Erin
      },
    ],
    [
      "sum mean",
      revenue,
      {
        "2026-09-01": { values: [[132, 3]] }, // $12 + $21 + $99 over 3 purchasers
        "2026-09-02": { values: [[25, 2]] }, // $5 + $20
      },
    ],
    [
      "distinct-count mean",
      purchaseDevices,
      {
        "2026-09-01": { values: [[3, 3]] },
        "2026-09-02": { values: [[2, 2]] },
      },
    ],
    [
      "ratio",
      revenuePerPurchase,
      {
        "2026-09-01": { values: [[132, 9]] }, // $132 over 9 purchases
        "2026-09-02": { values: [[25, 2]] },
      },
    ],
  ])("reports a %s metric", (_, metric, expected) => {
    expect(run(explore({ metrics: [metric] }))).toEqual(expected);
  });

  it("reports each metric the same whether it runs alone or with others", () => {
    const metrics = [purchasers, loggedIn, revenue, purchaseDevices];
    const together = run(explore({ metrics }));
    metrics.forEach((metric, i) => {
      const alone = run(explore({ metrics: [metric] }));
      Object.entries(alone).forEach(([day, { values }]) => {
        expect(together[day].values[i]).toEqual(values[0]);
      });
    });
    // Login-only users (Carol, Gina, Frank) must not count as zero-device
    // purchasers once login rows are in the same scan.
    expect(together["2026-09-01"].values[3]).toEqual([3, 3]);
  });
});
