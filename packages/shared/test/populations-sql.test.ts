import type { PopulationStep } from "shared/validators";
import {
  buildPopulationSizeSql,
  getPopulationMembersCTEs,
  POPULATION_MEMBERS_TABLE,
  type PopulationSqlParams,
} from "shared/populations-sql";
import type { FactTableInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

const dialect = {
  identifierQuote: '"',
  escapeStringLiteral: (s: string) => s.replace(/'/g, "''"),
  stringMatch: () => "",
  jsonExtract: (col: string, path: string) => `${col}:'${path}'`,
  evalBoolean: (col: string, value: boolean) =>
    `${col} IS ${value ? "TRUE" : "FALSE"}`,
  addIntervalSeconds: (col: string, sign: string, amount: number) =>
    `${col} ${sign} INTERVAL '${amount} seconds'`,
  toTimestamp: (d: Date) => `'${d.toISOString().substring(0, 10)}'`,
  castToTimestamp: (col: string) => `CAST(${col} AS TIMESTAMP)`,
  castUserDateCol: (col: string) => col,
  formatDialect: "",
} as unknown as SqlDialect;

function factTable(id: string, columns: string[]): FactTableInterface {
  return {
    id,
    name: id,
    datasource: "ds_1",
    sql: `SELECT * FROM ${id}`,
    userIdTypes: ["user_id", "anonymous_id"],
    filters: [],
    columns: columns.map((column) => ({
      column,
      name: column,
      datatype:
        column === "revenue"
          ? "number"
          : column === "timestamp"
            ? "date"
            : "string",
      description: "",
      numberFormat: "",
      deleted: false,
      dateCreated: new Date(0),
      dateUpdated: new Date(0),
    })),
  } as unknown as FactTableInterface;
}

const factTableMap = new Map([
  ["signups", factTable("signups", ["user_id", "timestamp"])],
  [
    "orders",
    factTable("orders", ["user_id", "timestamp", "revenue", "country"]),
  ],
]);

function window(
  type: PopulationStep["windowSettings"]["type"] = "",
  windowValue = 0,
  delayValue = 0,
): PopulationStep["windowSettings"] {
  return {
    type,
    windowValue,
    windowUnit: "days",
    delayValue,
    delayUnit: "days",
  };
}

function step(
  factTableId: string,
  extra: Partial<PopulationStep> = {},
): PopulationStep {
  return {
    source: { type: "factTable", factTableId },
    rowFilters: [],
    windowSettings: window(),
    ...extra,
  };
}

const asOf = new Date("2026-01-31T00:00:00Z");

function params(steps: PopulationStep[]): PopulationSqlParams {
  return {
    population: { datasource: "ds_1", userIdTypes: ["user_id"], steps },
    factTableMap,
    dialect,
    idType: "user_id",
    asOf,
  };
}

function cte(steps: PopulationStep[], name: string): string {
  const found = getPopulationMembersCTEs(params(steps)).find(
    (c) => c.name === name,
  );
  if (!found) throw new Error(`CTE ${name} not found`);
  return found.sql.replace(/\s+/g, " ").trim();
}

describe("getPopulationMembersCTEs", () => {
  it("rejects an identifier type the Population doesn't have", () => {
    expect(() =>
      getPopulationMembersCTEs({
        ...params([step("signups")]),
        idType: "anonymous_id",
      }),
    ).toThrow(`Identifier type "anonymous_id"`);
  });

  it("rejects Populations that break the save rules", () => {
    expect(() =>
      getPopulationMembersCTEs(
        params([step("signups", { negation: true }), step("orders")]),
      ),
    ).toThrow(`The first step cannot be a "doesn't have" step.`);
    expect(() => getPopulationMembersCTEs(params([step("missing")]))).toThrow(
      "Fact table missing not found.",
    );
  });

  it("scans each fact table once and ends with the members table", () => {
    const names = getPopulationMembersCTEs(
      params([step("signups"), step("orders"), step("orders")]),
    ).map((c) => c.name);
    expect(names.filter((n) => /^__pop_ft\d$/.test(n))).toEqual([
      "__pop_ft0",
      "__pop_ft1",
    ]);
    expect(names[names.length - 1]).toBe(POPULATION_MEMBERS_TABLE);
  });

  describe("scan bounds", () => {
    it("ignores rows after asOf and has no lower bound by default", () => {
      expect(cte([step("signups"), step("orders")], "__pop_ft1")).toMatch(
        /WHERE timestamp <= '2026-01-31'$/,
      );
    });

    it("bounds later steps by the first step's lookback", () => {
      const steps = [
        step("signups", { windowSettings: window("lookback", 30) }),
        step("orders"),
      ];
      expect(cte(steps, "__pop_ft1")).toContain(
        "AND timestamp >= '2026-01-01'",
      );
    });

    it("uses the earliest bound of the steps sharing a fact table", () => {
      const steps = [
        step("orders", { windowSettings: window("lookback", 30) }),
        step("orders", { windowSettings: window("lookback", 10) }),
      ];
      expect(cte(steps, "__pop_ft0")).toContain(
        "AND timestamp >= '2026-01-01'",
      );
    });

    it("drops the inherited bound when a delay reaches back", () => {
      const steps = [
        step("signups", { windowSettings: window("lookback", 30) }),
        step("orders", { windowSettings: window("conversion", 7, -1) }),
      ];
      expect(cte(steps, "__pop_ft1")).not.toContain(">=");
    });

    it("pushes down the OR of the row filters on a shared fact table", () => {
      const us = {
        operator: "=" as const,
        column: "country",
        values: ["US"],
      };
      const ca = { ...us, values: ["CA"] };
      const sql = cte(
        [
          step("orders", { rowFilters: [us] }),
          step("orders", { rowFilters: [ca] }),
        ],
        "__pop_ft0",
      );
      expect(sql).toContain("country = 'US'");
      expect(sql).toContain("OR");
      expect(sql).toContain("country = 'CA'");
    });
  });

  it("anchors a conversion window, with its delay, on the previous step", () => {
    const sql = cte(
      [
        step("signups"),
        step("orders", { windowSettings: window("conversion", 7, 1) }),
      ],
      "__pop_step1_agg",
    );
    expect(sql).toContain("r.ts >= p.s0_ts + INTERVAL '86400 seconds'");
    expect(sql).toContain("r.ts <= p.s0_ts + INTERVAL '691200 seconds'");
  });

  it("joins on the unit only and applies the window in WHERE", () => {
    expect(
      cte(
        [
          step("signups"),
          step("orders", { windowSettings: window("conversion", 7) }),
        ],
        "__pop_step1_agg",
      ),
    ).toContain(
      "JOIN __pop_step1_rows r ON (r.unit_id = p.unit_id) WHERE r.ts >= p.s0_ts AND r.ts <= p.s0_ts + INTERVAL '604800 seconds' GROUP BY r.unit_id",
    );
  });

  it("anchors on the latest recorded timestamp, skipping negations", () => {
    const steps = [
      step("signups"),
      step("orders"),
      step("orders", { negation: true }),
      step("orders", { windowSettings: window("conversion", 7) }),
    ];
    expect(cte(steps, "__pop_step3_agg")).toContain(
      "r.ts >= COALESCE(p.s1_ts, p.s0_ts)",
    );
    expect(cte(steps, "__pop_step2")).toBe(
      "SELECT p.unit_id, p.s0_ts, p.s1_ts, CASE WHEN COALESCE(p.s1_ts, p.s0_ts) > p.qualified_ts THEN COALESCE(p.s1_ts, p.s0_ts) ELSE p.qualified_ts END AS qualified_ts FROM __pop_step1 p WHERE p.unit_id NOT IN (SELECT unit_id FROM __pop_step2_agg)",
    );
  });

  it("records the row where the running total first meets the filter", () => {
    const steps = [
      step("signups"),
      step("orders", {
        aggregateFilter: ">=50",
        aggregateFilterColumn: "revenue",
      }),
    ];
    expect(cte(steps, "__pop_step1_rows")).toContain(
      "COALESCE(revenue, 0) AS value",
    );
    expect(cte(steps, "__pop_step1_running")).toContain(
      "SUM(r.value) OVER (PARTITION BY r.unit_id ORDER BY r.ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total",
    );
    expect(cte(steps, "__pop_step1_agg")).toContain(
      "COALESCE( MIN(CASE WHEN running_total >= 50 THEN ts END), MAX(ts) ) AS match_ts",
    );
    expect(cte(steps, "__pop_step1")).toContain("WHERE a.total >= 50");
  });

  it("counts rows for $$count and writes != as <>", () => {
    const steps = [
      step("signups"),
      step("orders", {
        aggregateFilter: ">=2,!=5",
        aggregateFilterColumn: "$$count",
      }),
    ];
    expect(cte(steps, "__pop_step1_rows")).toContain("1 AS value");
    expect(cte(steps, "__pop_step1")).toContain(
      "WHERE a.total >= 2 AND a.total <> 5",
    );
  });

  it("keeps units with no rows when a has step's filter accepts zero", () => {
    const sql = cte(
      [
        step("signups"),
        step("orders", {
          aggregateFilter: "<2",
          aggregateFilterColumn: "$$count",
        }),
      ],
      "__pop_step1",
    );
    expect(sql).toContain("WHERE a.total < 2 UNION ALL");
    expect(sql).toContain(
      "CAST(NULL AS TIMESTAMP) AS s1_ts, CASE WHEN p.s0_ts > p.qualified_ts THEN p.s0_ts ELSE p.qualified_ts END AS qualified_ts FROM __pop_step0 p WHERE p.unit_id NOT IN (SELECT unit_id FROM __pop_step1_agg)",
    );
  });

  it("negates aggregate filters, including ones that accept zero", () => {
    const negated = (aggregateFilter: string) =>
      cte(
        [
          step("signups"),
          step("orders", {
            negation: true,
            aggregateFilter,
            aggregateFilterColumn: "$$count",
          }),
        ],
        "__pop_step1",
      );
    // ">=3" fails at zero rows, so its negation also keeps units with none.
    expect(negated(">=3")).toContain(
      "JOIN __pop_step1_agg a ON (a.unit_id = p.unit_id) WHERE NOT (a.total >= 3) UNION ALL",
    );
    expect(negated(">=3")).toContain(
      "WHERE p.unit_id NOT IN (SELECT unit_id FROM __pop_step1_agg)",
    );
    expect(negated("<3")).toContain("WHERE NOT (a.total < 3)");
    expect(negated("<3")).not.toContain("UNION ALL");
  });
});

describe("qualification", () => {
  const qualified = (steps: PopulationStep[]) =>
    cte(steps, `__pop_step${steps.length - 1}`);

  it("settles at the matching row when later rows can't undo the step", () => {
    expect(
      qualified([
        step("signups"),
        step("orders", {
          aggregateFilter: ">=3",
          aggregateFilterColumn: "$$count",
          windowSettings: window("conversion", 7),
        }),
      ]),
    ).toContain(
      "CASE WHEN a.match_ts > p.qualified_ts THEN a.match_ts ELSE p.qualified_ts END AS qualified_ts",
    );
    // "Doesn't have fewer than 3" means 3 or more, which also can't be undone.
    expect(
      cte(
        [
          step("signups"),
          step("orders", {
            negation: true,
            aggregateFilter: "<3",
            aggregateFilterColumn: "$$count",
          }),
        ],
        "__pop_step1_agg",
      ),
    ).toContain("MIN(CASE WHEN NOT (running_total < 3) THEN ts END)");
  });

  it("settles at the end of a conversion window, excluding open windows", () => {
    const sql = qualified([
      step("signups"),
      step("orders", {
        negation: true,
        windowSettings: window("conversion", 7),
      }),
    ]);
    expect(sql).toContain(
      "CASE WHEN p.s0_ts + INTERVAL '604800 seconds' > p.qualified_ts",
    );
    expect(sql).toContain(
      "AND p.s0_ts + INTERVAL '604800 seconds' <= CAST('2026-01-31' AS TIMESTAMP)",
    );
  });

  it("settles a no-rows lookback at the last earlier row plus the window", () => {
    const steps = [
      step("signups", { windowSettings: window("lookback", 60) }),
      step("orders", {
        negation: true,
        windowSettings: window("lookback", 30),
      }),
    ];
    expect(cte(steps, "__pop_step1_agg")).toContain(
      "SUM(CASE WHEN r.ts >= '2026-01-01' THEN 1 ELSE 0 END) AS total, MAX(CASE WHEN r.ts < '2026-01-01' THEN r.ts END) AS last_ts",
    );
    expect(qualified(steps)).toContain(
      "CASE WHEN a.last_ts + INTERVAL '2592000 seconds' > p.qualified_ts",
    );
    expect(qualified(steps)).toContain("WHERE a.total = 0");
    // Rows before the window are read, back to step 1's own lookback.
    expect(cte(steps, "__pop_step1_rows")).not.toContain(">=");
    expect(cte(steps, "__pop_ft1")).toContain("timestamp >= '2025-12-02'");
  });

  it("settles other lookbacks at asOf", () => {
    expect(
      qualified([
        step("signups"),
        step("orders", {
          aggregateFilter: "<3",
          aggregateFilterColumn: "$$count",
          windowSettings: window("lookback", 30),
        }),
      ]),
    ).toContain(
      "CASE WHEN CAST('2026-01-31' AS TIMESTAMP) > p.qualified_ts THEN CAST('2026-01-31' AS TIMESTAMP) ELSE p.qualified_ts END",
    );
    expect(
      cte(
        [
          step("orders", {
            aggregateFilter: "<3",
            aggregateFilterColumn: "$$count",
            windowSettings: window("lookback", 30),
          }),
        ],
        "__pop_step0",
      ),
    ).toContain("CAST('2026-01-31' AS TIMESTAMP) AS qualified_ts");
  });

  it("settles provisionally at the anchor with no window", () => {
    expect(
      qualified([step("signups"), step("orders", { negation: true })]),
    ).toContain(
      "CASE WHEN p.s0_ts > p.qualified_ts THEN p.s0_ts ELSE p.qualified_ts END",
    );
  });
});

describe("members", () => {
  it("dates members by when they qualified", () => {
    expect(
      cte(
        [step("signups"), step("orders"), step("orders", { negation: true })],
        POPULATION_MEMBERS_TABLE,
      ),
    ).toBe(
      "SELECT unit_id AS user_id, qualified_ts AS joined_ts FROM __pop_step2",
    );
    expect(cte([step("signups")], "__pop_step0")).toContain(
      "a.match_ts AS s0_ts, a.match_ts AS qualified_ts",
    );
  });
});

describe("buildPopulationSizeSql", () => {
  it("counts the members", () => {
    const sql = buildPopulationSizeSql(params([step("signups")]));
    expect(sql).toMatch(/^\s*WITH\s+__pop_ft0 AS \(/);
    expect(sql).toContain(
      `SELECT COUNT(*) AS members\n    FROM ${POPULATION_MEMBERS_TABLE}`,
    );
  });
});
