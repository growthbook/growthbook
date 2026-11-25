import { generateProductAnalyticsSQL } from "shared/enterprise";
import { createLikeStringMatchFn } from "shared/sql";
import {
  ExplorationConfig,
  ExplorationDateRange,
  PopulationValue,
  ResolvedExplorationPopulation,
} from "shared/validators";
import { SqlDialect } from "shared/types/sql";
import {
  ColumnRef,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";

/*
 * Characterization tests: snapshot the SQL generated for every kind of value a
 * metric can measure (a real column with each aggregation, a pre-built sketch,
 * and the $$count / $$distinctUsers / $$distinctDates special columns) under
 * every metric type the explorer accepts. They pin today's output so the
 * measure code can be restructured without changing the SQL.
 */

// Only the members the explorer's SQL uses. A member it needs but this lacks
// shows up as "undefined" in a snapshot, so add it here.
const dialect = {
  escapeStringLiteral: (value) => value.replace(/'/g, "''"),
  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral: (value) => value,
    emitEscapeClause: false,
  }),
  jsonExtract: (jsonCol, path, isNumeric) =>
    `${jsonCol}:'${path}'::${isNumeric ? "float" : "text"}`,
  evalBoolean: (col, value) => `${col} IS ${value ? "TRUE" : "FALSE"}`,
  dateTrunc: (col, granularity) => `date_trunc('${granularity}', ${col})`,
  concatStrings: (parts) => parts.join(" || "),
  percentileApprox: (col, quantile) => `APPROX_PERCENTILE(${col}, ${quantile})`,
  hllReaggregate: (col) => `HLL_MERGE(${col})`,
  hllCardinality: (col) => `HLL_COUNT(${col})`,
  quantileSketchMergePartial: (col) => `KLL_MERGE(${col})`,
  quantileSketchExtractPoint: (col, quantile) =>
    `KLL_POINT(${col}, ${quantile})`,
  toTimestamp: (d: Date) => `'${d.toISOString().substring(0, 10)} 00:00:00'`,
  identifierQuote: "`",
  formatDialect: "bigquery",
  castToFloat: (col) => `CAST(${col} AS FLOAT)`,
  castToString: (col) => `CAST(${col} AS STRING)`,
} as SqlDialect;

const column = (name: string, datatype: string) => ({
  column: name,
  datatype,
  name,
  description: "",
  numberFormat: "",
  alwaysInlineFilter: false,
  deleted: false,
  autoSlices: [],
  isAutoSliceColumn: false,
  dateCreated: new Date(0),
  dateUpdated: new Date(0),
});

const events = {
  id: "events",
  datasource: "ds",
  name: "Events",
  sql: "SELECT * FROM events",
  userIdTypes: ["user_id"],
  filters: [],
  columns: [
    column("user_id", "string"),
    column("timestamp", "date"),
    column("event_name", "string"),
    column("revenue", "number"),
    column("product_id", "string"),
    column("users_hll", "binary"),
    column("revenue_kll", "binary"),
  ],
} as unknown as FactTableInterface;
const factTableMap = new Map([[events.id, events]]);

const DATE_RANGE: ExplorationDateRange = {
  predefined: "customDateRange",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
};

const purchases = [
  { column: "event_name", operator: "=" as const, values: ["Purchase"] },
];

const ref = (overrides: Partial<ColumnRef>): ColumnRef => ({
  factTableId: "events",
  column: "revenue",
  aggregation: "sum",
  rowFilters: purchases,
  ...overrides,
});

const metric = (
  id: string,
  overrides: Partial<FactMetricInterface>,
): FactMetricInterface =>
  ({
    id,
    datasource: "ds",
    name: id,
    metricType: "mean",
    numerator: ref({}),
    denominator: null,
    cappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "",
      delayUnit: "days",
      delayValue: 0,
      windowUnit: "days",
      windowValue: 0,
    },
    quantileSettings: null,
    ...overrides,
  }) as FactMetricInterface;

