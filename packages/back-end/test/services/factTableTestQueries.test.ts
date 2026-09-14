import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import { createLikeStringMatchFn } from "shared/sql";
import { buildRowFilterWhereClause } from "back-end/src/services/factTableTestQueries";

const now = new Date();

function col(
  column: string,
  overrides: Partial<ColumnInterface> = {},
): ColumnInterface {
  return {
    column,
    name: column,
    datatype: "string",
    deleted: false,
    description: "",
    numberFormat: "",
    dateCreated: now,
    dateUpdated: now,
    ...overrides,
  };
}

const factTable: Pick<
  FactTableInterface,
  "columns" | "filters" | "userIdTypes"
> = {
  columns: [col("country"), col("amount", { datatype: "number" })],
  filters: [
    {
      id: "flt_us",
      name: "US",
      description: "",
      value: "country = 'US'",
      dateCreated: now,
      dateUpdated: now,
      managedBy: "",
    },
  ],
  userIdTypes: ["user_id"],
};

const dialect = {
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) =>
    isNumeric ? `${jsonCol}:'${path}'::float` : `${jsonCol}:'${path}'`,
  escapeStringLiteral: (s: string) => s.replace(/'/g, "''"),
  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral: (s: string) => s.replace(/'/g, "''"),
    emitEscapeClause: false,
  }),
  evalBoolean: (colName: string, value: boolean) =>
    `${colName} IS ${value ? "TRUE" : "FALSE"}`,
  castToTimestamp: (column: string) => `CAST(${column} AS TIMESTAMP)`,
  identifierQuote: '"' as const,
};

describe("buildRowFilterWhereClause", () => {
  it("returns an empty string when there are no filters", () => {
    expect(
      buildRowFilterWhereClause({ rowFilters: [], factTable, dialect }),
    ).toBe("");
  });

  it("joins complete filters with AND", () => {
    expect(
      buildRowFilterWhereClause({
        rowFilters: [
          { operator: "=", column: "country", values: ["US"] },
          { operator: ">", column: "amount", values: ["10"] },
        ],
        factTable,
        dialect,
      }),
    ).toBe("(country = 'US')\n  AND (amount > 10)");
  });

  it("throws when a saved filter no longer exists", () => {
    expect(() =>
      buildRowFilterWhereClause({
        rowFilters: [{ operator: "saved_filter", values: ["gone"] }],
        factTable,
        dialect,
      }),
    ).toThrow(/Saved Filter "gone" no longer exists/);
  });

  it("throws when a filter is incomplete", () => {
    expect(() =>
      buildRowFilterWhereClause({
        rowFilters: [{ operator: "sql_expr", values: [""] }],
        factTable,
        dialect,
      }),
    ).toThrow(/incomplete and cannot be previewed/);
  });
});
