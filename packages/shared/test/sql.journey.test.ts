import {
  buildJourneySql,
  transformJourneyRowsToResult,
  isJourneySupportedDatasourceType,
  JOURNEY_SUPPORTED_DATASOURCE_TYPES,
} from "shared/enterprise";
import {
  canIncreaseJourneyOptions,
  isJourneyDatasetRunnable,
  journeyCacheCandidateVerdict,
  journeyMinUnusedLookahead,
  compareJourneyStepValues,
  journeyResultCanServe,
  journeyDisplayLookaheadDepth,
  projectJourneyRows,
  toClientJourneyExploration,
  journeyResultToStepValues,
  maxJourneyPathRows,
  maxJourneyResultRows,
  validateJourneyDataset,
  validateJourneyStepColumns,
  withJourneyOptionsAt,
  MAX_JOURNEY_RESULT_ROWS,
} from "shared/journeys";
import { createLikeMatchFns } from "shared/sql";
import { ExplorationConfig, JourneyPathStep } from "shared/validators";
import { DataSourceType } from "shared/types/datasource";
import { SqlDialect } from "shared/types/sql";
import { FactTableInterface } from "shared/types/fact-table";

const helpers: SqlDialect = {
  escapeStringLiteral: (value) => value.replace(/'/g, `''`),
  // Real matchers rather than stubs, so grouping tests exercise the actual
  // wildcard-to-LIKE translation and its escaping.
  ...createLikeMatchFns({
    escapeStringLiteral: (value) => value.replace(/'/g, `''`),
    emitEscapeClause: true,
  }),
  jsonExtract: (jsonCol, path, isNumeric) =>
    `${jsonCol}:'${path}'::${isNumeric ? "float" : "text"}`,
  evalBoolean: (col, value) => `${col} IS ${value ? "TRUE" : "FALSE"}`,
  dateTrunc: (col, granularity) => `date_trunc('${granularity}', ${col})`,
  dateDiff: (a, b) => `datediff(day, ${a}, ${b})`,
  dateDiffMs: (a, b) => `(EXTRACT(EPOCH FROM (${b} - ${a})) * 1000)`,
  concatStrings: (parts) => parts.join(" || "),
  addIntervalSeconds: (col, sign, amount) =>
    `${col} ${sign} INTERVAL '${amount} seconds'`,
  percentileApprox: (col, q) => `APPROX_PERCENTILE(${col}, ${q})`,
  toTimestamp: (d) => `'${d.toISOString().substring(0, 10)} 00:00:00'`,
  castToFloat: (col) => `CAST(${col} AS FLOAT)`,
  castToString: (col) => `cast(${col} as varchar)`,
  castToDate: (col) => `CAST(${col} AS DATE)`,
  castToTimestamp: (col) => `CAST(${col} AS TIMESTAMP)`,
  castUserDateCol: (col) => col,
  arrayAggSorted: (col) =>
    `ARRAY_AGG(${col} ORDER BY ${col}) FILTER (WHERE ${col} IS NOT NULL)`,
  argMinByTimestamp: (valueCol, tsCol) =>
    `(ARRAY_AGG(${valueCol} ORDER BY ${tsCol}) FILTER (WHERE ${tsCol} IS NOT NULL))[1]`,
  arrayMinInRange: (col, lower, upper) => {
    const conds: string[] = [];
    if (lower) conds.push(`t >= ${lower}`);
    if (upper) conds.push(`t <= ${upper}`);
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    return `(SELECT MIN(t) FROM unnest(${col}) AS t ${where})`;
  },
  getCurrentTimestamp: () => `CURRENT_TIMESTAMP`,
  ifElse: (c, t, f) => `(CASE WHEN ${c} THEN ${t} ELSE ${f} END)`,
  getDataType: () => "VARCHAR",
  addTime: (col, unit, sign, amount) =>
    `${col} ${sign} INTERVAL '${amount} ${unit}s'`,
  formatDate: (col) => col,
  formatDateTimeString: (col) => col,
  selectStarLimit: (from, limit) => `SELECT * FROM ${from} LIMIT ${limit}`,
  defaultSchema: "",
  formatDialect: "",
  percentileCapSelectClause: () => "",
  hasCountDistinctHLL: () => false,
  hllAggregate: () => "",
  hllReaggregate: () => "",
  hllCardinality: () => "",
  kllInit: () => "",
  kllMergePartial: () => "",
  kllExtractPoint: () => "",
  kllExtractQuantiles: () => "",
  kllRankApprox: () => "",
  identifierQuote: '"',
};

const eventsFactTable: FactTableInterface = {
  id: "events",
  organization: "org_1",
  name: "Events",
  datasource: "ds_1",
  sql: "SELECT user_id, timestamp, country, event_name, category, action FROM events",
  userIdTypes: ["user_id"],
  dateCreated: new Date(),
  dateUpdated: new Date(),
  description: "",
  eventName: "",
  owner: "",
  projects: [],
  tags: [],
  filters: [],
  columns: [
    "user_id",
    "timestamp",
    "country",
    "event_name",
    "category",
    "action",
  ].map((col) => ({
    column: col,
    datatype: col === "timestamp" ? "date" : "string",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: col,
    description: "",
    numberFormat: "",
    alwaysInlineFilter: false,
    deleted: false,
    autoSlices: [],
    isAutoSliceColumn: false,
  })),
};

const factTableMap = new Map<string, FactTableInterface>([
  ["events", eventsFactTable],
]);

function baseJourneyConfig(
  overrides: Partial<ExplorationConfig> = {},
): ExplorationConfig {
  return {
    type: "journey",
    datasource: "ds_1",
    chartType: "bar",
    dateRange: {
      predefined: "last7Days",
      startDate: null,
      endDate: null,
      lookbackValue: null,
      lookbackUnit: null,
    },
    dimensions: [],
    dataset: {
      type: "journey",
      factTableId: "events",
      unit: "user_id",
      stepColumns: ["event_name"],
      anchorStepValues: ["view"],
      direction: "forward",
      rowFilters: [],
      path: [],
      lookaheadDepth: 3,
      optionsPerStep: [],
    },
    ...overrides,
  } as ExplorationConfig;
}

describe("journey row bound", () => {
  it("N=5, depth=3, no dimension → 259 path rows", () => {
    expect(maxJourneyPathRows(5, 3, 0)).toBe(259);
    expect(maxJourneyPathRows([], 3, 0)).toBe(259);
  });

  it("uses a distinct N at each frontier level", () => {
    // N=[5,8,5]: a1=6, a2=54, a3=324, t3=61 → 385
    expect(maxJourneyPathRows([5, 8, 5], 3, 0)).toBe(385);
  });

  it("view more +3 stays under the cap at launch defaults", () => {
    expect(
      canIncreaseJourneyOptions({
        optionsPerStep: [],
        levelIndex: 0,
        lookaheadDepth: 3,
        pathLength: 0,
        dimValues: 0,
      }),
    ).toBe(true);
    expect(withJourneyOptionsAt([], 0, 8)).toEqual([8]);
    expect(withJourneyOptionsAt([], 1, 8)).toEqual([5, 8]);
  });

  it("stays under the named cap for launch defaults", () => {
    expect(
      maxJourneyResultRows({
        optionsPerStep: [],
        lookaheadDepth: 3,
        pathLength: 0,
        dimValues: 0,
      }),
    ).toBeLessThanOrEqual(MAX_JOURNEY_RESULT_ROWS);
  });
});

describe("buildJourneySql", () => {
  it("emits the CTE chain and LEAD neighbourhood with no QUALIFY", () => {
    const { sql, lookaheadDepth } = buildJourneySql(
      baseJourneyConfig(),
      factTableMap,
      helpers,
    );
    expect(lookaheadDepth).toBe(3);
    expect(sql).toContain("__journey_raw");
    expect(sql).toContain("__journey_events");
    expect(sql).toContain("__journey_deduped");
    expect(sql).toContain("__journey_neighbourhood");
    expect(sql).toContain("__journey_anchored");
    expect(sql).toContain("__journey_top_lvl1");
    expect(sql).toContain("__journey_lvl1");
    expect(sql).toContain("LEAD(step, 1)");
    expect(sql).toContain("LEAD(step, 3)");
    expect(sql).toContain("ROW_NUMBER()");
    expect(sql).not.toMatch(/QUALIFY/i);
    expect(sql).not.toContain("LIMIT");
    expect(sql).not.toMatch(/\bAS direction\b/);
    expect(sql).toContain("AS step_1");
    expect(sql).toContain("AS step_3");
    expect(sql).not.toMatch(/\bAS kind\b/);
    expect(sql).not.toContain("UNION ALL");
    const rawAt = sql.indexOf("__journey_raw");
    const eventsAt = sql.indexOf("__journey_events");
    const nbAt = sql.indexOf("__journey_neighbourhood");
    const anchoredAt = sql.indexOf("__journey_anchored");
    expect(rawAt).toBeGreaterThan(-1);
    expect(eventsAt).toBeGreaterThan(rawAt);
    expect(nbAt).toBeGreaterThan(eventsAt);
    expect(anchoredAt).toBeGreaterThan(nbAt);
  });

  it("applies a distinct top-N per frontier level", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.optionsPerStep = [5, 8];
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    expect(sql).toMatch(/WHERE rn <= 5/);
    expect(sql).toMatch(/WHERE rn <= 8/);
  });

  it("does not concatenate a single step column", () => {
    const { sql } = buildJourneySql(baseJourneyConfig(), factTableMap, helpers);
    expect(sql).not.toContain(" || ");
    expect(sql).toContain("AS step");
    expect(sql).toContain("event_name");
  });

  it("concatenates two step columns with COALESCE wrapping", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.stepColumns = ["category", "action"];
    config.dataset.anchorStepValues = ["catalog", "product_view"];
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    expect(sql).toContain(" || ");
    expect(sql).toContain("COALESCE(");
    expect(sql).toContain(" / ");
  });

  it("emits committed prefix rows as trailing-null step columns", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.path = [{ value: "add_to_cart" }];
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    expect(sql).toContain("__journey_matched");
    expect(sql).toContain("__journey_commit_0");
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("add_to_cart");
    expect(sql).toContain("AS step_1");
    expect(sql).toContain("AS step_4");
    expect(sql).toContain("value AS step_1");
    expect(sql).not.toContain("__journey_progress");
    expect(sql).not.toMatch(/\bAS kind\b/);
    expect(sql).not.toContain("depth_reached");
    expect(sql).not.toMatch(/GROUP BY\s+'/);
  });

  it("uses LAG for backward journeys", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.direction = "backward";
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    expect(sql).toContain("LAG(step, 1)");
    expect(sql).not.toContain("LEAD(step, 1)");
    expect(sql).toContain("(entry)");
  });

  it("partitions daily journeys by unit and day", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.dailyJourneys = true;
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    expect(sql).toContain("PARTITION BY journey_unit, journey_day");
    expect(sql).toContain("journey_day");
  });

  it("emits a dynamic-dimension top-N CTE", () => {
    const config = baseJourneyConfig({
      dimensions: [
        { dimensionType: "dynamic", column: "country", maxValues: 3 },
      ],
    });
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    expect(sql).toContain("__journey_top_dim");
    expect(sql).toContain("dim_1");
  });

  it("buckets the dimension before aggregating, not in the outer SELECT", () => {
    const config = baseJourneyConfig({
      dimensions: [
        { dimensionType: "dynamic", column: "country", maxValues: 3 },
      ],
    });
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.path = [{ value: "add_to_cart" }];
    const { sql } = buildJourneySql(config, factTableMap, helpers);

    // Grouping on the raw column and bucketing afterwards emits one row per
    // distinct value — all labeled (other) — which breaks the row-count bound.
    // So the aggregating branches must select a plain, already-bucketed dim_1.
    const aggregatingSelects =
      sql.match(/SELECT((?:(?!SELECT)[\s\S])*?)COUNT\(\*\) AS journeys/g) ?? [];
    expect(aggregatingSelects).toHaveLength(2); // path + one committed step
    for (const branch of aggregatingSelects) {
      expect(branch).not.toContain("__journey_top_dim");
      expect(branch).not.toContain("CASE");
    }

    // The CASE lives upstream instead, once per aggregation source.
    expect(sql).toContain("__journey_path_bucketed");
    expect(sql.slice(0, sql.indexOf("__journey_path_bucketed AS"))).toContain(
      "__journey_top_dim",
    );
  });

  it("breaks top-N ties deterministically so cached frontiers are stable", () => {
    const config = baseJourneyConfig({
      dimensions: [
        { dimensionType: "dynamic", column: "country", maxValues: 3 },
      ],
    });
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    // Every ROW_NUMBER that picks a top-N set needs a tie-break column.
    const rowNumbers = sql.match(/ROW_NUMBER\(\) OVER \([\s\S]*?\)/g) ?? [];
    expect(rowNumbers.length).toBeGreaterThan(0);
    for (const expr of rowNumbers) {
      if (!expr.includes("c DESC")) continue;
      expect(expr).toMatch(/c DESC,/);
    }
  });

  it("throws when the starting step is missing", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.anchorStepValues = null;
    expect(() => buildJourneySql(config, factTableMap, helpers)).toThrow(
      /starting step/i,
    );
  });

  it("throws when the unit is not a userIdType", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.unit = "anonymous_id";
    expect(() => buildJourneySql(config, factTableMap, helpers)).toThrow(
      /userIdType/,
    );
  });

  it("throws when the projected row count exceeds the cap", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.optionsPerStep = [12, 12, 12, 12];
    config.dataset.lookaheadDepth = 4;
    config.dimensions = [
      { dimensionType: "dynamic", column: "country", maxValues: 12 },
    ];
    expect(() => buildJourneySql(config, factTableMap, helpers)).toThrow(
      /exceed/,
    );
  });
});