function metricSQL(
  metrics: FactMetricInterface[],
  {
    unit = "user_id",
    population = null,
  }: {
    unit?: string | null;
    population?: ResolvedExplorationPopulation | null;
  } = {},
): string {
  const config: ExplorationConfig = {
    type: "metric",
    datasource: "ds",
    chartType: "bigNumber",
    showAs: "total",
    dateRange: DATE_RANGE,
    dimensions: [],
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
      ...(population
        ? { population: { populationId: "pop", unit: population.unit } }
        : {}),
    },
  };
  return generateProductAnalyticsSQL(
    config,
    factTableMap,
    new Map(metrics.map((m) => [m.id, m])),
    dialect,
    {},
    population,
  ).sql;
}

const revenueSum = metric("revenue_sum", {});
const revenueMax = metric("revenue_max", {
  numerator: ref({ aggregation: "max" }),
});
const distinctProducts = metric("distinct_products", {
  numerator: ref({ column: "product_id", aggregation: "count distinct" }),
});
const usersHll = metric("users_hll", {
  numerator: ref({ column: "users_hll", aggregation: "hll merge" }),
});
const purchaseCount = metric("purchase_count", {
  numerator: ref({ column: "$$count" }),
});
const purchaseDays = metric("purchase_days", {
  numerator: ref({ column: "$$distinctDates" }),
});
const purchasers = metric("purchasers", {
  metricType: "proportion",
  numerator: ref({ column: "$$distinctUsers" }),
});

