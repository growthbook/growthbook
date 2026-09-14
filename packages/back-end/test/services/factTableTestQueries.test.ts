import { buildRowFilterWhereClause } from "back-end/src/services/factTableTestQueries";

const factTable = {
  columns: [],
  filters: [],
  userIdTypes: [] as string[],
};

const dialect = {
  jsonExtract: () => "",
  escapeStringLiteral: (s: string) => s,
  stringMatch: () => "",
  evalBoolean: () => "",
  castToTimestamp: (column: string) => column,
  identifierQuote: '"' as const,
};

describe("buildRowFilterWhereClause", () => {
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