describe("transformJourneyRowsToResult", () => {
  const config = baseJourneyConfig();

  it("maps full step rows as path lookahead", () => {
    const result = transformJourneyRowsToResult(config, [
      {
        step_1: "add_to_cart",
        step_2: "(none)",
        step_3: "(none)",
        journeys: 12,
      },
    ]);
    expect(result.rows[0].journey).toEqual({
      kind: "path",
      direction: "forward",
      levels: ["add_to_cart", "(none)", "(none)"],
      count: 12,
    });
  });

  it("maps trailing-null rows as committed prefix rollups", () => {
    const withPath = baseJourneyConfig();
    if (withPath.dataset.type !== "journey")
      throw new Error("expected journey");
    withPath.dataset.path = [{ value: "add_to_cart" }];
    const result = transformJourneyRowsToResult(withPath, [
      {
        step_1: "add_to_cart",
        step_2: "checkout",
        step_3: "(exit)",
        step_4: "(none)",
        journeys: 8,
      },
      {
        step_1: "(exit)",
        step_2: null,
        step_3: null,
        step_4: null,
        journeys: 4,
      },
    ]);
    expect(result.rows[0].journey).toEqual({
      kind: "path",
      direction: "forward",
      levels: ["checkout", "(exit)", "(none)"],
      count: 8,
    });
    expect(result.rows[1].journey).toEqual({
      kind: "committed",
      direction: "forward",
      stepIndex: 0,
      value: "(exit)",
      count: 4,
    });
  });

  it("reads the committed step index from the last filled step column", () => {
    const withPath = baseJourneyConfig();
    if (withPath.dataset.type !== "journey")
      throw new Error("expected journey");
    withPath.dataset.path = [{ value: "add_to_cart" }, { value: "checkout" }];
    const result = transformJourneyRowsToResult(withPath, [
      {
        step_1: "add_to_cart",
        step_2: "upsell",
        step_3: null,
        step_4: null,
        step_5: null,
        journeys: 9,
      },
    ]);
    expect(result.rows[0].journey).toEqual({
      kind: "committed",
      direction: "forward",
      stepIndex: 1,
      value: "upsell",
      count: 9,
    });
  });

  it("never exceeds the config row bound", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      kind: "path",
      direction: "forward",
      lvl_1: `step_${i}`,
      lvl_2: "(exit)",
      lvl_3: "(none)",
      journeys: 1,
    }));
    const result = transformJourneyRowsToResult(config, rows);
    const bound = maxJourneyResultRows({
      optionsPerStep: [],
      lookaheadDepth: 3,
      pathLength: 0,
      dimValues: 0,
    });
    expect(result.rows.length).toBeLessThanOrEqual(bound);
  });
});

