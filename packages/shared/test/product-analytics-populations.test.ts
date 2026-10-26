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
  name: "Mobile users",
  source: { type: "factTable", factTableId: "events" },
  rowFilters: [{ column: "device_type", operator: "=", values: ["mobile"] }],
  aggregateFilter: ">10",
  aggregateFilterColumn: "revenue",
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
        population,
      },
    ],
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
        values: c.dataset.values.map((v, i) =>
          i === 0 && v.population ? { ...v, population: p } : v,
        ),
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
  it("counts eligible units once, includes non-converters, and excludes outsiders and null identifiers", () => {
    const rows = execute();
    const dailyPopulationResults = rows.map((row) => row.values?.[0]);
    expect(dailyPopulationResults).toEqual([
      {
        metricId: metric.id,
        numerator: 1,
        denominator: 2,
        denominatorType: "population" as const,
      },
      {
        metricId: metric.id,
        numerator: 0,
        denominator: 1,
        denominatorType: "population" as const,
      },
      {
        metricId: metric.id,
        numerator: 0,
        denominator: 0,
        denominatorType: "population" as const,
      },
    ]);
  });

  it("evaluates membership across the selected range for an overall total", () => {
    const rows = execute({ ...config, dimensions: [], chartType: "bigNumber" });
    const overallPopulationResult = rows[0].values?.[0];
    expect(overallPopulationResult).toMatchObject({
      numerator: 1,
      denominator: 2,
    });
  });

  it("keeps ordinary and population-backed series independent", () => {
    const c: MetricExplorationConfig = {
      ...config,
      dataset: {
        type: "metric",
        values: [
          config.dataset.values[0],
          { ...config.dataset.values[0], population: null },
        ],
      },
    };
    const rows = execute(c);
    const septemberFirstPopulationResult = rows[0].values?.[0];
    const septemberFirstOrdinaryResult = rows[0].values?.[1];
    expect(septemberFirstPopulationResult).toMatchObject({
      numerator: 1,
      denominator: 2,
    });
    // The existing no-population SQL includes the null-identifier group; do not change it here.
    expect(septemberFirstOrdinaryResult).toEqual({
      metricId: metric.id,
      numerator: 4,
      denominator: 4,
    });
  });

  describe.each([
    {
      name: "proportion",
      ordinaryMetric: { ...metric, id: "ordinary" },
    },
    {
      name: "sum-based mean",
      ordinaryMetric: {
        ...metric,
        id: "ordinary",
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
      ordinaryMetric: {
        ...metric,
        id: "ordinary",
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
      ordinaryMetric: {
        ...metric,
        id: "ordinary",
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
  ])("ordinary $name independence", ({ ordinaryMetric }) => {
    it.each(["daily", "overall"])(
      "preserves the complete %s result when a population-backed series is added",
      (grouping) => {
        const ordinary = ordinaryMetric as FactMetricInterface;
        const value = {
          ...config.dataset.values[0],
          metricId: ordinary.id,
          population: null,
          denominatorUnit: ordinary.metricType === "ratio" ? "user_id" : null,
        };
        const standalone: MetricExplorationConfig = {
          ...config,
          dimensions: grouping === "daily" ? config.dimensions : [],
          chartType: grouping === "daily" ? "line" : "bigNumber",
          dataset: { type: "metric", values: [value] },
        };
        const combined: MetricExplorationConfig = {
          ...standalone,
          dataset: {
            type: "metric",
            values: [config.dataset.values[0], value],
          },
        };
        const alone = execute(standalone, population, ordinary);
        const together = execute(combined, population, metric, [ordinary]);
        expect(alone).toHaveLength(grouping === "daily" ? 3 : 1);
        const ordinaryResultsAlongsidePopulation = together.map((row) => ({
          dimensions: row.dimensions,
          value: row.values?.[1],
        }));
        const ordinaryResultsAlone = alone.map((row) => ({
          dimensions: row.dimensions,
          value: row.values?.[0],
        }));
        expect(ordinaryResultsAlongsidePopulation).toEqual(
          ordinaryResultsAlone,
        );
      },
    );
  });

  it("does not add population-only users to a neighboring distinct-count mean", () => {
    const other: FactMetricInterface = {
      ...metric,
      id: "distinct",
      metricType: "mean",
      numerator: {
        ...metric.numerator!,
        column: "revenue",
        aggregation: "count distinct",
      },
    } as FactMetricInterface;
    const c: MetricExplorationConfig = {
      ...config,
      dataset: {
        type: "metric",
        values: [
          config.dataset.values[0],
          {
            ...config.dataset.values[0],
            metricId: other.id,
            population: null,
          },
        ],
      },
    };
    const rows = execute(c, population, metric, [other]);
    const septemberFirstDistinctCountResult = rows[0].values?.[1];
    expect(septemberFirstDistinctCountResult).toMatchObject({
      numerator: 4,
      denominator: 4,
    });
  });

  it("excludes users with no population-matching activity even when the threshold accepts zero", () => {
    const p = structuredClone(population);
    p.aggregateFilter = "<=0";
    const rows = execute(config, p);
    const septemberThirdPopulationResult = rows[2].values?.[0];
    expect(septemberThirdPopulationResult).toMatchObject({
      numerator: 0,
      denominator: 1,
    });
  });

  it("supports population row filters without an aggregate condition", () => {
    const p = structuredClone(population);
    delete p.aggregateFilter;
    delete p.aggregateFilterColumn;
    const septemberFirstPopulationResult = execute(config, p)[0].values?.[0];
    expect(septemberFirstPopulationResult).toMatchObject({
      numerator: 2,
      denominator: 3,
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
      denominator: 2,
    });
  });

  it("returns an empty population denominator when no events match the date range", () => {
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
    expect(emptyPopulationResult.denominator ?? 0).toBe(0);
    expect(emptyPopulationResult.denominatorType).toBe("population");
  });

  it("includes only requested metrics in orderedMetricIds", () => {
    expect(query().orderedMetricIds).toEqual([metric.id]);
  });

  it("keeps two population selections independent in the same scan", () => {
    const other = structuredClone(population);
    other.name = "Everyone";
    other.rowFilters = [];
    delete other.aggregateFilter;
    delete other.aggregateFilterColumn;
    const c = {
      ...config,
      dataset: {
        ...config.dataset,
        values: [
          config.dataset.values[0],
          { ...config.dataset.values[0], population: other },
        ],
      },
    };
    const { sql, orderedMetricIds } = generateProductAnalyticsSQL(
      c,
      new Map([[table.id, table]]),
      new Map([[metric.id, metric]]),
      dialect,
      {},
    );
    expect(orderedMetricIds).toEqual([metric.id, metric.id]);
    expect(sql).toContain("pop0");
    expect(sql).toContain("pop1");
    expect(sql).not.toContain("JOIN");
    const rows = execute(c);
    const septemberFirstPopulationCounts = rows[0].values?.map((value) => [
      value.numerator,
      value.denominator,
    ]);
    expect(septemberFirstPopulationCounts).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("preserves the population in serialized URLs and config schemas", () => {
    const parsed = explorationConfigValidator.parse(
      decodeExplorationConfigJson(encodeExplorationConfig(config)),
    );
    expect(parsed).toEqual(config);
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
      ).toThrow("Populations currently support only proportion metrics.");
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
    ).toThrow("Populations currently support only proportion metrics.");
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
      "identifier",
    );
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
      "identifier",
    );
    expect(() =>
      validate(config, { ...population, aggregateFilter: "invalid" }),
    ).toThrow("Invalid aggregate filter");
  });
});
