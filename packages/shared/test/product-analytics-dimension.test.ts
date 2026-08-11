import { generateDimensionExpression } from "shared/enterprise";
import { staticDimensionValidator } from "shared/validators";
import { ColumnInterface } from "shared/types/fact-table";
import { SqlDialect } from "shared/types/sql";

// Collapse the multi-line CASE expressions so assertions don't depend on the
// exact indentation/newlines used in the template strings.
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const helpers: SqlDialect = {
  escapeStringLiteral: (value) => value.replace(/'/g, "''"),
  jsonExtract: (jsonCol, path, isNumeric) =>
    `${jsonCol}:'${path}'::${isNumeric ? "float" : "text"}`,
  evalBoolean: (col, value) => `${col} IS ${value ? "TRUE" : "FALSE"}`,
  dateTrunc: (col, granularity) => `date_trunc('${granularity}', ${col})`,
  percentileApprox: (col, quantile) => `APPROX_PERCENTILE(${col}, ${quantile})`,
  hllReaggregate: (col) => `HLL_MERGE(${col})`,
  hllCardinality: (col) => `HLL_COUNT(${col})`,
  quantileSketchMergePartial: (col) => `KLL_MERGE(${col})`,
  quantileSketchExtractPoint: (col, quantile) =>
    `KLL_POINT(${col}, ${quantile})`,
  toTimestamp: (d: Date) => `'${d.toISOString().substring(0, 10)} 00:00:00'`,
  formatDialect: "bigquery",
  castToFloat: (col) => `CAST(${col} AS FLOAT)`,
};

function makeColumn(overrides: Partial<ColumnInterface>): ColumnInterface {
  return {
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "",
    description: "",
    column: "",
    datatype: "string",
    numberFormat: "",
    deleted: false,
    ...overrides,
  };
}

const columns: ColumnInterface[] = [
  makeColumn({ column: "country", name: "Country", datatype: "string" }),
  makeColumn({ column: "event_time", name: "Event Time", datatype: "date" }),
  makeColumn({
    column: "props",
    name: "Props",
    datatype: "json",
    jsonFields: {
      plan: { datatype: "string" },
      amount: { datatype: "number" },
    },
  }),
];

// generateDimensionExpression only reads `factTableGroup.factTable`, so a
// minimal group with no metrics/units is enough.
function makeFactTableGroup(timestampColumn = "event_time") {
  return {
    index: 0,
    factTable: {
      sql: "SELECT * FROM events",
      columns,
      filters: [],
      userIdTypes: ["user_id"],
      timestampColumn,
    },
    metrics: [],
    units: [],
  };
}

// 7-day range so an explicit "day" granularity is kept as-is.
const dateRange = {
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-01-08T00:00:00Z"),
};

describe("generateDimensionExpression", () => {
  describe("date dimension", () => {
    it("truncates the fact table's timestamp column to the granularity", () => {
      const result = generateDimensionExpression(
        { dimensionType: "date", column: null, dateGranularity: "day" },
        0,
        makeFactTableGroup("event_time"),
        helpers,
        dateRange,
      );
      expect(result).toBe("date_trunc('day', event_time)");
    });

    it("falls back to 'timestamp' when no timestamp column is set", () => {
      const result = generateDimensionExpression(
        { dimensionType: "date", column: null, dateGranularity: "day" },
        0,
        makeFactTableGroup(""),
        helpers,
        dateRange,
      );
      expect(result).toBe("date_trunc('day', timestamp)");
    });
  });

  describe("dynamic dimension", () => {
    it("references a top-level column directly and joins the top-values CTE", () => {
      const result = generateDimensionExpression(
        { dimensionType: "dynamic", column: "country", maxValues: 5 },
        0,
        makeFactTableGroup(),
        helpers,
        dateRange,
      );
      expect(norm(result)).toBe(
        "CASE WHEN country IN (SELECT value FROM _dimension0_top) THEN country ELSE 'other' END",
      );
    });

    it("uses the dimension index in the top-values CTE name", () => {
      const result = generateDimensionExpression(
        { dimensionType: "dynamic", column: "country", maxValues: 5 },
        2,
        makeFactTableGroup(),
        helpers,
        dateRange,
      );
      expect(norm(result)).toContain("SELECT value FROM _dimension2_top");
    });

    it("expands a string JSON field using jsonExtract", () => {
      const result = generateDimensionExpression(
        { dimensionType: "dynamic", column: "props.plan", maxValues: 5 },
        0,
        makeFactTableGroup(),
        helpers,
        dateRange,
      );
      expect(norm(result)).toBe(
        "CASE WHEN props:'plan'::text IN (SELECT value FROM _dimension0_top) THEN props:'plan'::text ELSE 'other' END",
      );
    });

    it("marks a numeric JSON field as numeric in jsonExtract", () => {
      const result = generateDimensionExpression(
        { dimensionType: "dynamic", column: "props.amount", maxValues: 5 },
        0,
        makeFactTableGroup(),
        helpers,
        dateRange,
      );
      expect(norm(result)).toContain("props:'amount'::float");
    });
  });

  describe("static dimension", () => {
    // Rows outside the pinned value list are dropped via a WHERE filter
    // built elsewhere (generateFactTableCTE / buildFunnelSql), so the
    // expression itself is just the raw column — no CASE/'other' fallback.
    it("returns the raw column expression for a top-level column", () => {
      const result = generateDimensionExpression(
        { dimensionType: "static", column: "country", values: ["US", "CA"] },
        0,
        makeFactTableGroup(),
        helpers,
        dateRange,
      );
      expect(norm(result)).toBe("country");
    });

    it("expands a JSON field when used as a static dimension", () => {
      const result = generateDimensionExpression(
        { dimensionType: "static", column: "props.plan", values: ["free"] },
        0,
        makeFactTableGroup(),
        helpers,
        dateRange,
      );
      expect(norm(result)).toBe("props:'plan'::text");
    });
  });

  describe("slice dimension", () => {
    it("builds a labelled CASE from each slice's row filters", () => {
      const result = generateDimensionExpression(
        {
          dimensionType: "slice",
          slices: [
            {
              name: "North America",
              filters: [{ operator: "=", column: "country", values: ["US"] }],
            },
            {
              name: "Canada",
              filters: [{ operator: "=", column: "country", values: ["CA"] }],
            },
          ],
        },
        0,
        makeFactTableGroup(),
        helpers,
        dateRange,
      );
      expect(norm(result)).toBe(
        "CASE WHEN ((country = 'US')) THEN 'North America' WHEN ((country = 'CA')) THEN 'Canada' ELSE 'other' END",
      );
    });

    it("supports JSON fields inside slice filters", () => {
      const result = generateDimensionExpression(
        {
          dimensionType: "slice",
          slices: [
            {
              name: "Free plan",
              filters: [
                { operator: "=", column: "props.plan", values: ["free"] },
              ],
            },
          ],
        },
        0,
        makeFactTableGroup(),
        helpers,
        dateRange,
      );
      expect(norm(result)).toContain("props:'plan'::text = 'free'");
    });
  });
});

describe("staticDimensionValidator", () => {
  // Intentionally unbounded: this schema also parses already-persisted and
  // URL-encoded explorations (not just fresh writes from the editor), so it
  // must keep accepting configs that predate the editor's own 1-20 cap —
  // an empty or oversized `values` array must not fail to parse. The editor
  // enforces 1-20 pins at authoring time; the SQL layer skips the filter
  // entirely for an empty values array (see sql.ts) rather than emitting
  // invalid SQL.
  it("accepts an empty pinned values array", () => {
    expect(() =>
      staticDimensionValidator.parse({
        dimensionType: "static",
        column: "country",
        values: [],
      }),
    ).not.toThrow();
  });

  it("accepts more than 20 pinned values", () => {
    const values = Array.from({ length: 21 }, (_, i) => `v${i}`);
    expect(() =>
      staticDimensionValidator.parse({
        dimensionType: "static",
        column: "country",
        values,
      }),
    ).not.toThrow();
  });

  it("accepts a typical pinned values array", () => {
    expect(() =>
      staticDimensionValidator.parse({
        dimensionType: "static",
        column: "country",
        values: ["US"],
      }),
    ).not.toThrow();
  });
});