describe("journey step columns", () => {
  it("rebuilds SQL step columns from typed rows", () => {
    const path = [{ value: "add_to_cart" }];
    expect(
      journeyResultToStepValues(
        {
          kind: "path",
          direction: "forward",
          levels: ["checkout", "(exit)", "(none)"],
          count: 8,
        },
        path,
        3,
      ),
    ).toEqual(["add_to_cart", "checkout", "(exit)", "(none)"]);
    expect(
      journeyResultToStepValues(
        {
          kind: "committed",
          direction: "forward",
          stepIndex: 0,
          value: "(exit)",
          count: 4,
        },
        path,
        3,
      ),
    ).toEqual(["(exit)", null, null, null]);
  });

  it("sorts prefix rollups before their children", () => {
    const rows = [
      ["/search", "/item/*", "(exit)", "(none)"],
      ["/search", "/item/*", "/checkout", "(exit)"],
      ["(exit)", null, null, null],
      ["/search", "/item/*", null, null],
      ["/search", null, null, null],
    ];
    const sorted = [...rows].sort(compareJourneyStepValues);
    expect(sorted).toEqual([
      ["(exit)", null, null, null],
      ["/search", null, null, null],
      ["/search", "/item/*", null, null],
      ["/search", "/item/*", "(exit)", "(none)"],
      ["/search", "/item/*", "/checkout", "(exit)"],
    ]);
  });
});

