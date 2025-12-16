import normal from "@stdlib/stats/base/dists/normal";
import {
  FactTableInterface,
  ColumnInterface,
  FactFilterInterface,
} from "back-end/types/fact-table";
import { IndexedPValue } from "back-end/types/stats";
import {
  getColumnRefWhereClause,
  canInlineFilterColumn,
  getAggregateFilters,
  getColumnExpression,
  getSelectedColumnDatatype,
  adjustPValuesBenjaminiHochberg,
  adjustPValuesHolmBonferroni,
  adjustedCI,
  setAdjustedPValuesOnResults,
  chanceToWinFlatPrior,
} from "../src/experiments";

describe("Experiments", () => {
  describe("Fact Tables", () => {
    const column: ColumnInterface = {
      column: "event_name",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      numberFormat: "",
      name: "Event Name",
      alwaysInlineFilter: true,
      deleted: false,
      autoSlices: ["s1", "s2", "s3"],
      isAutoSliceColumn: true,
    };
    const column2: ColumnInterface = {
      column: "page",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The page location",
      numberFormat: "",
      name: "Page Location",
      deleted: false,
    };
    const userIdColumn: ColumnInterface = {
      column: "user_id",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The user id",
      numberFormat: "",
      name: "User ID",
      deleted: false,
    };
    const numericColumn: ColumnInterface = {
      column: "event_count",
      datatype: "number",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The count of the event",
      numberFormat: "",
      name: "Event Count",
      deleted: false,
    };
    const jsonColumn: ColumnInterface = {
      column: "data",
      datatype: "json",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "JSON data",
      numberFormat: "",
      name: "data",
      deleted: false,
      jsonFields: {
        a: { datatype: "string" },
        b: { datatype: "number" },
        "c.d": { datatype: "string" },
        "c.e": { datatype: "number" },
      },
    };
    const boolColumn: ColumnInterface = {
      column: "is_bot",
      datatype: "boolean",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "Is bot",
      numberFormat: "",
      name: "Is Bot",
      deleted: false,
    };
    const deletedColumn: ColumnInterface = {
      column: "deleted_column",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      numberFormat: "",
      name: "Deleted Column",
      deleted: true,
    };
    const filter: FactFilterInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      id: "filter_1",
      managedBy: "",
      name: "Event Name",
      value: "device='mobile'",
    };
    const filter2: FactFilterInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      id: "filter_2",
      managedBy: "",
      name: "Event Name",
      value: "country='us'",
    };
    const filter3: FactFilterInterface = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      id: "filter_3",
      managedBy: "",
      name: "Event Name",
      value: "event_name = 'login'",
    };

    const factTable: Pick<
      FactTableInterface,
      "userIdTypes" | "columns" | "filters"
    > = {
      columns: [
        column,
        column2,
        userIdColumn,
        numericColumn,
        deletedColumn,
        jsonColumn,
        boolColumn,
      ],
      filters: [filter, filter2, filter3],
      userIdTypes: ["user_id"],
    };

    const escapeStringLiteral = (str: string) => str.replace(/'/g, "''");
    const jsonExtract = (jsonCol: string, path: string, isNumeric: boolean) => {
      if (isNumeric) {
        return `${jsonCol}:'${path}'::float`;
      }
      return `${jsonCol}:'${path}'`;
    };
    const evalBoolean = (col: string, value: boolean) => {
      return `${col} IS ${value ? "TRUE" : "FALSE"}`;
    };

    describe("canInlineFilterColumn", () => {
      it("returns true for string columns with alwaysInlineFilter", () => {
        expect(canInlineFilterColumn(factTable, column.column)).toBe(true);
      });
      it("returns true for string columns, even if alwaysInlineFilter is false", () => {
        expect(canInlineFilterColumn(factTable, column2.column)).toBe(true);
      });
      it("returns true for boolean columns", () => {
        expect(canInlineFilterColumn(factTable, boolColumn.column)).toBe(true);
      });
      it("returns false for deleted columns", () => {
        expect(canInlineFilterColumn(factTable, deletedColumn.column)).toBe(
          false,
        );
      });
      it("returns false for numeric columns", () => {
        expect(canInlineFilterColumn(factTable, numericColumn.column)).toBe(
          false,
        );
      });
      it("returns false for userId columns", () => {
        expect(canInlineFilterColumn(factTable, userIdColumn.column)).toBe(
          false,
        );
      });
      it("returns false for unknown column", () => {
        expect(canInlineFilterColumn(factTable, "unknown_column")).toBe(false);
      });
      it("returns true for nested JSON string field", () => {
        expect(canInlineFilterColumn(factTable, `${jsonColumn.column}.a`)).toBe(
          true,
        );
      });
      it("returns false for nested JSON non-string field", () => {
        expect(canInlineFilterColumn(factTable, `${jsonColumn.column}.b`)).toBe(
          false,
        );
      });
    });

    describe("getColumnRefWhereClause", () => {
      it("returns empty array when there are no filters", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "event_name",
              filters: [],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "event_name",
              filters: [],
              inlineFilters: {},
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "event_name",
              filters: [],
              inlineFilters: {
                [column.column]: [],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "event_name",
              filters: [],
              inlineFilters: {
                [column.column]: [""],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([]);
      });
      it("ignores invalid filters, but uses invalid inline filter columns", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              filters: ["unknown_id"],
              factTableId: "",
              inlineFilters: {
                unknown_column: ["unknown_value"],
                [numericColumn.column]: ["1"],
                [deletedColumn.column]: ["deleted"],
                [userIdColumn.column]: ["user"],
              },
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([
          "(unknown_column = 'unknown_value')",
          `(${numericColumn.column} = '1')`,
          `(${deletedColumn.column} = 'deleted')`,
          `(${userIdColumn.column} = 'user')`,
        ]);
      });
      it("returns where clause for single filter", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              filters: [filter.id],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${filter.value})`]);
      });
      it("returns where clause for multiple filters", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              filters: [filter.id, filter2.id],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${filter.value})`, `(${filter2.value})`]);
      });
      it("returns where clause for single inline filter value", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${column.column} = 'login')`]);
      });
      it("returns where clause for multiple inline filter values", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login", "signup"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${column.column} IN (\n  'login',\n  'signup'\n))`]);
      });
      it("returns where clause for inline filters and filters", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              filters: [filter.id],
              inlineFilters: {
                [column.column]: ["login"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${column.column} = 'login')`, `(${filter.value})`]);
      });
      it("escapes string literals", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login's"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${column.column} = 'login''s')`]);
      });
      it("removes duplicate inline filter and filter values", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              filters: [filter3.id],
              inlineFilters: {
                [column.column]: ["login"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${column.column} = 'login')`]);
      });
      it("removes duplicate inline filter values", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login", "login"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${column.column} = 'login')`]);
      });
      it("supports JSON column inline filters", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: `${jsonColumn.column}.b`,
              filters: [],
              inlineFilters: {
                [`${jsonColumn.column}.b`]: ["hello"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${jsonColumn.column}:'b'::float = 'hello')`]);
      });
      it("supports IS TRUE inline filter", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "foo",
              filters: [],
              inlineFilters: {
                [boolColumn.column]: ["true"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${boolColumn.column} IS TRUE)`]);
      });
      it("supports IS FALSE inline filter", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "foo",
              filters: [],
              inlineFilters: {
                [boolColumn.column]: ["false"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([`(${boolColumn.column} IS FALSE)`]);
      });
      it("ignores empty boolean filter", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "foo",
              filters: [],
              inlineFilters: {
                [boolColumn.column]: [""],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
          }),
        ).toStrictEqual([]);
      });
      it("includes metric slices", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "foo",
              filters: [],
              inlineFilters: {},
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            sliceInfo: {
              isSliceMetric: true,
              sliceLevels: [
                {
                  column: column.column,
                  levels: ["l1"],
                },
                {
                  column: column2.column,
                  levels: ["l2", "l3"],
                },
              ],
            },
          }),
        ).toStrictEqual([
          `(${column.column} = 'l1')`,
          // TODO: this should be an IN clause, fix the test once the code is updated
          `(${column2.column} = 'l2')`,
        ]);
      });
      it("includes metric auto slices - other", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "foo",
              filters: [],
              inlineFilters: {},
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            sliceInfo: {
              isSliceMetric: true,
              sliceLevels: [
                {
                  column: column.column,
                  levels: [],
                },
              ],
            },
          }),
        ).toStrictEqual([
          `(${column.column} NOT IN (\n  's1',\n  's2',\n  's3'\n))`,
        ]);
      });
      it("combines multiple types of filters", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "foo",
              filters: [filter.id],
              inlineFilters: {
                [boolColumn.column]: ["false"],
              },
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            sliceInfo: {
              isSliceMetric: true,
              sliceLevels: [
                {
                  column: column.column,
                  levels: ["l1"],
                },
              ],
            },
          }),
        ).toStrictEqual([
          `(${column.column} = 'l1')`,
          `(${boolColumn.column} IS FALSE)`,
          `(${filter.value})`,
        ]);
      });
    });
    describe("getAggregateFilter", () => {
      it("returns empty array for empty input", () => {
        expect(
          getAggregateFilters({
            columnRef: null,
            column: "value",
          }),
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">10",
              aggregateFilterColumn: "",
            },
            column: "value",
          }),
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: " ",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: " , ",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual([]);
      });
      it("parses a single filter with different operators", () => {
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "> 0",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual(["value > 0"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: " < 5,",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual(["value < 5"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">= 10",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual(["value >= 10"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "<= 15",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual(["value <= 15"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "=1.5",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual(["value = 1.5"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "!=0.15",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual(["value != 0.15"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "<> 0.15",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual(["value <> 0.15"]);
      });
      it("parses multiple filters", () => {
        expect(
          getAggregateFilters({
            columnRef: {
              aggregateFilter:
                ",> 0, < 5 , >= 10, <= 15, =1.5, !=0.15,,, <> 0.15",
              column: "$$distinctUsers",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual([
          "value > 0",
          "value < 5",
          "value >= 10",
          "value <= 15",
          "value = 1.5",
          "value != 0.15",
          "value <> 0.15",
        ]);
      });
      it("throws by default", () => {
        expect(() =>
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">5, %3, foobar,,,",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toThrowError("Invalid user filter: %3");
      });
      it("ignores invalid filters when opted in", () => {
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">5, %3, foobar,,,",
              aggregateFilterColumn: "v",
            },
            column: "col",
            ignoreInvalid: true,
          }),
        ).toStrictEqual(["col > 5"]);
      });
      it("skips when column is not $$distinctUsers", () => {
        expect(
          getAggregateFilters({
            columnRef: {
              column: "col",
              aggregateFilter: ">5",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$count",
              aggregateFilter: ">5",
              aggregateFilterColumn: "v",
            },
            column: "value",
          }),
        ).toStrictEqual([]);
      });
    });

    describe("getColumnExpression", () => {
      it("replaces JSON column access with proper syntax", () => {
        expect(
          getColumnExpression(`${jsonColumn.column}.a`, factTable, jsonExtract),
        ).toBe(`${jsonColumn.column}:'a'`);

        expect(
          getColumnExpression(`${jsonColumn.column}.b`, factTable, jsonExtract),
        ).toBe(`${jsonColumn.column}:'b'::float`);

        expect(
          getColumnExpression(
            `${jsonColumn.column}.c.d`,
            factTable,
            jsonExtract,
          ),
        ).toBe(`${jsonColumn.column}:'c.d'`);

        expect(
          getColumnExpression(
            `${jsonColumn.column}.c.e`,
            factTable,
            jsonExtract,
          ),
        ).toBe(`${jsonColumn.column}:'c.e'::float`);
      });

      it("returns untransformed column for non-JSON columns", () => {
        expect(getColumnExpression(column.column, factTable, jsonExtract)).toBe(
          column.column,
        );
      });

      it("returns untransformed column for unknown columns", () => {
        expect(
          getColumnExpression("unknown_column", factTable, jsonExtract),
        ).toBe("unknown_column");
      });

      it("supports aliases", () => {
        expect(
          getColumnExpression(
            `${jsonColumn.column}.b`,
            factTable,
            jsonExtract,
            "m",
          ),
        ).toBe(`m.${jsonColumn.column}:'b'::float`);

        expect(
          getColumnExpression(column.column, factTable, jsonExtract, "m"),
        ).toBe(`m.${column.column}`);

        expect(
          getColumnExpression("unknown", factTable, jsonExtract, "m"),
        ).toBe(`m.unknown`);
      });

      it("assumes datatype of string for unknown JSON fields", () => {
        expect(
          getColumnExpression(
            `${jsonColumn.column}.unknown`,
            factTable,
            jsonExtract,
          ),
        ).toBe(`${jsonColumn.column}:'unknown'`);

        expect(
          getColumnExpression(
            `${jsonColumn.column}.c.unknown`,
            factTable,
            jsonExtract,
          ),
        ).toBe(`${jsonColumn.column}:'c.unknown'`);

        expect(
          getColumnExpression(
            `${jsonColumn.column}.unknown.unknown`,
            factTable,
            jsonExtract,
          ),
        ).toBe(`${jsonColumn.column}:'unknown.unknown'`);
      });
    });
    describe("getSelectedColumnDatatype", () => {
      it("returns the datatype of the selected column", () => {
        expect(
          getSelectedColumnDatatype({ factTable, column: column.column }),
        ).toBe(column.datatype);
        expect(
          getSelectedColumnDatatype({ factTable, column: column2.column }),
        ).toBe(column2.datatype);
        expect(
          getSelectedColumnDatatype({ factTable, column: userIdColumn.column }),
        ).toBe(userIdColumn.datatype);
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: numericColumn.column,
          }),
        ).toBe(numericColumn.datatype);
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: deletedColumn.column,
          }),
        ).toBe(deletedColumn.datatype);
        expect(
          getSelectedColumnDatatype({ factTable, column: jsonColumn.column }),
        ).toBe(jsonColumn.datatype);
      });

      it("supports nested JSON fields", () => {
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.a`,
          }),
        ).toBe("string");
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.b`,
          }),
        ).toBe("number");
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.c.d`,
          }),
        ).toBe("string");
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.c.e`,
          }),
        ).toBe("number");
      });

      it("returns undefined for unknown columns", () => {
        expect(
          getSelectedColumnDatatype({ factTable, column: "unknown" }),
        ).toBe(undefined);

        expect(
          getSelectedColumnDatatype({
            factTable,
            column: `${jsonColumn.column}.unknown`,
          }),
        ).toBe(undefined);
      });

      it("Can exclude deleted columns", () => {
        expect(
          getSelectedColumnDatatype({
            factTable,
            column: deletedColumn.column,
            excludeDeleted: true,
          }),
        ).toBe(undefined);
      });
    });
  });
});

