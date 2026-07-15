import normal from "@stdlib/stats/base/dists/normal";
import {
  FactTableInterface,
  ColumnInterface,
  FactFilterInterface,
} from "shared/types/fact-table";
import { IndexedPValue } from "shared/types/stats";
import {
  getColumnRefWhereClause,
  canInlineFilterColumn,
  getAggregateFilters,
  getColumnExpression,
  expandVirtualColumnsInSql,
  sqlReferencesColumn,
  getSelectedColumnDatatype,
  adjustPValuesBenjaminiHochberg,
  adjustPValuesHolmBonferroni,
  adjustedCI,
  setAdjustedPValuesOnResults,
  chanceToWinFlatPrior,
  getRowFilterSQL,
  getEffectiveLookbackOverride,
  getIntersectionBaseMetricIds,
} from "../src/experiments";
import { createLikeStringMatchFn } from "../src/sql";
import { LookbackOverride } from "../src/validators/experiments";

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
        bool: { datatype: "boolean" },
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
    const stringMatch = createLikeStringMatchFn({
      escapeStringLiteral,
      emitEscapeClause: false,
    });
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
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "event_name",
              rowFilters: [],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "event_name",
              rowFilters: [
                {
                  operator: "in",
                  column: column.column,
                  values: [],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "event_name",
              rowFilters: [
                // Missing value
                {
                  operator: "sql_expr",
                },
                {
                  operator: "sql_expr",
                  values: [""],
                },
                {
                  operator: "saved_filter",
                  values: [],
                },
                // Invalid values
                {
                  operator: "saved_filter",
                  values: ["invalid_id"],
                },
                // Missing column
                {
                  operator: "in",
                  column: "",
                  values: ["value1", "value2"],
                },
                {
                  operator: "is_null",
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([]);
      });
      it("Adds row filters even for columns that don't exist", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              rowFilters: [
                {
                  operator: "=",
                  column: "unknown_column",
                  values: ["unknown_value"],
                },
                {
                  operator: "=",
                  column: numericColumn.column,
                  values: ["1"],
                },
                {
                  operator: "=",
                  column: deletedColumn.column,
                  values: ["deleted"],
                },
                {
                  operator: "=",
                  column: userIdColumn.column,
                  values: ["user"],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([
          "(unknown_column = 'unknown_value')",
          `(${numericColumn.column} = 1)`,
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
              rowFilters: [
                {
                  operator: "saved_filter",
                  values: [filter.id],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([`(${filter.value})`]);
      });
      it("returns where clause for multiple filters", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              rowFilters: [
                {
                  operator: "saved_filter",
                  values: [filter.id],
                },
                {
                  operator: "saved_filter",
                  values: [filter2.id],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([`(${filter.value})`, `(${filter2.value})`]);
      });
      it("returns where clause for single row filter value", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              rowFilters: [
                {
                  operator: "in",
                  column: column.column,
                  values: ["login"],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([`(${column.column} = 'login')`]);
      });
      it("converts in to =, not_in to != when there is only 1 value", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              rowFilters: [
                {
                  operator: "in",
                  column: column.column,
                  values: ["login"],
                },
                {
                  operator: "not_in",
                  column: column.column,
                  values: ["logout"],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([
          `(${column.column} = 'login')`,
          `(${column.column} != 'logout')`,
        ]);
      });

      it("uses in clause", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              rowFilters: [
                {
                  column: column.column,
                  operator: "in",
                  values: ["login", "signup"],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([`(${column.column} IN (\n  'login',\n  'signup'\n))`]);
      });

      it("ignores duplicate values", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              rowFilters: [
                {
                  column: column.column,
                  operator: "in",
                  values: ["login", "login", "signup"],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([`(${column.column} IN (\n  'login',\n  'signup'\n))`]);
      });
      it("supports multiple row filters", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              rowFilters: [
                {
                  operator: "in",
                  column: column.column,
                  values: ["login"],
                },
                {
                  operator: "starts_with",
                  column: column.column,
                  values: ["sign"],
                },
                {
                  operator: "sql_expr",
                  values: ["device='desktop'"],
                },
                {
                  operator: "saved_filter",
                  values: [filter.id],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([
          `(${column.column} = 'login')`,
          `(${column.column} LIKE 'sign%')`,
          `(device='desktop')`,
          `(${filter.value})`,
        ]);
      });
      it("removes duplicate inline filter and filter values", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: column.column,
              rowFilters: [
                {
                  operator: "saved_filter",
                  values: [filter3.id],
                },
                {
                  operator: "=",
                  column: column.column,
                  values: ["login"],
                },
                {
                  operator: "in",
                  column: column.column,
                  values: ["login"],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            stringMatch,
          }),
        ).toStrictEqual([`(${column.column} = 'login')`]);
      });

      describe("getRowFilterSQL", () => {
        it("escapes string literals", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                operator: "=",
                column: column.column,
                values: ["login's"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} = 'login''s')`);
        });

        it("supports JSON columns", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: `${jsonColumn.column}.b`,
                operator: "=",
                values: ["hello"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${jsonColumn.column}:'b'::float = 'hello')`);
        });
        it("changes = true to is_true for boolean columns", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: boolColumn.column,
                operator: "=",
                values: ["true"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${boolColumn.column} IS TRUE)`);
        });
        it("changes = false to is_false for boolean columns", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: boolColumn.column,
                operator: "=",
                values: ["false"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${boolColumn.column} IS FALSE)`);
        });
        it("can detect column types for JSON fields", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: `${jsonColumn.column}.bool`,
                operator: "=",
                values: ["true"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${jsonColumn.column}:'bool' IS TRUE)`);
        });
        it("handles direct operators for strings", () => {
          const operators = [">", "<", ">=", "<=", "!=", "="] as const;
          for (const operator of operators) {
            expect(
              getRowFilterSQL({
                factTable,
                rowFilter: {
                  column: column.column,
                  operator,
                  values: ["foo"],
                },
                escapeStringLiteral,
                jsonExtract,
                evalBoolean,
              }),
            ).toStrictEqual(`(${column.column} ${operator} 'foo')`);
          }
        });
        it("handles direct operators for integers", () => {
          const operators = [">", "<", ">=", "<=", "!=", "="] as const;
          for (const operator of operators) {
            expect(
              getRowFilterSQL({
                factTable,
                rowFilter: {
                  column: numericColumn.column,
                  operator,
                  values: ["42"],
                },
                escapeStringLiteral,
                jsonExtract,
                evalBoolean,
              }),
            ).toStrictEqual(`(${numericColumn.column} ${operator} 42)`);
          }
        });
        it("handles direct operators for floats and negatives", () => {
          const operators = [">", "<", ">=", "<=", "!=", "="] as const;
          for (const operator of operators) {
            expect(
              getRowFilterSQL({
                factTable,
                rowFilter: {
                  column: numericColumn.column,
                  operator,
                  values: ["-42.5"],
                },
                escapeStringLiteral,
                jsonExtract,
                evalBoolean,
              }),
            ).toStrictEqual(`(${numericColumn.column} ${operator} -42.5)`);
          }
        });
        it("quotes non-numbers even for numeric columns", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: numericColumn.column,
                operator: "=",
                values: ["123a"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${numericColumn.column} = '123a')`);
        });
        it("quotes numbers for string columns", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "=",
                values: ["123"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} = '123')`);
        });
        it("handles not_in operator", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "not_in",
                values: ["foo", "bar"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} NOT IN (\n  'foo',\n  'bar'\n))`);
        });
        it("handles not_in operator for numbers", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: numericColumn.column,
                operator: "not_in",
                values: ["1", "-2", "3.5", "5c"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(
            `(${numericColumn.column} NOT IN (\n  1,\n  -2,\n  3.5,\n  '5c'\n))`,
          );
        });
        it("handles is_null operator", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "is_null",
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} IS NULL)`);
        });
        it("handles not_null operator", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "not_null",
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} IS NOT NULL)`);
        });
        it("handles starts_with operator", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "starts_with",
                values: ["foo"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} LIKE 'foo%')`);
        });
        it("handles ends_with operator", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "ends_with",
                values: ["foo"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} LIKE '%foo')`);
        });
        it("handles contains operator", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "contains",
                values: ["foo"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} LIKE '%foo%')`);
        });
        it("handles not_contains operator", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "not_contains",
                values: ["foo"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} NOT LIKE '%foo%')`);
        });
        it("escapes strings in LIKE clauses", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "contains",
                values: ["f_o'o%"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch,
            }),
          ).toStrictEqual(`(${column.column} LIKE '%f\\_o''o\\%%')`);
        });
        // Dialects like BigQuery/Snowflake treat backslash as a string-literal
        // escape character. The wildcard-escaping backslash must be inserted
        // before escapeStringLiteral runs so it gets doubled into a valid
        // escape sequence, rather than leaving an illegal bare `\_` / `\%`.
        const backslashEscapeStringLiteral = (str: string) =>
          str.replace(/(['\\])/g, "\\$1");
        it("doubles wildcard-escape backslashes for backslash-escaping dialects", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "starts_with",
                values: ["foo_bar"],
              },
              escapeStringLiteral: backslashEscapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch: createLikeStringMatchFn({
                escapeStringLiteral: backslashEscapeStringLiteral,
                emitEscapeClause: false,
              }),
            }),
          ).toStrictEqual(`(${column.column} LIKE 'foo\\\\_bar%')`);
        });
        it("escapes percent wildcards for backslash-escaping dialects", () => {
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "contains",
                values: ["50%off"],
              },
              escapeStringLiteral: backslashEscapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch: createLikeStringMatchFn({
                escapeStringLiteral: backslashEscapeStringLiteral,
                emitEscapeClause: false,
              }),
            }),
          ).toStrictEqual(`(${column.column} LIKE '%50\\\\%off%')`);
        });
        it("escapes a literal backslash in the value as a LIKE metacharacter", () => {
          // Base-style dialect (only doubles quotes). The value `a\b` must have
          // its backslash escaped so it matches literally rather than being
          // consumed as a LIKE escape.
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "starts_with",
                values: ["a\\b"],
              },
              escapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch: createLikeStringMatchFn({
                escapeStringLiteral,
                emitEscapeClause: true,
              }),
            }),
          ).toStrictEqual(`(${column.column} LIKE 'a\\\\b%' ESCAPE '\\')`);
        });
        it("appends an ESCAPE clause for backslash-doubling dialects when supported", () => {
          // Snowflake-style dialect: escapeStringLiteral doubles backslashes, so
          // the ESCAPE clause's escape char must also be doubled in the literal.
          expect(
            getRowFilterSQL({
              factTable,
              rowFilter: {
                column: column.column,
                operator: "starts_with",
                values: ["foo_bar"],
              },
              escapeStringLiteral: backslashEscapeStringLiteral,
              jsonExtract,
              evalBoolean,
              stringMatch: createLikeStringMatchFn({
                escapeStringLiteral: backslashEscapeStringLiteral,
                emitEscapeClause: true,
              }),
            }),
          ).toStrictEqual(
            `(${column.column} LIKE 'foo\\\\_bar%' ESCAPE '\\\\')`,
          );
        });
      });

      it("includes metric slices", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "foo",
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            sliceInfo: {
              isSliceMetric: true,
              baseMetricId: "fact__abc123",
              sliceLevels: [
                {
                  column: column.column,
                  datatype: "string",
                  levels: ["l1"],
                },
                {
                  column: column2.column,
                  datatype: "string",
                  levels: ["l2", "l3"],
                },
              ],
            },
            stringMatch,
          }),
        ).toStrictEqual([
          `(${column.column} = 'l1')`,
          // TODO: this should be an IN clause, fix the test once the code is updated
          `(${column2.column} = 'l2')`,
        ]);
      });
      it("includes metric auto slices - boolean", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "foo",
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            sliceInfo: {
              isSliceMetric: true,
              baseMetricId: "fact__abc123",
              sliceLevels: [
                {
                  column: boolColumn.column,
                  datatype: "boolean",
                  levels: ["true"],
                },
              ],
            },
            stringMatch,
          }),
        ).toStrictEqual([`(${boolColumn.column} IS TRUE)`]);
      });
      it("includes metric auto slices - other", () => {
        expect(
          getColumnRefWhereClause({
            factTable,
            columnRef: {
              column: "foo",
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            sliceInfo: {
              isSliceMetric: true,
              baseMetricId: "fact__abc123",
              sliceLevels: [
                {
                  column: column.column,
                  datatype: "string",
                  levels: [],
                },
              ],
            },
            stringMatch,
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
              rowFilters: [
                {
                  operator: "is_false",
                  column: boolColumn.column,
                },
                {
                  operator: "saved_filter",
                  values: [filter.id],
                },
              ],
              factTableId: "",
            },
            escapeStringLiteral,
            jsonExtract,
            evalBoolean,
            sliceInfo: {
              isSliceMetric: true,
              baseMetricId: "fact__abc123",
              sliceLevels: [
                {
                  column: column.column,
                  datatype: "string",
                  levels: ["l1"],
                },
              ],
            },
            stringMatch,
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

describe("getEffectiveLookbackOverride", () => {
  const windowOverride: LookbackOverride = {
    type: "window",
    value: 7,
    valueUnit: "days",
  };
  const dateOverride: LookbackOverride = {
    type: "date",
    value: new Date("2025-06-01"),
  };

  it("returns the override when attributionModel is 'lookbackOverride' and override is defined", () => {
    expect(
      getEffectiveLookbackOverride("lookbackOverride", windowOverride),
    ).toEqual(windowOverride);
  });

  it("returns the date override when attributionModel is 'lookbackOverride'", () => {
    expect(
      getEffectiveLookbackOverride("lookbackOverride", dateOverride),
    ).toEqual(dateOverride);
  });

  it("returns undefined when attributionModel is 'firstExposure'", () => {
    expect(
      getEffectiveLookbackOverride("firstExposure", windowOverride),
    ).toBeUndefined();
  });

  it("returns undefined when attributionModel is 'experimentDuration'", () => {
    expect(
      getEffectiveLookbackOverride("experimentDuration", windowOverride),
    ).toBeUndefined();
  });

  it("returns undefined when attributionModel is 'lookbackOverride' but override is undefined", () => {
    expect(
      getEffectiveLookbackOverride("lookbackOverride", undefined),
    ).toBeUndefined();
  });

  it("returns undefined when both are undefined", () => {
    expect(getEffectiveLookbackOverride(undefined, undefined)).toBeUndefined();
  });

  it("returns undefined when attributionModel is undefined but override is defined", () => {
    expect(
      getEffectiveLookbackOverride(undefined, windowOverride),
    ).toBeUndefined();
  });
});

describe("getIntersectionBaseMetricIds", () => {
  it("returns non-slice subset ids when superset is empty", () => {
    expect(
      getIntersectionBaseMetricIds(["a", "b", "m_goal?dim:country=us"], []),
    ).toEqual(["a", "b"]);
  });

  it("omits slice metrics and keeps base ids in superset order", () => {
    const sliceId = "m_goal?dim:country=us";
    expect(
      getIntersectionBaseMetricIds(["m_goal"], ["m_goal", sliceId, "other"]),
    ).toEqual(["m_goal"]);
  });

  it("includes every base metric in the subset that appears in the superset", () => {
    expect(
      getIntersectionBaseMetricIds(
        ["m_a", "m_b"],
        ["m_b", "m_a?dim:x=y", "m_a"],
      ),
    ).toEqual(["m_b", "m_a"]);
  });
});

describe("Virtual Columns", () => {
  const jsonExtract = (jsonCol: string, path: string, isNumeric: boolean) =>
    `${jsonCol}:'${path}'${isNumeric ? "::float" : ""}`;

  function col(
    partial: Partial<ColumnInterface> & { column: string },
  ): ColumnInterface {
    return {
      name: partial.column,
      description: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      datatype: "number",
      numberFormat: "",
      deleted: false,
      ...partial,
    };
  }

  describe("getColumnExpression (virtual)", () => {
    const factTable = {
      columns: [
        col({ column: "price", datatype: "number" }),
        col({ column: "quantity", datatype: "number" }),
        col({
          column: "vc_total",
          isVirtual: true,
          sql: "price * quantity",
          datatype: "number",
        }),
      ],
    };

    it("inlines the expression wrapped in parens", () => {
      expect(getColumnExpression("vc_total", factTable, jsonExtract)).toBe(
        "(price * quantity)",
      );
    });

    it("qualifies referenced columns with the alias", () => {
      expect(getColumnExpression("vc_total", factTable, jsonExtract, "m")).toBe(
        "(m.price * m.quantity)",
      );
    });

    it("does not rewrite column names inside string literals", () => {
      const withLiteral = {
        columns: [
          col({ column: "status", datatype: "string" }),
          col({ column: "price", datatype: "number" }),
          col({
            column: "flagged_vc",
            isVirtual: true,
            sql: "CASE WHEN status = 'price' THEN price ELSE 0 END",
            datatype: "number",
          }),
        ],
      };
      expect(
        getColumnExpression("flagged_vc", withLiteral, jsonExtract, "m"),
      ).toBe("(CASE WHEN m.status = 'price' THEN m.price ELSE 0 END)");
    });

    it("recursively inlines a virtual column that references another", () => {
      const chained = {
        columns: [
          col({ column: "price", datatype: "number" }),
          col({ column: "cost", datatype: "number" }),
          col({
            column: "margin_vc",
            isVirtual: true,
            sql: "price - cost",
            datatype: "number",
          }),
          col({
            column: "margin_pct_vc",
            isVirtual: true,
            sql: "margin_vc / price",
            datatype: "number",
          }),
        ],
      };
      expect(
        getColumnExpression("margin_pct_vc", chained, jsonExtract, "m"),
      ).toBe("((m.price - m.cost) / m.price)");
    });
  });

  describe("expandVirtualColumnsInSql", () => {
    const factTable = {
      columns: [
        col({ column: "amount", datatype: "number" }),
        col({ column: "qty", datatype: "number" }),
        col({
          column: "revenue_vc",
          isVirtual: true,
          sql: "amount * qty",
          datatype: "number",
        }),
      ],
    };

    it("expands a virtual column reference in a raw fragment (no alias)", () => {
      expect(expandVirtualColumnsInSql("revenue_vc > 100", factTable)).toBe(
        "(amount * qty) > 100",
      );
    });

    it("leaves fragments without virtual columns unchanged", () => {
      expect(expandVirtualColumnsInSql("amount > 100", factTable)).toBe(
        "amount > 100",
      );
    });

    it("does not expand a virtual column name inside a string literal", () => {
      expect(expandVirtualColumnsInSql("label = 'revenue_vc'", factTable)).toBe(
        "label = 'revenue_vc'",
      );
    });
  });

  describe("sqlReferencesColumn", () => {
    it("detects a bare identifier reference", () => {
      expect(sqlReferencesColumn("margin_vc / price", "margin_vc")).toBe(true);
    });

    it("does not match a name inside a string literal", () => {
      expect(sqlReferencesColumn("status = 'margin_vc'", "margin_vc")).toBe(
        false,
      );
    });

    it("does not match a partial identifier", () => {
      expect(sqlReferencesColumn("gross_margin_vc + 1", "margin_vc")).toBe(
        false,
      );
    });
  });
});