describe("journey step grouping", () => {
  const grouped = (
    stepGroups: { column: string; pattern: string }[],
    datasetOverrides: Record<string, unknown> = {},
  ) => {
    const base = baseJourneyConfig();
    if (base.dataset.type !== "journey") throw new Error("expected journey");
    return buildJourneySql(
      {
        ...base,
        dataset: { ...base.dataset, stepGroups, ...datasetOverrides },
      } as ExplorationConfig,
      factTableMap,
      helpers,
    ).sql;
  };

  it("emits no CASE when there are no rules", () => {
    // An ungrouped journey must keep generating the SQL it did before grouping
    // existed, so its cached results stay valid.
    expect(grouped([])).not.toContain("CASE WHEN cast(event_name as varchar)");
    expect(
      buildJourneySql(baseJourneyConfig(), factTableMap, helpers).sql,
    ).toBe(grouped([]));
  });

  it("rewrites a matched value to the pattern itself", () => {
    const sql = grouped([{ column: "event_name", pattern: "/article/*" }]);
    expect(sql).toContain(
      "CASE WHEN cast(event_name as varchar) LIKE '/article/%' ESCAPE '\\' THEN '/article/*'",
    );
    expect(sql).toContain("ELSE cast(event_name as varchar) END AS step");
  });

  it("emits WHEN branches in rule order so the first match wins", () => {
    const sql = grouped([
      { column: "event_name", pattern: "/article/2024/*" },
      { column: "event_name", pattern: "/article/*" },
    ]);
    expect(sql.indexOf("'/article/2024/%'")).toBeLessThan(
      sql.indexOf("'/article/%'"),
    );
  });

  it("escapes LIKE metacharacters in the pattern on both sides", () => {
    const sql = grouped([{ column: "event_name", pattern: "/reports/50%_*" }]);
    // Literal % and _ escaped in the LIKE pattern...
    expect(sql).toContain("LIKE '/reports/50\\%\\_%' ESCAPE '\\'");
    // ...but emitted verbatim as the group label.
    expect(sql).toContain("THEN '/reports/50%_*'");
  });

  it("escapes a single quote in the pattern", () => {
    const sql = grouped([{ column: "event_name", pattern: "/o'brien/*" }]);
    expect(sql).toContain("LIKE '/o''brien/%'");
    expect(sql).toContain("THEN '/o''brien/*'");
  });

  it("translates ? to a single-character wildcard", () => {
    const sql = grouped([{ column: "event_name", pattern: "/u/?/edit" }]);
    expect(sql).toContain("LIKE '/u/_/edit'");
  });

  it("only groups the column a rule names", () => {
    const sql = grouped([{ column: "category", pattern: "/promo/*" }], {
      stepColumns: ["event_name", "category"],
      anchorStepValues: ["view", "a"],
    });
    expect(sql).toContain("LIKE '/promo/%'");
    // event_name is composed ungrouped, category through the CASE.
    expect(sql).toContain("COALESCE(cast(event_name as varchar), '')");
    expect(sql).not.toContain(
      "CASE WHEN cast(event_name as varchar) LIKE '/promo/%'",
    );
  });

  it("throws when a rule names a column that is not a step column", () => {
    expect(() =>
      grouped([{ column: "country", pattern: "/article/*" }]),
    ).toThrow(/not a step column/);
  });

  it("throws when a rule has an empty pattern", () => {
    expect(() => grouped([{ column: "event_name", pattern: "" }])).toThrow(
      /pattern is required/,
    );
  });
});