function mockIndexedPvalue(
  pvalues: number[],
  index?: number[],
): IndexedPValue[] {
  // @ts-expect-error IndexedPValue typing here is for convenience
  return pvalues.map((p, i) => {
    return { pValue: p, index: [index ? index[i] : i] };
  });
}

describe("pvalue correction method", () => {
  it("does HB procedure correctly", () => {
    expect(
      adjustPValuesHolmBonferroni(
        mockIndexedPvalue([0.01, 0.04, 0.03, 0.005, 0.55, 0.6]),
      ),
    ).toEqual(
      mockIndexedPvalue([0.03, 0.05, 0.12, 0.12, 1, 1], [3, 0, 2, 1, 4, 5]),
    );
  });
  it("does BH procedure correctly", () => {
    expect(
      adjustPValuesBenjaminiHochberg(
        mockIndexedPvalue([0.898, 0.138, 0.007, 0.964, 0.538, 0.006, 0.138]),
      ).map((x) => {
        return { pValue: +x.pValue.toFixed(8), index: x.index };
      }),
    ).toEqual(
      mockIndexedPvalue(
        [0.964, 0.964, 0.7532, 0.2415, 0.2415, 0.0245, 0.0245],
        [3, 0, 4, 1, 6, 2, 5],
      ),
    );
  });
});

