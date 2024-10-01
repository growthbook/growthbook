import {
  FactTableInterface,
  ColumnInterface,
  FactFilterInterface,
} from "back-end/types/fact-table";
import { getColumnRefWhereClause } from "../src/experiments";

describe("Experiments", () => {
  describe("getColumnRefWhereClause", () => {
    const column: ColumnInterface = {
      column: "event_name",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "The name of the event",
      numberFormat: "",
      name: "Event Name",
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

    const factTable: Pick<
      FactTableInterface,
      "userIdTypes" | "columns" | "filters"
    > = {
      columns: [column, numericColumn, deletedColumn],
      filters: [filter, filter2],
      userIdTypes: ["user_id"],
    };

    const escapeStringLiteral = (str: string) => str.replace(/'/g, "''");

    it("returns empty array when there are no filters or prompt values", () => {
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
            promptValues: {},
            factTableId: "",
          },
          escapeStringLiteral
        )
      ).toStrictEqual([]);
    });
    it("ignores invalid filters or prompt values", () => {
      expect(
        getColumnRefWhereClause(
          factTable,
          {
            column: column.column,
            filters: ["unknown_id"],
            factTableId: "",
            promptValues: {
              unknown_column: ["unknown_value"],
              [numericColumn.column]: ["1"],
              [deletedColumn.column]: ["deleted"],
              [userIdColumn.column]: ["user"],
            },
          },
          escapeStringLiteral
        )
      ).toStrictEqual([]);
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
    it("returns where clause for single prompt value", () => {
      expect(
        getColumnRefWhereClause(
          factTable,
          {
            column: column.column,
            filters: [],
            promptValues: {
              [column.column]: ["login"],
            },
            factTableId: "",
          },
          escapeStringLiteral
        )
      ).toStrictEqual([`${column.column} = 'login'`]);
    });
    it("returns where clause for multiple prompt values", () => {
      expect(
        getColumnRefWhereClause(
          factTable,
          {
            column: column.column,
            filters: [],
            promptValues: {
              [column.column]: ["login", "signup"],
            },
            factTableId: "",
          },
          escapeStringLiteral
        )
      ).toStrictEqual([`${column.column} IN (\n  'login',\n  'signup'\n)`]);
    });
    it("returns where clause for prompt values and filters", () => {
      expect(
        getColumnRefWhereClause(
          factTable,
          {
            column: column.column,
            filters: [filter.id],
            promptValues: {
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
            promptValues: {
              [column.column]: ["login's"],
            },
            factTableId: "",
          },
          escapeStringLiteral
        )
      ).toStrictEqual([`${column.column} = 'login''s'`]);
    });
  });
});