describe("SQL for each kind of measured value", () => {
  describe("mean metrics", () => {
    it.each([
      ["a column summed", revenueSum],
      ["a column maxed", revenueMax],
      ["a column's distinct values counted", distinctProducts],
      ["a pre-built HLL sketch merged", usersHll],
      ["matching rows counted ($$count)", purchaseCount],
      ["distinct days counted ($$distinctDates)", purchaseDays],
    ])("%s", (_, m) => {
      expect(metricSQL([m])).toMatchSnapshot();
    });

    it("a column summed per event, with no unit", () => {
      expect(metricSQL([revenueSum], { unit: null })).toMatchSnapshot();
    });

    it("a pre-built HLL sketch merged per event, with no unit", () => {
      expect(metricSQL([usersHll], { unit: null })).toMatchSnapshot();
    });

    it("a column capped at an absolute value", () => {
      const capped = metric("revenue_capped", {
        cappingSettings: { type: "absolute", value: 100 },
      });
      expect(metricSQL([capped])).toMatchSnapshot();
    });

    it("a column capped at a percentile", () => {
      const capped = metric("revenue_p99_capped", {
        cappingSettings: { type: "percentile", value: 0.99 },
      });
      expect(metricSQL([capped])).toMatchSnapshot();
    });
  });

  describe("daily participation metrics", () => {
    it("distinct days counted ($$distinctDates)", () => {
      const participation = metric("participation", {
        metricType: "dailyParticipation",
        numerator: ref({ column: "$$distinctDates" }),
      });
      expect(metricSQL([participation])).toMatchSnapshot();
    });
  });

  describe("proportion metrics ($$distinctUsers)", () => {
    it("units with a matching row", () => {
      expect(metricSQL([purchasers])).toMatchSnapshot();
    });

    it("units whose row count passes an aggregate filter", () => {
      const repeat = metric("repeat_purchasers", {
        metricType: "proportion",
        numerator: ref({
          column: "$$distinctUsers",
          aggregateFilter: ">=2",
          aggregateFilterColumn: "$$count",
        }),
      });
      expect(metricSQL([repeat])).toMatchSnapshot();
    });

    it("units whose column total passes an aggregate filter", () => {
      const bigSpenders = metric("big_spenders", {
        metricType: "proportion",
        numerator: ref({
          column: "$$distinctUsers",
          aggregateFilter: ">10",
          aggregateFilterColumn: "revenue",
        }),
      });
      expect(metricSQL([bigSpenders])).toMatchSnapshot();
    });
  });

  describe("ratio metrics", () => {
    it("a column sum over a row count", () => {
      const perPurchase = metric("revenue_per_purchase", {
        metricType: "ratio",
        denominator: ref({ column: "$$count" }),
      });
      expect(metricSQL([perPurchase])).toMatchSnapshot();
    });

    it("a column sum over distinct units", () => {
      const perPurchaser = metric("revenue_per_purchaser", {
        metricType: "ratio",
        denominator: ref({ column: "$$distinctUsers" }),
      });
      expect(metricSQL([perPurchaser])).toMatchSnapshot();
    });

    it("a column sum over a row count, per event", () => {
      const perPurchase = metric("revenue_per_purchase", {
        metricType: "ratio",
        denominator: ref({ column: "$$count" }),
      });
      expect(metricSQL([perPurchase], { unit: null })).toMatchSnapshot();
    });
  });

  describe("quantile metrics", () => {
    const quantileSettings = (type: "unit" | "event") => ({
      type,
      quantile: 0.9,
      ignoreZeros: false,
    });

    it("a per-unit quantile of a column sum", () => {
      const p90 = metric("revenue_p90_unit", {
        metricType: "quantile",
        quantileSettings: quantileSettings("unit"),
      } as Partial<FactMetricInterface>);
      expect(metricSQL([p90])).toMatchSnapshot();
    });

    it("a per-event quantile of a column", () => {
      const p90 = metric("revenue_p90_event", {
        metricType: "quantile",
        quantileSettings: quantileSettings("event"),
      } as Partial<FactMetricInterface>);
      expect(metricSQL([p90])).toMatchSnapshot();
    });

    it("a per-event quantile of a pre-built KLL sketch", () => {
      const p90 = metric("revenue_p90_kll", {
        metricType: "quantile",
        numerator: ref({ column: "revenue_kll", aggregation: "kll merge" }),
        quantileSettings: quantileSettings("event"),
      } as Partial<FactMetricInterface>);
      expect(metricSQL([p90])).toMatchSnapshot();
    });
  });

  describe("several metrics on one fact table", () => {
    // Count-like aggregates get a presence column so units without matching
    // rows aren't counted as zero.
    it.each([
      ["a column's distinct values counted", distinctProducts],
      ["a pre-built HLL sketch merged", usersHll],
      ["distinct days counted ($$distinctDates)", purchaseDays],
    ])("%s, next to a column sum", (_, m) => {
      expect(metricSQL([revenueSum, m])).toMatchSnapshot();
    });

    it("every kind of measured value together", () => {
      expect(
        metricSQL([
          revenueSum,
          revenueMax,
          distinctProducts,
          usersHll,
          purchaseCount,
          purchaseDays,
          purchasers,
        ]),
      ).toMatchSnapshot();
    });
  });

  describe("metrics with a Population", () => {
    it("restricts each metric to the Population's members", () => {
      const mobileBigSpenders: ResolvedExplorationPopulation = {
        source: { type: "factTable", factTableId: "events" },
        rowFilters: [
          { column: "event_name", operator: "=", values: ["Purchase"] },
        ],
        aggregateFilter: ">10",
        aggregateFilterColumn: "revenue",
        unit: "user_id",
      };
      expect(
        metricSQL([revenueSum, purchasers], { population: mobileBigSpenders }),
      ).toMatchSnapshot();
    });
  });

  describe("fact table values", () => {
    it("counts rows, sums a column and counts distinct units", () => {
      const config: ExplorationConfig = {
        type: "fact_table",
        datasource: "ds",
        chartType: "bigNumber",
        showAs: "total",
        dateRange: DATE_RANGE,
        dimensions: [],
        dataset: {
          type: "fact_table",
          factTableId: "events",
          values: [
            {
              name: "Purchases",
              type: "fact_table",
              valueType: "count",
              valueColumn: null,
              unit: "user_id",
              rowFilters: purchases,
            },
            {
              name: "Revenue",
              type: "fact_table",
              valueType: "sum",
              valueColumn: "revenue",
              unit: "user_id",
              rowFilters: purchases,
            },
            {
              name: "Purchasers",
              type: "fact_table",
              valueType: "unit_count",
              valueColumn: null,
              unit: "user_id",
              rowFilters: purchases,
            },
          ],
        },
      };
      expect(
        generateProductAnalyticsSQL(
          config,
          factTableMap,
          new Map(),
          dialect,
          {},
        ).sql,
      ).toMatchSnapshot();
    });
  });

  describe("Population values", () => {
    const population = (
      overrides: Partial<PopulationValue>,
    ): PopulationValue => ({
      type: "population",
      name: "Purchasers",
      unit: "user_id",
      source: { type: "factTable", factTableId: "events" },
      rowFilters: purchases,
      ...overrides,
    });

    it.each([
      ["with a matching row", population({})],
      [
        "whose row count passes an aggregate filter",
        population({
          aggregateFilter: ">=2",
          aggregateFilterColumn: "$$count",
        }),
      ],
      [
        "whose column total passes an aggregate filter",
        population({
          aggregateFilter: ">10",
          aggregateFilterColumn: "revenue",
        }),
      ],
    ])("counts units %s", (_, value) => {
      const config: ExplorationConfig = {
        type: "population",
        datasource: "ds",
        chartType: "bigNumber",
        dateRange: DATE_RANGE,
        dimensions: [],
        dataset: { type: "population", values: [value] },
      };
      expect(
        generateProductAnalyticsSQL(
          config,
          factTableMap,
          new Map(),
          dialect,
          {},
        ).sql,
      ).toMatchSnapshot();
    });
  });
});