describe("pvalue correction on results", () => {
  it("pvals and CIs adjusted in place", () => {
    const results = [
      {
        name: "res1",
        srm: 0.5,
        variations: [
          {
            users: 100,
            metrics: {
              met1: { value: 0, cr: 0, users: 0, pValue: 0.025 },
              met2: { value: 0, cr: 0, users: 0, pValue: 0.03 },
            },
          },
        ],
      },
    ];
    const expectedResultsHB = [
      {
        name: "res1",
        srm: 0.5,
        variations: [
          {
            users: 100,
            metrics: {
              met1: {
                value: 0,
                cr: 0,
                users: 0,
                pValue: 0.025,
                pValueAdjusted: 0.05,
              },
              met2: {
                value: 0,
                cr: 0,
                users: 0,
                pValue: 0.03,
                pValueAdjusted: 0.05,
              },
            },
          },
        ],
      },
    ];
    const expectedResultsBH = [
      {
        name: "res1",
        srm: 0.5,
        variations: [
          {
            users: 100,
            metrics: {
              met1: {
                value: 0,
                cr: 0,
                users: 0,
                pValue: 0.025,
                pValueAdjusted: 0.03,
              },
              met2: {
                value: 0,
                cr: 0,
                users: 0,
                pValue: 0.03,
                pValueAdjusted: 0.03,
              },
            },
          },
        ],
      },
    ];

    setAdjustedPValuesOnResults(results, ["met1", "met2"], "holm-bonferroni");
    expect(results).toEqual(expectedResultsHB);
    setAdjustedPValuesOnResults(
      results,
      ["met1", "met2"],
      "benjamini-hochberg",
    );
    expect(results).toEqual(expectedResultsBH);
  });

  it("does BH procedure correctly", () => {
    expect(
      adjustPValuesBenjaminiHochberg(
        mockIndexedPvalue([0.898, 0.138, 0.007, 0.964, 0.538, 0.006, 0.138]),
      ).map((x) => {
        return { pValue: +x.pValue.toFixed(8), index: x.index };
      }),
    ).toEqual(
      mockIndexedPvalue(
        [0.964, 0.964, 0.7532, 0.2415, 0.2415, 0.0245, 0.0245],
        [3, 0, 4, 1, 6, 2, 5],
      ),
    );
  });

  it("adjusts CIs as we expect", () => {
    const adjCIs95pct = adjustedCI(0.049999999, 0.1, 0.05);
    expect(adjCIs95pct[0]).toBeGreaterThan(0);
    expect(adjCIs95pct[1]).toBeLessThan(0.2);
    expect(adjCIs95pct.map((x) => +x.toFixed(8))).toEqual([0, 0.2]);

    expect(
      adjustedCI(0.0099999999, 0.1, 0.01).map((x) => +x.toFixed(8)),
    ).toEqual([0, 0.2]);
  });
});

