import {
  buildJourneySql,
  transformJourneyRowsToResult,
  isJourneySupportedDatasourceType,
  JOURNEY_SUPPORTED_DATASOURCE_TYPES,
} from "shared/enterprise";
import {
  canIncreaseJourneyOptions,
  journeyMinUnusedLookahead,
  journeyResultCanServe,
  maxJourneyPathRows,
  maxJourneyResultRows,
  withJourneyOptionsAt,
  MAX_JOURNEY_RESULT_ROWS,
} from "shared/journeys";
import { createLikeMatchFns } from "shared/sql";
import { ExplorationConfig } from "shared/validators";
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
      dailyJourneys: false,
      stepColumns: ["event_name"],
      anchorStepValues: ["view"],
      direction: "forward",
      excludedSteps: [],
      rowFilters: [],
      collapseRepeats: true,
      path: [],
      depth: 3,
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
        depth: 3,
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
        depth: 3,
        pathLength: 0,
        dimValues: 0,
      }),
    ).toBeLessThanOrEqual(MAX_JOURNEY_RESULT_ROWS);
  });
});

describe("buildJourneySql", () => {
  it("emits the CTE chain and LEAD neighbourhood with no QUALIFY", () => {
    const { sql, fetchDepth } = buildJourneySql(
      baseJourneyConfig(),
      factTableMap,
      helpers,
    );
    expect(fetchDepth).toBe(3);
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

  it("emits a committed-path match CTE and progress branch", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.path = [{ mode: "value", value: "add_to_cart" }];
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    expect(sql).toContain("__journey_matched");
    expect(sql).toContain("__journey_progress");
    expect(sql).toContain("__journey_commit_0");
    expect(sql).toContain("'committed'");
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("depth_reached");
    expect(sql).toContain("add_to_cart");
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

  it("skips the dedupe CTE when collapseRepeats is false", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.collapseRepeats = false;
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    expect(sql).not.toContain("__journey_deduped");
    expect(sql).toContain("__journey_neighbourhood");
  });

  it("excludes steps with NOT IN on the first step column", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.excludedSteps = ["heartbeat", "page_ping"];
    const { sql } = buildJourneySql(config, factTableMap, helpers);
    expect(sql).toContain("NOT IN");
    expect(sql).toContain("heartbeat");
    expect(sql).toContain("page_ping");
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

  it("throws on a mode: other path step", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.path = [{ mode: "other", excludes: ["a", "b"] }];
    expect(() => buildJourneySql(config, factTableMap, helpers)).toThrow(
      /other/,
    );
  });

  it("throws when the projected row count exceeds the cap", () => {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    config.dataset.optionsPerStep = [12, 12, 12, 12];
    config.dataset.depth = 4;
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

  it("maps path and progress rows, including (none)", () => {
    const result = transformJourneyRowsToResult(config, [
      {
        kind: "path",
        direction: "forward",
        lvl_1: "add_to_cart",
        lvl_2: "(none)",
        lvl_3: "(none)",
        journeys: 12,
      },
      {
        kind: "progress",
        direction: "forward",
        lvl_1: 1,
        lvl_2: "exit",
        journeys: 4,
      },
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].journey).toEqual({
      kind: "path",
      direction: "forward",
      levels: ["add_to_cart", "(none)", "(none)"],
      count: 12,
    });
    expect(result.rows[1].journey).toEqual({
      kind: "progress",
      direction: "forward",
      depthReached: 1,
      outcome: "exit",
      count: 4,
    });
  });

  it("maps committed option rows", () => {
    const result = transformJourneyRowsToResult(config, [
      {
        kind: "committed",
        direction: "forward",
        lvl_1: 0,
        lvl_2: "add_to_cart",
        journeys: 9,
      },
    ]);
    expect(result.rows[0].journey).toEqual({
      kind: "committed",
      direction: "forward",
      stepIndex: 0,
      value: "add_to_cart",
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
      depth: 3,
      pathLength: 0,
      dimValues: 0,
    });
    expect(result.rows.length).toBeLessThanOrEqual(bound);
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

  it("matches excluded steps against the grouped value", () => {
    const sql = grouped([{ column: "event_name", pattern: "/article/*" }], {
      excludedSteps: ["/article/*"],
    });
    // Excluding the group drops the whole group, not one raw value.
    expect(sql).toContain("END NOT IN ('/article/*')");
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
    depth = 3,
  ): ExplorationConfig["dataset"] {
    const config = baseJourneyConfig();
    if (config.dataset.type !== "journey") throw new Error("expected journey");
    return { ...config.dataset, path, depth };
  }

  it("reuses a shorter cached path when lookahead covers the extra step", () => {
    const cached = dataset([{ mode: "value", value: "home" }], 3);
    const requested = dataset(
      [
        { mode: "value", value: "home" },
        { mode: "value", value: "search" },
      ],
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
    const cached = dataset([{ mode: "value", value: "home" }], 3);
    const requested = dataset(
      [
        { mode: "value", value: "home" },
        { mode: "value", value: "checkout" },
      ],
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
    const cached = dataset(
      [
        { mode: "value", value: "home" },
        { mode: "value", value: "search" },
      ],
      3,
    );
    const requested = dataset([{ mode: "value", value: "home" }], 3);
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
      [
        { mode: "value", value: "home" },
        { mode: "value", value: "search" },
        { mode: "value", value: "checkout" },
      ],
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
    const requested = dataset(
      [
        { mode: "value", value: "home" },
        { mode: "value", value: "search" },
      ],
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
    ).toBe(true);
  });

  it("rejects a leftover-1 cache when the request needs a full lookahead", () => {
    const cached = dataset([], 3);
    const requested = dataset(
      [
        { mode: "value", value: "home" },
        { mode: "value", value: "search" },
      ],
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
        minUnusedLookahead: requested.depth,
      }),
    ).toBe(false);
  });

  it("does not treat a pop as a full-lookahead hit", () => {
    const cached = dataset(
      [
        { mode: "value", value: "home" },
        { mode: "value", value: "search" },
      ],
      3,
    );
    const requested = dataset([{ mode: "value", value: "home" }], 3);
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
        minUnusedLookahead: requested.depth,
      }),
    ).toBe(false);
  });
});
