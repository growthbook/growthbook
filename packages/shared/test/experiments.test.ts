import {
  FactTableInterface,
  ColumnInterface,
  FactFilterInterface,
} from "back-end/types/fact-table";
import {
  getColumnRefWhereClause,
  canInlineFilterColumn,
  getAggregateFilters,
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
      columns: [column, column2, userIdColumn, numericColumn, deletedColumn],
      filters: [filter, filter2, filter3],
      userIdTypes: ["user_id"],
    };

    const escapeStringLiteral = (str: string) => str.replace(/'/g, "''");

    describe("canInlineFilterColumn", () => {
      it("returns true for string columns with alwaysInlineFilter", () => {
        expect(
          canInlineFilterColumn(factTable, {
            column: column.column,
            datatype: column.datatype,
            deleted: column.deleted,
          })
        ).toBe(true);
      });
      it("returns true for string columns, even if alwaysInlineFilter is false", () => {
        expect(
          canInlineFilterColumn(factTable, {
            column: column2.column,
            datatype: column2.datatype,
            deleted: column2.deleted,
          })
        ).toBe(true);
      });
      it("returns false for deleted columns", () => {
        expect(
          canInlineFilterColumn(factTable, {
            column: deletedColumn.column,
            datatype: deletedColumn.datatype,
            deleted: deletedColumn.deleted,
          })
        ).toBe(false);
      });
      it("returns false for numeric columns", () => {
        expect(
          canInlineFilterColumn(factTable, {
            column: numericColumn.column,
            datatype: numericColumn.datatype,
            deleted: numericColumn.deleted,
          })
        ).toBe(false);
      });
      it("returns false for userId columns", () => {
        expect(
          canInlineFilterColumn(factTable, {
            column: userIdColumn.column,
            datatype: userIdColumn.datatype,
            deleted: userIdColumn.deleted,
          })
        ).toBe(false);
      });
    });

    describe("getColumnRefWhereClause", () => {
      it("returns empty array when there are no filters", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: "event_name",
              filters: [],
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: "event_name",
              filters: [],
              inlineFilters: {},
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: "event_name",
              filters: [],
              inlineFilters: {
                [column.column]: [],
              },
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([]);

        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: "event_name",
              filters: [],
              inlineFilters: {
                [column.column]: [""],
              },
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([]);
      });
      it("ignores invalid filters, but uses invalid inline filter columns", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
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
            escapeStringLiteral
          )
        ).toStrictEqual([
          "unknown_column = 'unknown_value'",
          `${numericColumn.column} = '1'`,
          `${deletedColumn.column} = 'deleted'`,
          `${userIdColumn.column} = 'user'`,
        ]);
      });
      it("returns where clause for single filter", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [filter.id],
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([filter.value]);
      });
      it("returns where clause for multiple filters", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [filter.id, filter2.id],
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([filter.value, filter2.value]);
      });
      it("returns where clause for single inline filter value", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login"],
              },
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([`${column.column} = 'login'`]);
      });
      it("returns where clause for multiple inline filter values", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login", "signup"],
              },
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([`${column.column} IN (\n  'login',\n  'signup'\n)`]);
      });
      it("returns where clause for inline filters and filters", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [filter.id],
              inlineFilters: {
                [column.column]: ["login"],
              },
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([`${column.column} = 'login'`, filter.value]);
      });
      it("escapes string literals", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login's"],
              },
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([`${column.column} = 'login''s'`]);
      });
      it("removes duplicate inline filter and filter values", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [filter3.id],
              inlineFilters: {
                [column.column]: ["login"],
              },
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([`${column.column} = 'login'`]);
      });
      it("removes duplicate inline filter values", () => {
        expect(
          getColumnRefWhereClause(
            factTable,
            {
              column: column.column,
              filters: [],
              inlineFilters: {
                [column.column]: ["login", "login"],
              },
              factTableId: "",
            },
            escapeStringLiteral
          )
        ).toStrictEqual([`${column.column} = 'login'`]);
      });
    });
    describe("getAggregateFilter", () => {
      it("returns empty array for empty input", () => {
        expect(
          getAggregateFilters({
            columnRef: null,
            column: "value",
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">10",
              aggregateFilterColumn: "",
            },
            column: "value",
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: " ",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: " , ",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
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
          })
        ).toStrictEqual(["value > 0"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: " < 5,",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value < 5"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: ">= 10",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value >= 10"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "<= 15",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value <= 15"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "=1.5",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value = 1.5"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "!=0.15",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual(["value != 0.15"]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$distinctUsers",
              aggregateFilter: "<> 0.15",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
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
          })
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
          })
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
          })
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
          })
        ).toStrictEqual([]);
        expect(
          getAggregateFilters({
            columnRef: {
              column: "$$count",
              aggregateFilter: ">5",
              aggregateFilterColumn: "v",
            },
            column: "value",
          })
        ).toStrictEqual([]);
      });
    });
  });
});