describe("SQL for each kind of measured value, continued", () => {
  it("a retention metric's distinct units", () => {
    const retained = metric("retained", {
      metricType: "retention",
      numerator: ref({ column: "$$distinctUsers" }),
    });
    expect(metricSQL([retained])).toMatchSnapshot();
  });

  // Data source and SQL datasets build their fact table from the dataset's
  // column types, and take unit columns from the data source's settings.
  const datasource = {
    settings: { userIdTypes: [{ userIdType: "user_id" }] },
  } as Parameters<typeof generateProductAnalyticsSQL>[4];
  const columnTypes = {
    user_id: "string",
    timestamp: "date",
    event_name: "string",
    revenue: "number",
  } as const;

  function simpleValues<T extends "data_source" | "sql">(
    type: T,
    unit: string | null,
  ) {
    return [
      { name: "Purchases", valueType: "count", valueColumn: null },
      { name: "Revenue", valueType: "sum", valueColumn: "revenue" },
      { name: "Purchasers", valueType: "unit_count", valueColumn: null },
    ].map((v) => ({
      ...v,
      type,
      unit,
      rowFilters: purchases,
      valueType: v.valueType as "count" | "sum" | "unit_count",
    }));
  }

  function simpleSQL(dataset: ExplorationConfig["dataset"]): string {
    const config = {
      type: dataset.type,
      datasource: "ds",
      chartType: "bigNumber",
      showAs: "total",
      dateRange: DATE_RANGE,
      dimensions: [],
      dataset,
    } as ExplorationConfig;
    return generateProductAnalyticsSQL(
      config,
      factTableMap,
      new Map(),
      dialect,
      datasource,
    ).sql;
  }

  describe("data source values", () => {
    it.each([
      ["per unit", "user_id"],
      ["per event, with no unit", null],
    ])(
      "counts rows, sums a column and counts distinct units, %s",
      (_, unit) => {
        expect(
          simpleSQL({
            type: "data_source",
            table: "events",
            path: "analytics.events",
            timestampColumn: "timestamp",
            columnTypes,
            values: simpleValues("data_source", unit),
          }),
        ).toMatchSnapshot();
      },
    );
  });

  describe("SQL values", () => {
    it.each([
      ["with a timestamp column", "timestamp"],
      ["without a timestamp column", null],
    ])("counts rows, sums a column and counts distinct units, %s", (_, ts) => {
      expect(
        simpleSQL({
          type: "sql",
          sql: "SELECT * FROM events;",
          timestampColumn: ts,
          columnTypes,
          values: simpleValues("sql", "user_id"),
        }),
      ).toMatchSnapshot();
    });
  });
});

