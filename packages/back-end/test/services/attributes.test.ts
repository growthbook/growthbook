import type { MaterializedColumn } from "shared/types/datasource";
import { diffMaterializedColumnsForFactTable } from "back-end/src/services/attributes";

const col = (
  name: string,
  overrides: Partial<MaterializedColumn> = {},
): MaterializedColumn => ({
  columnName: name,
  sourceField: name,
  datatype: "string",
  type: "dimension",
  ...overrides,
});

describe("diffMaterializedColumnsForFactTable", () => {
  it("returns empty diff when previous and final are identical", () => {
    const cols = [col("a"), col("b")];
    expect(diffMaterializedColumnsForFactTable(cols, cols, [])).toEqual({
      columnsToAdd: [],
      columnsToDelete: [],
      columnsToRename: [],
    });
  });

  it("emits adds for columns only in final", () => {
    const { columnsToAdd, columnsToDelete, columnsToRename } =
      diffMaterializedColumnsForFactTable([col("a")], [col("a"), col("b")], []);
    expect(columnsToAdd).toEqual([col("b")]);
    expect(columnsToDelete).toEqual([]);
    expect(columnsToRename).toEqual([]);
  });

  it("emits deletes for columns only in previous", () => {
    const { columnsToAdd, columnsToDelete, columnsToRename } =
      diffMaterializedColumnsForFactTable([col("a"), col("b")], [col("a")], []);
    expect(columnsToAdd).toEqual([]);
    expect(columnsToDelete).toEqual(["b"]);
    expect(columnsToRename).toEqual([]);
  });

  it("applies a rename when from exists in previous and to exists in final", () => {
    const diff = diffMaterializedColumnsForFactTable(
      [col("device_id"), col("user_id")],
      [col("deviceId"), col("user_id")],
      [{ from: "device_id", to: "deviceId" }],
    );
    expect(diff.columnsToRename).toEqual([
      { from: "device_id", to: "deviceId" },
    ]);
    expect(diff.columnsToAdd).toEqual([]);
    expect(diff.columnsToDelete).toEqual([]);
  });

  it("falls through to add/delete when rename source isn't in previous", () => {
    // Source column doesn't exist — treat as a plain add of `deviceId`.
    const diff = diffMaterializedColumnsForFactTable(
      [col("user_id")],
      [col("user_id"), col("deviceId")],
      [{ from: "device_id", to: "deviceId" }],
    );
    expect(diff.columnsToRename).toEqual([]);
    expect(diff.columnsToAdd).toEqual([col("deviceId")]);
    expect(diff.columnsToDelete).toEqual([]);
  });

  it("falls through to add/delete when rename dest isn't in final", () => {
    // Dest dropped from final — treat as plain delete of `device_id`.
    const diff = diffMaterializedColumnsForFactTable(
      [col("device_id"), col("user_id")],
      [col("user_id")],
      [{ from: "device_id", to: "deviceId" }],
    );
    expect(diff.columnsToRename).toEqual([]);
    expect(diff.columnsToAdd).toEqual([]);
    expect(diff.columnsToDelete).toEqual(["device_id"]);
  });

  it("skips a rename whose destination collides with an existing previous column", () => {
    // Both `device_id` and `deviceId` already exist in previous; renaming one
    // onto the other would clobber the existing column. Should fall through.
    const diff = diffMaterializedColumnsForFactTable(
      [col("device_id"), col("deviceId")],
      [col("deviceId")],
      [{ from: "device_id", to: "deviceId" }],
    );
    expect(diff.columnsToRename).toEqual([]);
    expect(diff.columnsToDelete).toEqual(["device_id"]);
    expect(diff.columnsToAdd).toEqual([]);
  });

  it("ignores no-op self-renames", () => {
    const diff = diffMaterializedColumnsForFactTable(
      [col("a")],
      [col("a")],
      [{ from: "a", to: "a" }],
    );
    expect(diff.columnsToRename).toEqual([]);
    expect(diff.columnsToAdd).toEqual([]);
    expect(diff.columnsToDelete).toEqual([]);
  });

  it("handles multiple renames plus an unrelated add/delete in one diff", () => {
    const diff = diffMaterializedColumnsForFactTable(
      [col("device_id"), col("session"), col("legacy")],
      [col("deviceId"), col("sessionId"), col("brand_new")],
      [
        { from: "device_id", to: "deviceId" },
        { from: "session", to: "sessionId" },
      ],
    );
    expect(diff.columnsToRename).toEqual([
      { from: "device_id", to: "deviceId" },
      { from: "session", to: "sessionId" },
    ]);
    expect(diff.columnsToAdd).toEqual([col("brand_new")]);
    expect(diff.columnsToDelete).toEqual(["legacy"]);
  });

  it("preserves the column's datatype and arrayElementType when renaming", () => {
    const diff = diffMaterializedColumnsForFactTable(
      [
        col("tags", {
          datatype: "string",
          arrayElementType: "string",
          type: "dimension",
        }),
      ],
      [
        col("user_tags", {
          datatype: "string",
          arrayElementType: "string",
          type: "dimension",
        }),
      ],
      [{ from: "tags", to: "user_tags" }],
    );
    expect(diff.columnsToRename).toEqual([{ from: "tags", to: "user_tags" }]);
    expect(diff.columnsToAdd).toEqual([]);
    expect(diff.columnsToDelete).toEqual([]);
  });
});