function roundToSeventhDecimal(num: number): number {
  return Number(num.toFixed(7));
}

describe("chanceToWinFlatPrior", () => {
  it("chance to win flat prior correct", () => {
    const alpha = Math.PI / 100;
    const expected = Math.sqrt(Math.PI);
    const s = Math.PI;
    const multiplier_two_sided = normal.quantile(1 - alpha / 2, 0, 1);
    const multiplier_one_sided = normal.quantile(1 - alpha, 0, 1);

    const truth = 0.7136874;
    const truthInverse = 1 - truth;
    const lower_two_sided = expected - s * multiplier_two_sided;
    const upper_two_sided = expected + s * multiplier_two_sided;
    const lower_one_sided = expected - s * multiplier_one_sided;
    const upper_one_sided = expected + s * multiplier_one_sided;

    expect(
      chanceToWinFlatPrior(
        expected,
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        alpha,
        true,
      ),
    ).toEqual(0);
    expect(chanceToWinFlatPrior(0, -1, 1, alpha, true)).toEqual(0.5); //sanity check that effect size of 0 results in 0.5
    expect(chanceToWinFlatPrior(0, 0, 0, alpha, true)).toEqual(0); //sanity check that effect size of 0 and 0 uncertainty results in 0
    expect(chanceToWinFlatPrior(1, 0, 0, alpha, true)).toEqual(0); //sanity check that effect size of 1 and 0 uncertainty results in 1 for inverse case
    expect(chanceToWinFlatPrior(1, 0, 0, alpha, false)).toEqual(1); //sanity check that effect size of 1 and 0 uncertainty results in 1 for non-inverse case
    expect(
      roundToSeventhDecimal(
        chanceToWinFlatPrior(
          expected,
          lower_two_sided,
          upper_two_sided,
          alpha,
          false,
        ),
      ),
    ).toEqual(roundToSeventhDecimal(truth));
    expect(
      roundToSeventhDecimal(
        chanceToWinFlatPrior(
          expected,
          lower_two_sided,
          upper_two_sided,
          alpha,
          true,
        ),
      ),
    ).toEqual(roundToSeventhDecimal(truthInverse));
    expect(
      roundToSeventhDecimal(
        chanceToWinFlatPrior(
          expected,
          Number.NEGATIVE_INFINITY,
          upper_one_sided,
          alpha,
          false,
        ),
      ),
    ).toEqual(roundToSeventhDecimal(truth));
    expect(
      roundToSeventhDecimal(
        chanceToWinFlatPrior(
          expected,
          Number.NEGATIVE_INFINITY,
          upper_one_sided,
          alpha,
          true,
        ),
      ),
    ).toEqual(roundToSeventhDecimal(truthInverse));
    expect(
      roundToSeventhDecimal(
        chanceToWinFlatPrior(
          expected,
          lower_one_sided,
          Number.POSITIVE_INFINITY,
          alpha,
          false,
        ),
      ),
    ).toEqual(roundToSeventhDecimal(truth));
    expect(
      roundToSeventhDecimal(
        chanceToWinFlatPrior(
          expected,
          lower_one_sided,
          Number.POSITIVE_INFINITY,
          alpha,
          true,
        ),
      ),
    ).toEqual(roundToSeventhDecimal(truthInverse));
  });
});