/*
 * orderedMetricIds becomes each result row's values[].metricId. Simple values
 * (fact table, data source, SQL) get a made-up id that includes Date.now(), so
 * the clock is frozen here.
 */
describe("orderedMetricIds", () => {
  const NOW = new Date("2026-01-01T00:00:00Z");
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const ids = (
    config: ExplorationConfig,
    metrics: FactMetricInterface[] = [],
    population: ResolvedExplorationPopulation | null = null,
  ) =>
    generateProductAnalyticsSQL(
      config,
      factTableMap,
      new Map(metrics.map((m) => [m.id, m])),
      dialect,
      { settings: { userIdTypes: [{ userIdType: "user_id" }] } },
      population,
    ).orderedMetricIds;

  const base = {
    datasource: "ds",
    chartType: "bigNumber",
    showAs: "total",
    dateRange: DATE_RANGE,
    dimensions: [],
  } satisfies Partial<ExplorationConfig>;
  const simple = [
    { name: "Purchases", valueType: "count", valueColumn: null },
    { name: "Revenue", valueType: "sum", valueColumn: "revenue" },
  ] as const;
  const simpleIds = [
    `simple_Purchases_${NOW.getTime()}`,
    `simple_Revenue_${NOW.getTime()}`,
  ];

  it("lists metric ids in order, once per ratio, without the Population count", () => {
    const perPurchase = metric("revenue_per_purchase", {
      metricType: "ratio",
      denominator: ref({ column: "$$count" }),
    });
    const metrics = [revenueSum, perPurchase, purchasers];
    const config: ExplorationConfig = {
      ...base,
      type: "metric",
      dataset: {
        type: "metric",
        values: metrics.map((m) => ({
          type: "metric",
          metricId: m.id,
          name: m.name,
          unit: "user_id",
          denominatorUnit: m.metricType === "ratio" ? "user_id" : null,
          rowFilters: [],
        })),
        population: { populationId: "pop", unit: "user_id" },
      },
    };
    const population: ResolvedExplorationPopulation = {
      source: { type: "factTable", factTableId: "events" },
      rowFilters: purchases,
      unit: "user_id",
    };
    expect(ids(config, metrics, population)).toEqual([
      "revenue_sum",
      "revenue_per_purchase",
      "purchasers",
    ]);
  });

  it("gives fact table, data source and SQL values a timestamped simple_ id", () => {
    const values = <T extends "fact_table" | "data_source" | "sql">(type: T) =>
      simple.map((v) => ({ ...v, type, unit: "user_id", rowFilters: [] }));
    const datasets: ExplorationConfig["dataset"][] = [
      {
        type: "fact_table",
        factTableId: "events",
        values: values("fact_table"),
      },
      {
        type: "data_source",
        table: "events",
        path: "analytics.events",
        timestampColumn: "timestamp",
        columnTypes: { user_id: "string", revenue: "number" },
        values: values("data_source"),
      },
      {
        type: "sql",
        sql: "SELECT * FROM events",
        timestampColumn: "timestamp",
        columnTypes: { user_id: "string", revenue: "number" },
        values: values("sql"),
      },
    ];
    for (const dataset of datasets) {
      expect(
        ids({ ...base, type: dataset.type, dataset } as ExplorationConfig),
      ).toEqual(simpleIds);
    }
  });

  it("numbers Population values population_0, population_1, ...", () => {
    const value = (name: string): PopulationValue => ({
      type: "population",
      name,
      unit: "user_id",
      source: { type: "factTable", factTableId: "events" },
      rowFilters: purchases,
    });
    expect(
      ids({
        datasource: "ds",
        chartType: "bigNumber",
        dateRange: DATE_RANGE,
        dimensions: [],
        type: "population",
        dataset: { type: "population", values: [value("A"), value("B")] },
      }),
    ).toEqual(["population_0", "population_1"]);
  });
});