describe("journey datasource allowlist", () => {
  it("includes the launch warehouses and excludes mysql", () => {
    expect(JOURNEY_SUPPORTED_DATASOURCE_TYPES).toContain("postgres");
    expect(JOURNEY_SUPPORTED_DATASOURCE_TYPES).toContain(
      "growthbook_clickhouse",
    );
    expect(isJourneySupportedDatasourceType("mysql" as DataSourceType)).toBe(
      false,
    );
  });
});

describe("journeyMinUnusedLookahead", () => {
  it("maps one vs full to leftover levels", () => {
    expect(journeyMinUnusedLookahead(3, "one")).toBe(1);
    expect(journeyMinUnusedLookahead(3, "full")).toBe(3);
  });
});

describe("journeyResultCanServe", () => {
  function dataset(
    path: { mode: "value"; value: string }[],
    lookaheadDepth = 3,
  ): ExplorationConfig["dataset"] {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    return { ...config.dataset, path, lookaheadDepth };
  }

  it("reuses a shorter cached path when lookahead covers the extra step", () => {
    const cached = dataset([{ value: "home" }], 3);
    const requested = dataset([{ value: "home" }, { value: "search" }], 3);
    if (cached.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    expect(
      journeyResultCanServe({
        cachedDataset: cached,
        cachedRows: [
          {
            dimensions: [],
            journey: {
              kind: "path",
              direction: "forward",
              levels: ["search", "checkout", "(exit)"],
              count: 10,
            },
          },
        ],
        requestedDataset: requested,
      }),
    ).toBe(true);
  });

  it("rejects a shorter cache when the extra step was not in the frontier", () => {
    const cached = dataset([{ value: "home" }], 3);
    const requested = dataset([{ value: "home" }, { value: "checkout" }], 3);
    if (cached.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    expect(
      journeyResultCanServe({
        cachedDataset: cached,
        cachedRows: [
          {
            dimensions: [],
            journey: {
              kind: "path",
              direction: "forward",
              levels: ["search", "item", "(exit)"],
              count: 10,
            },
          },
        ],
        requestedDataset: requested,
      }),
    ).toBe(false);
  });

  it("reuses a longer cache to pop when committed options exist at that step", () => {
    const cached = dataset([{ value: "home" }, { value: "search" }], 3);
    const requested = dataset([{ value: "home" }], 3);
    if (cached.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    expect(
      journeyResultCanServe({
        cachedDataset: cached,
        cachedRows: [
          {
            dimensions: [],
            journey: {
              kind: "committed",
              direction: "forward",
              stepIndex: 1,
              value: "search",
              count: 8,
            },
          },
        ],
        requestedDataset: requested,
      }),
    ).toBe(true);
  });

  it("rejects a 3-step cache when the requested path uses every fetched level", () => {
    const cached = dataset([], 3);
    const requested = dataset(
      [{ value: "home" }, { value: "search" }, { value: "checkout" }],
      3,
    );
    if (cached.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    expect(
      journeyResultCanServe({
        cachedDataset: cached,
        cachedRows: [
          {
            dimensions: [],
            journey: {
              kind: "path",
              direction: "forward",
              levels: ["home", "search", "checkout"],
              count: 10,
            },
          },
        ],
        requestedDataset: requested,
      }),
    ).toBe(false);
  });

  it("reuses a 3-step cache for a shorter path that still has a leftover frontier", () => {
    const cached = dataset([], 3);
    const requested = dataset([{ value: "home" }, { value: "search" }], 3);
    if (cached.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    expect(
      journeyResultCanServe({
        cachedDataset: cached,
        cachedRows: [
          {
            dimensions: [],
            journey: {
              kind: "path",
              direction: "forward",
              levels: ["home", "search", "checkout"],
              count: 10,
            },
          },
        ],
        requestedDataset: requested,
      }),
    ).toBe(true);
  });

  it("rejects a leftover-1 cache when the request needs a full lookahead", () => {
    const cached = dataset([], 3);
    const requested = dataset([{ value: "home" }, { value: "search" }], 3);
    if (cached.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    expect(
      journeyResultCanServe({
        cachedDataset: cached,
        cachedRows: [
          {
            dimensions: [],
            journey: {
              kind: "path",
              direction: "forward",
              levels: ["home", "search", "checkout"],
              count: 10,
            },
          },
        ],
        requestedDataset: requested,
        minUnusedLookahead: requested.lookaheadDepth,
      }),
    ).toBe(false);
  });

  it("does not treat a pop as a full-lookahead hit", () => {
    const cached = dataset([{ value: "home" }, { value: "search" }], 3);
    const requested = dataset([{ value: "home" }], 3);
    if (cached.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    expect(
      journeyResultCanServe({
        cachedDataset: cached,
        cachedRows: [
          {
            dimensions: [],
            journey: {
              kind: "committed",
              direction: "forward",
              stepIndex: 1,
              value: "search",
              count: 8,
            },
          },
        ],
        requestedDataset: requested,
        minUnusedLookahead: requested.lookaheadDepth,
      }),
    ).toBe(false);
  });
});

describe("projectJourneyRows", () => {
  function dataset(
    path: { value: string }[],
    lookaheadDepth = 3,
  ): ExplorationConfig["dataset"] {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    return { ...config.dataset, path, lookaheadDepth };
  }

  function pathRow(levels: string[], count: number, dim?: string) {
    return {
      dimensions: dim ? [dim] : [],
      journey: {
        kind: "path" as const,
        direction: "forward" as const,
        levels,
        count,
      },
    };
  }

  function committedRow(stepIndex: number, value: string, count: number) {
    return {
      dimensions: [],
      journey: {
        kind: "committed" as const,
        direction: "forward" as const,
        stepIndex,
        value,
        count,
      },
    };
  }

  const cachedEmpty = dataset([]);
  const threeLevelRows = [
    pathRow(["home", "search", "(exit)"], 40),
    pathRow(["home", "(exit)", "(none)"], 10),
    pathRow(["search", "(exit)", "(none)"], 20),
    pathRow(["(exit)", "(none)", "(none)"], 30),
  ];

  function countsBy(
    rows: ReturnType<typeof projectJourneyRows>,
    pick: (row: (typeof rows)[number]) => string | null,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of rows) {
      const key = pick(row);
      if (key == null || !row.journey) continue;
      out[key] = (out[key] ?? 0) + row.journey.count;
    }
    return out;
  }

  it("collapses the same path to a single frontier column", () => {
    if (cachedEmpty.type !== "journey") throw new Error("expected journey");
    const rows = projectJourneyRows({
      cachedDataset: cachedEmpty,
      cachedRows: threeLevelRows,
      requestedDataset: cachedEmpty,
    });
    expect(journeyDisplayLookaheadDepth(rows)).toBe(1);
    expect(
      countsBy(rows, (row) =>
        row.journey?.kind === "path" ? row.journey.levels[0] : null,
      ),
    ).toEqual({ home: 50, search: 20, "(exit)": 30 });
    expect(rows.every((row) => row.journey?.kind === "path")).toBe(true);
  });

  it("reuses lookahead rows as committed + next frontier after a click", () => {
    const requested = dataset([{ value: "home" }]);
    if (cachedEmpty.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    const rows = projectJourneyRows({
      cachedDataset: cachedEmpty,
      cachedRows: threeLevelRows,
      requestedDataset: requested,
    });
    expect(
      countsBy(rows, (row) =>
        row.journey?.kind === "committed" && row.journey.stepIndex === 0
          ? row.journey.value
          : null,
      ),
    ).toEqual({ home: 50, search: 20, "(exit)": 30 });
    expect(
      countsBy(rows, (row) =>
        row.journey?.kind === "path" ? row.journey.levels[0] : null,
      ),
    ).toEqual({ search: 40, "(exit)": 10 });
  });

  it("keeps one leftover frontier after two clicks on a 3-step cache", () => {
    const requested = dataset([{ value: "home" }, { value: "search" }]);
    if (cachedEmpty.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    const rows = projectJourneyRows({
      cachedDataset: cachedEmpty,
      cachedRows: threeLevelRows,
      requestedDataset: requested,
    });
    expect(
      countsBy(rows, (row) =>
        row.journey?.kind === "committed"
          ? `${row.journey.stepIndex}:${row.journey.value}`
          : null,
      ),
    ).toEqual({
      "0:home": 50,
      "0:search": 20,
      "0:(exit)": 30,
      "1:search": 40,
      "1:(exit)": 10,
    });
    expect(
      countsBy(rows, (row) =>
        row.journey?.kind === "path" ? row.journey.levels[0] : null,
      ),
    ).toEqual({ "(exit)": 40 });
  });

  it("turns a longer cache's next committed step into the popped frontier", () => {
    const cached = dataset([{ value: "home" }, { value: "search" }]);
    const requested = dataset([{ value: "home" }]);
    if (cached.type !== "journey" || requested.type !== "journey") {
      throw new Error("expected journey");
    }
    const rows = projectJourneyRows({
      cachedDataset: cached,
      cachedRows: [
        pathRow(["thanks", "done", "(exit)"], 40),
        committedRow(0, "home", 50),
        committedRow(0, "(other)", 20),
        committedRow(0, "(exit)", 30),
        committedRow(1, "search", 40),
        committedRow(1, "(exit)", 10),
      ],
      requestedDataset: requested,
    });
    expect(
      countsBy(rows, (row) =>
        row.journey?.kind === "committed"
          ? `${row.journey.stepIndex}:${row.journey.value}`
          : null,
      ),
    ).toEqual({ "0:home": 50, "0:(other)": 20, "0:(exit)": 30 });
    expect(
      countsBy(rows, (row) =>
        row.journey?.kind === "path" ? row.journey.levels[0] : null,
      ),
    ).toEqual({ search: 40, "(exit)": 10 });
  });

  it("aggregates dimension splits when collapsing lookahead", () => {
    if (cachedEmpty.type !== "journey") throw new Error("expected journey");
    const rows = projectJourneyRows({
      cachedDataset: cachedEmpty,
      cachedRows: [
        pathRow(["home", "search", "(exit)"], 40, "US"),
        pathRow(["home", "(exit)", "(none)"], 10, "US"),
        pathRow(["home", "search", "(exit)"], 5, "UK"),
      ],
      requestedDataset: cachedEmpty,
    });
    expect(
      countsBy(rows, (row) =>
        row.journey?.kind === "path"
          ? `${row.journey.levels[0]}:${row.dimensions[0]}`
          : null,
      ),
    ).toEqual({ "home:US": 50, "home:UK": 5 });
  });

  it("overlays the requested path on a cached exploration", () => {
    const cached = baseJourneyConfig();
    const requested = baseJourneyConfig({
      dataset: dataset([{ value: "home" }]),
    });
    const exploration = {
      id: "ae_1",
      config: cached,
      result: { rows: threeLevelRows },
      status: "success",
    } as unknown as import("shared/validators").ProductAnalyticsExploration;
    const client = toClientJourneyExploration(exploration, requested);
    if (client.config.dataset.type !== "journey") {
      throw new Error("expected journey");
    }
    expect(client.config.dataset.path).toEqual([{ value: "home" }]);
    expect(client.config.dataset.lookaheadDepth).toBe(3);
    expect(
      client.result.rows.every(
        (row) =>
          row.journey?.kind === "committed" ||
          (row.journey?.kind === "path" && row.journey.levels.length === 1),
      ),
    ).toBe(true);
  });
});

describe("validateJourneyDataset", () => {
  function journeyDataset() {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    return config.dataset;
  }

  it("accepts a fully configured dataset", () => {
    expect(validateJourneyDataset(journeyDataset())).toEqual([]);
    expect(isJourneyDatasetRunnable(journeyDataset())).toBe(true);
  });

  it("reports each missing requirement", () => {
    const dataset = journeyDataset();
    dataset.factTableId = null;
    dataset.unit = null;
    dataset.stepColumns = [];
    dataset.anchorStepValues = null;
    expect(validateJourneyDataset(dataset)).toEqual([
      "Fact Table is required",
      "Journey unit is required",
      "Journey step columns are required",
      "Journey starting step is required",
    ]);
    expect(isJourneyDatasetRunnable(dataset)).toBe(false);
  });

  it("rejects an anchor whose length does not match the step columns", () => {
    const dataset = journeyDataset();
    dataset.stepColumns = ["event_name", "category"];
    dataset.anchorStepValues = ["view"];
    expect(validateJourneyDataset(dataset)).toContain(
      "Journey starting step is required",
    );
  });

  it("rejects a grouping rule that names a non-step column", () => {
    const dataset = journeyDataset();
    dataset.stepGroups = [{ column: "not_a_step", pattern: "/a/*" }];
    expect(validateJourneyDataset(dataset)).toEqual([
      'Journey grouping rule references column "not_a_step", which is not a step column',
    ]);
  });

  it("rejects an oversized result", () => {
    const big = journeyDataset();
    big.optionsPerStep = [50, 50, 50];
    big.lookaheadDepth = 4;
    expect(validateJourneyDataset(big).join(" ")).toMatch(/exceed/);
  });

  it("rejects paths that would generate too many window expressions", () => {
    const dataset = journeyDataset();
    dataset.path = Array.from({ length: 16 }, (_, i) => ({
      value: `step-${i}`,
    }));
    expect(validateJourneyDataset(dataset)).toContain(
      "Journey paths cannot contain more than 15 steps.",
    );
  });

  it("rejects step columns that are not on the Fact Table", () => {
    const dataset = journeyDataset();
    dataset.stepColumns = ["event_name", "event_name); SELECT secret FROM x"];
    expect(validateJourneyStepColumns(dataset, eventsFactTable)).toEqual([
      'Journey step column "event_name); SELECT secret FROM x" does not exist on the Fact Table.',
    ]);
  });
});

describe("journeyCacheCandidateVerdict", () => {
  function dataset(path: JourneyPathStep[], lookaheadDepth: number) {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    return { ...config.dataset, path, lookaheadDepth };
  }

  it("decides same-path reuse without needing result rows", () => {
    expect(
      journeyCacheCandidateVerdict({
        cachedDataset: dataset([], 3),
        requestedDataset: dataset([], 3),
        minUnusedLookahead: 3,
      }),
    ).toBe("yes");
  });

  it("rejects a different family without needing result rows", () => {
    const other = { ...dataset([], 3), unit: "anonymous_id" };
    expect(
      journeyCacheCandidateVerdict({
        cachedDataset: other,
        requestedDataset: dataset([], 3),
      }),
    ).toBe("no");
  });

  it("defers to the rows only when the path actually extends", () => {
    expect(
      journeyCacheCandidateVerdict({
        cachedDataset: dataset([], 3),
        requestedDataset: dataset([{ value: "home" }], 3),
        minUnusedLookahead: 1,
      }),
    ).toBe("needs-rows");
  });

  it("agrees with journeyResultCanServe on the rows-free answers", () => {
    const cached = dataset([], 3);
    const requested = dataset([], 3);
    for (const minUnusedLookahead of [1, 3]) {
      const verdict = journeyCacheCandidateVerdict({
        cachedDataset: cached,
        requestedDataset: requested,
        minUnusedLookahead,
      });
      expect(verdict).not.toBe("needs-rows");
      expect(
        journeyResultCanServe({
          cachedDataset: cached,
          cachedRows: [],
          requestedDataset: requested,
          minUnusedLookahead,
        }),
      ).toBe(verdict === "yes");
    }
  });
});

describe("journey lookahead depth guard", () => {
  it("rejects a missing or out-of-range depth instead of emitting broken SQL", () => {
    for (const bad of [undefined, 0, 1.5, 5]) {
      const config = baseJourneyConfig();
      if (config.dataset.type !== "journey") {
        throw new Error("expected journey");
      }
      // Configs reach the builder from URLs and the REST API, where a cast can
      // let a malformed value through Zod.
      (config.dataset as { lookaheadDepth?: number }).lookaheadDepth =
        bad as number;
      expect(validateJourneyDataset(config.dataset).join(" ")).toMatch(
        /lookahead depth must be between/,
      );
      expect(() => buildJourneySql(config, factTableMap, helpers)).toThrow(
        /lookahead depth/,
      );
    }
  });
});
