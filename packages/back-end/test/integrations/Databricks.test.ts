import {
  TColumnDesc,
  TTableSchema,
  TTypeId,
} from "@databricks/sql/thrift/TCLIService_types";
import { getDatabricksResultColumns } from "back-end/src/services/databricks";

function column(
  columnName: string,
  type: TTypeId | undefined,
  position: number,
): TColumnDesc {
  return {
    columnName,
    position,
    typeDesc: {
      types: type === undefined ? [] : [{ primitiveEntry: { type } }],
    },
  } as TColumnDesc;
}

function schema(columns: TColumnDesc[]): TTableSchema {
  return { columns } as TTableSchema;
}

describe("getDatabricksResultColumns", () => {
  it("maps the Thrift type ids", () => {
    expect(
      getDatabricksResultColumns(
        schema([
          column("user_id", TTypeId.STRING_TYPE, 1),
          column("ts", TTypeId.TIMESTAMP_TYPE, 2),
          column("day", TTypeId.DATE_TYPE, 3),
          column("revenue", TTypeId.DECIMAL_TYPE, 4),
          column("count", TTypeId.BIGINT_TYPE, 5),
          column("is_new", TTypeId.BOOLEAN_TYPE, 6),
          column("props", TTypeId.STRUCT_TYPE, 7),
          column("tags", TTypeId.ARRAY_TYPE, 8),
          column("blob", TTypeId.BINARY_TYPE, 9),
        ]),
      ),
    ).toEqual([
      { name: "user_id", dataType: "string" },
      { name: "ts", dataType: "date" },
      { name: "day", dataType: "date" },
      { name: "revenue", dataType: "number" },
      { name: "count", dataType: "number" },
      { name: "is_new", dataType: "boolean" },
      { name: "props", dataType: "json" },
      { name: "tags", dataType: "other" },
      { name: "blob", dataType: "binary" },
    ]);
  });

  it("restores the SELECT order", () => {
    expect(
      getDatabricksResultColumns(
        schema([
          column("third", TTypeId.INT_TYPE, 3),
          column("first", TTypeId.INT_TYPE, 1),
          column("second", TTypeId.INT_TYPE, 2),
        ]),
      )?.map((c) => c.name),
    ).toEqual(["first", "second", "third"]);
  });

  it("leaves an undetectable type off the column", () => {
    // NULL_TYPE is an all-null expression, and a missing type entry shouldn't
    // drop the column -- the create flow lets the user set it
    expect(
      getDatabricksResultColumns(
        schema([
          column("all_nulls", TTypeId.NULL_TYPE, 1),
          column("no_type_entry", undefined, 2),
        ]),
      ),
    ).toEqual([{ name: "all_nulls" }, { name: "no_type_entry" }]);
  });

  it("returns undefined when there is no schema", () => {
    expect(getDatabricksResultColumns(null)).toBeUndefined();
  });
});
