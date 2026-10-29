import { DatabaseSync } from "node:sqlite";
import {
  generateProductAnalyticsSQL,
  transformProductAnalyticsRowsToResult,
  encodeExplorationConfig,
  decodeExplorationConfigJson,
  validatePopulationMetricCompatibility,
} from "shared/enterprise";
import { createLikeStringMatchFn } from "shared/sql";
import {
  MetricExplorationConfig,
  MetricPopulation,
  metricPopulationValidator,
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
const metric = {
  id: "conversion",
  datasource: "ds",
  name: "Users who purchased",
  metricType: "proportion",
  numerator: {
    factTableId: "events",
    column: "$$distinctUsers",
    rowFilters: [{ column: "event_name", operator: "=", values: ["Purchase"] }],
  },
  denominator: null,
  cappingSettings: { type: "", value: 0 },
  quantileSettings: null,
} as FactMetricInterface;
const population: MetricPopulation = {
  source: { type: "factTable", factTableId: "events" },
  rowFilters: [{ column: "device_type", operator: "=", values: ["mobile"] }],
  aggregateFilter: ">10",
  aggregateFilterColumn: "revenue",
  unit: "user_id",
};
const config: MetricExplorationConfig = {
  type: "metric",
  datasource: "ds",
  chartType: "line",
  showAs: "total",
  dateRange: {
    predefined: "customDateRange",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
  },
  dimensions: [{ dimensionType: "date", column: null, dateGranularity: "day" }],
  dataset: {
    type: "metric",
    values: [
      {
        type: "metric",
        metricId: metric.id,
        name: "Conversion",
        unit: "user_id",
        denominatorUnit: null,
        rowFilters: [],
      },
    ],
    population,
  },
};
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
  toTimestamp: (d) => `'${d.toISOString().slice(0, 10)}'`,
  formatDialect: "sqlite",
  castToFloat: (col) => `CAST(${col} AS REAL)`,
  castToString: (col) => `CAST(${col} AS TEXT)`,
};
function query(
  c = config,
  p = population,
  m = metric,
  otherMetrics: FactMetricInterface[] = [],
) {
  return generateProductAnalyticsSQL(
    {
      ...c,
      dataset: {
        ...c.dataset,
        population: c.dataset.population ? p : c.dataset.population,
      },
    },
    new Map([[table.id, table]]),
    new Map([m, ...otherMetrics].map((m) => [m.id, m])),
    dialect,
    {},
  );
}
function execute(
  c = config,
  p = population,
  m = metric,
  otherMetrics: FactMetricInterface[] = [],
) {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE events(user_id TEXT, timestamp TEXT, revenue REAL, device_type TEXT, event_name TEXT);
      INSERT INTO events VALUES
        ('a', '2026-09-01', 6, 'mobile', 'Subscription Renewal'),
        ('a', '2026-09-01', 6, 'mobile', 'Subscription Renewal'),
        ('a', '2026-09-01', 0, 'desktop', 'Purchase'),
        ('a', '2026-09-01', 0, 'desktop', 'Purchase'),
        ('b', '2026-09-01', 20, 'mobile', 'Subscription Renewal'),
        ('c', '2026-09-01', 0, 'desktop', 'Purchase'),
        ('d', '2026-09-01', 5, 'mobile', 'Purchase'),
        (NULL, '2026-09-01', 99, 'mobile', 'Purchase'),
        ('a', '2026-09-02', 5, 'mobile', 'Purchase'),
        ('b', '2026-09-02', 20, 'mobile', 'Subscription Renewal'),
        ('e', '2026-09-03', 0, 'mobile', 'Subscription Renewal'),
        ('c', '2026-09-03', 0, 'desktop', 'Purchase');`);
    const { sql, orderedMetricIds } = query(c, p, m, otherMetrics);
    return transformProductAnalyticsRowsToResult(
      c,
      db.prepare(sql).all(),
      orderedMetricIds,
    ).rows.sort((a, b) =>
      String(a.dimensions[0]).localeCompare(String(b.dimensions[0])),
    );
  } finally {
    db.close();
  }
}

describe("population-backed proportions", () => {
  it.each(["daily", "overall"])(
    "averages eight purchases over two purchasers independently of companion series without a population (%s)",
    (grouping) => {
      const purchase: FactMetricInterface = {
        ...metric,
        id: "purchase_count",
        metricType: "mean",
        numerator: {
          ...metric.numerator!,
          column: "revenue",
          aggregation: "count distinct",
        },
      };
      const login: FactMetricInterface = {
        ...metric,
        id: "login",
        numerator: {
          ...metric.numerator!,
          rowFilters: [
            { column: "event_name", operator: "=", values: ["Login"] },
          ],
        },
      };
      const value = { ...config.dataset.values[0], metricId: purchase.id };
      const loginValue = { ...value, metricId: login.id };
      const db = new DatabaseSync(":memory:");
      try {
        db.exec(`CREATE TABLE events(user_id TEXT, timestamp TEXT, revenue REAL, device_type TEXT, event_name TEXT);
          INSERT INTO events VALUES
          ('Alice','2026-09-01',1,'mobile','Purchase'),
          ('Alice','2026-09-01',2,'mobile','Purchase'),
          ('Bob','2026-09-01',0,'mobile','Login'),
          ('Dylan','2026-09-01',1,'mobile','Purchase'),
          ('Dylan','2026-09-01',2,'mobile','Purchase'),
          ('Dylan','2026-09-01',3,'mobile','Purchase'),
          ('Dylan','2026-09-01',4,'mobile','Purchase'),
          ('Dylan','2026-09-01',5,'mobile','Purchase'),
          ('Dylan','2026-09-01',6,'mobile','Purchase');`);
        for (const values of [[value], [value, loginValue]]) {
          const c: MetricExplorationConfig = {
            ...config,
            dimensions: grouping === "daily" ? config.dimensions : [],
            showAs: "per_unit",
            dataset: { type: "metric", values },
          };
          const { sql, orderedMetricIds } = query(c, population, purchase, [
            login,
          ]);
          const result = transformProductAnalyticsRowsToResult(
            c,
            db.prepare(sql).all(),
            orderedMetricIds,
          );
          expect(result.rows[0].values?.[0]).toMatchObject({
            numerator: 8,
            denominator: 2,
          });
        }
      } finally {
        db.close();
      }
    },
  );

  describe("generated daily SQL (SQLite)", () => {
    it.each([
      { name: "without a population", selectedPopulation: null },
      {
        name: "with the mobile revenue population",
        selectedPopulation: population,
      },
    ])("matches the query $name", ({ selectedPopulation }) => {
      const dailyConfig: MetricExplorationConfig = {
        ...config,
        dataset: { ...config.dataset, population: selectedPopulation },
      };
      const { sql } = query(dailyConfig);
      expect(sql).toMatchSnapshot();
    });
  });

  it("counts eligible units once, includes non-converters, and excludes outsiders and null identifiers", () => {
    const rows = execute();
    const dailyPopulationResults = rows.map((row) => row.values?.[0]);
    expect(dailyPopulationResults).toEqual([
      { metricId: metric.id, numerator: 1, denominator: 1, populationCount: 2 },
      { metricId: metric.id, numerator: 0, denominator: 0, populationCount: 1 },
      { metricId: metric.id, numerator: 0, denominator: 0, populationCount: 0 },
    ]);
  });

  it("evaluates membership across the selected range for an overall total", () => {
    const rows = execute({ ...config, dimensions: [], chartType: "bigNumber" });
    const overallPopulationResult = rows[0].values?.[0];
    expect(overallPopulationResult).toMatchObject({
      numerator: 1,
      denominator: 1,
      populationCount: 2,
    });
  });

  it("applies the population to every metric in the request", () => {
    const renewal: FactMetricInterface = {
      ...metric,
      id: "renewal",
      numerator: {
        ...metric.numerator!,
        rowFilters: [
          {
            column: "event_name",
            operator: "=",
            values: ["Subscription Renewal"],
          },
        ],
      },
    };
    const c: MetricExplorationConfig = {
      ...config,
      dataset: {
        ...config.dataset,
        values: [
          config.dataset.values[0],
          { ...config.dataset.values[0], metricId: renewal.id },
        ],
      },
    };
    const { sql, orderedMetricIds } = query(c, population, metric, [renewal]);
    expect(orderedMetricIds).toEqual([metric.id, renewal.id]);
    // Membership is one extra series after the metrics, shared by all of them.
    expect(sql.match(/ AS m2_rows\b/g)).toHaveLength(1);
    expect(sql).not.toContain("m3");
    expect(
      sql.match(/WHEN m2 = 1\s+AND unit0 IS NOT NULL THEN m[01]\s/g),
    ).toHaveLength(2);
    expect(sql).not.toContain("JOIN");
    const septemberFirstCounts = execute(c, population, metric, [
      renewal,
    ])[0].values?.map((value) => [
      value.numerator,
      value.denominator,
      value.populationCount,
    ]);
    expect(septemberFirstCounts).toEqual([
      [1, 1, 2],
      [2, 2, 2],
    ]);
  });

  it.each(["daily", "overall"])(
    "keeps mixed ordinary averages independent for %s queries",
    (grouping) => {
      const purchase: FactMetricInterface = {
        ...metric,
        id: "purchase_distinct",
        metricType: "mean",
        numerator: {
          ...metric.numerator!,
          column: "revenue",
          aggregation: "count distinct",
        },
      };
      const renewal: FactMetricInterface = {
        ...purchase,
        id: "renewal_distinct",
        numerator: {
          ...purchase.numerator!,
          rowFilters: [
            {
              column: "event_name",
              operator: "=",
              values: ["Subscription Renewal"],
            },
            { column: "revenue", operator: ">", values: ["10"] },
          ],
        },
      };
      const ordinary: MetricExplorationConfig = {
        ...config,
        dimensions: grouping === "daily" ? config.dimensions : [],
        showAs: "per_unit",
        dataset: {
          type: "metric",
          values: [purchase, renewal].map((m) => ({
            ...config.dataset.values[0],
            metricId: m.id,
          })),
        },
      };
      const standalone: MetricExplorationConfig = {
        ...ordinary,
        dataset: { type: "metric", values: [ordinary.dataset.values[0]] },
      };
      const alone = execute(standalone, population, purchase);
      const together = execute(ordinary, population, purchase, [renewal]);
      expect(together[0].values?.[0]).toMatchObject({
        numerator: grouping === "daily" ? 4 : 5,
        denominator: 4,
      });
      expect(together[0].values?.[0]).not.toHaveProperty("populationCount");
      expect(
        together.map((row) => ({ ...row, values: row.values?.slice(0, 1) })),
      ).toEqual(alone);
    },
  );

  describe.each([
    {
      name: "sum-based mean",
      otherMetric: {
        ...metric,
        id: "other",
        name: "Revenue",
        metricType: "mean",
        numerator: {
          ...metric.numerator!,
          column: "revenue",
          aggregation: "sum",
        },
      },
    },
    {
      name: "distinct-count mean",
      otherMetric: {
        ...metric,
        id: "other",
        name: "Revenue",
        metricType: "mean",
        numerator: {
          ...metric.numerator!,
          column: "revenue",
          aggregation: "count distinct",
        },
      },
    },
    {
      name: "ratio",
      otherMetric: {
        ...metric,
        id: "other",
        name: "Revenue",
        metricType: "ratio",
        numerator: {
          ...metric.numerator!,
          column: "revenue",
          aggregation: "sum",
        },
        denominator: {
          ...metric.numerator!,
          column: "$$count",
          aggregation: "sum",
        },
      },
    },
  ])("population with a proportion and a $name", ({ otherMetric }) => {
    it.each(["first", "last"])(
      "rejects the request when the unsupported metric is %s",
      (position) => {
        const other = otherMetric as FactMetricInterface;
        const otherValue = {
          ...config.dataset.values[0],
          metricId: other.id,
          denominatorUnit: other.metricType === "ratio" ? "user_id" : null,
        };
        const values =
          position === "first"
            ? [otherValue, config.dataset.values[0]]
            : [config.dataset.values[0], otherValue];
        const c: MetricExplorationConfig = {
          ...config,
          dataset: { ...config.dataset, values },
        };
        expect(() => query(c, population, metric, [other])).toThrow(
          'Metric "Revenue" can\'t be combined with a Population.',
        );
        // The same metrics are valid together without a population.
        expect(() =>
          query(
            { ...c, dataset: { ...c.dataset, population: null } },
            population,
            metric,
            [other],
          ),
        ).not.toThrow();
      },
    );
  });

  it("excludes users with no population-matching activity even when the threshold accepts zero", () => {
    const p = structuredClone(population);
    p.aggregateFilter = "<=0";
    const rows = execute(config, p);
    const septemberThirdPopulationResult = rows[2].values?.[0];
    expect(septemberThirdPopulationResult).toMatchObject({
      numerator: 0,
      denominator: 0,
      populationCount: 1,
    });
  });

  it("supports population row filters without an aggregate condition", () => {
    const p = structuredClone(population);
    delete p.aggregateFilter;
    delete p.aggregateFilterColumn;
    const septemberFirstPopulationResult = execute(config, p)[0].values?.[0];
    expect(septemberFirstPopulationResult).toMatchObject({
      numerator: 2,
      denominator: 2,
      populationCount: 3,
    });
  });

  it("counts population members who have at least two matching events", () => {
    const p = structuredClone(population);
    p.aggregateFilter = ">=2";
    p.aggregateFilterColumn = "$$count";
    const septemberFirstPopulationResult = execute(config, p)[0].values?.[0];
    expect(septemberFirstPopulationResult).toMatchObject({
      numerator: 1,
      denominator: 1,
      populationCount: 1,
    });
  });

  it("counts only population members with at least two purchases in the numerator", () => {
    const m = structuredClone(metric);
    if (!m.numerator) throw new Error("Missing numerator");
    m.numerator.aggregateFilter = ">=2";
    m.numerator.aggregateFilterColumn = "$$count";
    const septemberFirstRepeatPurchaserResult = execute(
      config,
      population,
      m,
    )[0].values?.[0];
    expect(septemberFirstRepeatPurchaserResult).toMatchObject({
      numerator: 1,
      denominator: 1,
      populationCount: 2,
    });
  });

  it("returns an empty population count when no events match the date range", () => {
    const c = {
      ...config,
      dimensions: [],
      dateRange: {
        predefined: "customDateRange" as const,
        startDate: "2025-01-01",
        endDate: "2025-01-02",
      },
    };
    const emptyPopulationResult = execute(c)[0].values![0];
    expect(emptyPopulationResult).toHaveProperty("populationCount");
    expect(emptyPopulationResult.populationCount ?? 0).toBe(0);
  });

  it("includes only requested metrics in orderedMetricIds", () => {
    expect(query().orderedMetricIds).toEqual([metric.id]);
  });

  it("preserves the population in serialized URLs, public configs, and stored explorations", () => {
    const parsed = explorationConfigValidator.parse(
      decodeExplorationConfigJson(encodeExplorationConfig(config)),
    );
    expect(parsed).toEqual(config);
    expect(
      productAnalyticsExplorationValidator.shape.config.parse(config),
    ).toEqual(config);
  });

  it("normalizes omitted population filters to an empty array", () => {
    const input = {
      ...config,
      dataset: {
        ...config.dataset,
        population: { source: population.source, unit: "user_id" },
      },
    };
    const explicit = structuredClone(config);
    explicit.dataset.population = {
      source: population.source,
      rowFilters: [],
      unit: "user_id",
    };
    expect(explorationConfigValidator.parse(input)).toEqual(
      explorationConfigValidator.parse(explicit),
    );
    expect(
      metricPopulationValidator.parse({
        source: population.source,
        unit: "user_id",
      }),
    ).toEqual({ source: population.source, rowFilters: [], unit: "user_id" });
  });

  it("rejects names on attached populations but requires them on standalone series", () => {
    expect(metricPopulationValidator.parse(population)).toEqual(population);
    const c = structuredClone(config);
    c.dataset.population = {
      ...population,
      name: "Mobile users",
    } as MetricPopulation;
    expect(explorationConfigValidator.safeParse(c).success).toBe(false);
    const standalone = {
      ...config,
      type: "population",
      dataset: {
        type: "population",
        values: [{ ...population, type: "population", unit: "user_id" }],
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

  it.each(metricTypeValidator.options.filter((type) => type !== "proportion"))(
    "rejects a population attached to a %s metric",
    (metricType) => {
      const unsupportedMetric = {
        ...metric,
        metricType,
        numerator: metricType === "funnel" ? null : metric.numerator,
      } as FactMetricInterface;
      expect(() =>
        validatePopulationMetricCompatibility(
          config,
          config.dataset.values[0],
          unsupportedMetric,
          population,
          table,
        ),
      ).toThrow("Populations currently support only proportion metrics");
    },
  );

  it("rejects a proportion metric whose numerator does not count distinct users", () => {
    const invalidMetric = {
      ...metric,
      numerator: { ...metric.numerator!, column: "revenue" },
    } as FactMetricInterface;
    expect(() =>
      validatePopulationMetricCompatibility(
        config,
        config.dataset.values[0],
        invalidMetric,
        population,
        table,
      ),
    ).toThrow("Populations currently support only proportion metrics");
  });

  it("rejects unsupported inline population configurations", () => {
    const validate = (
      c = config,
      p = population,
      m = metric,
      unit: string | null = "user_id",
    ) =>
      validatePopulationMetricCompatibility(
        c,
        { ...c.dataset.values[0], unit },
        m,
        p,
        table,
      );
    expect(() => validate(config, population, metric, null)).toThrow(
      'Metric "Users who purchased" must use the population\'s identifier type "user_id".',
    );
    expect(() =>
      validate(
        config,
        { ...population, unit: "anonymous_id" },
        metric,
        "anonymous_id",
      ),
    ).toThrow(
      "The population's identifier type \"anonymous_id\" isn't supported by the Fact Table.",
    );
    expect(() =>
      metricPopulationValidator.parse({ source: population.source }),
    ).toThrow();
    const p = structuredClone(population);
    p.source.factTableId = "other";
    expect(() => validate(config, p)).toThrow("same Fact Table");
    expect(() =>
      metricPopulationValidator.parse({
        ...population,
        windowSettings: { type: "lookback" },
      }),
    ).toThrow();
    expect(() =>
      metricPopulationValidator.parse({ ...population, steps: [] }),
    ).toThrow();
    expect(() =>
      validate({
        ...config,
        dimensions: [
          { dimensionType: "dynamic", column: "device_type", maxValues: 5 },
        ],
      }),
    ).toThrow("grouped by date");
    expect(() => validate(config, population, metric, "other")).toThrow(
      "must use the population's identifier type",
    );
    expect(() =>
      validate(config, { ...population, aggregateFilter: "invalid" }),
    ).toThrow("Invalid aggregate filter");
  });
});
