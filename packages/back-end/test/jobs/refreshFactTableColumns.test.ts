import { ColumnInterface } from "shared/types/fact-table";
import { selectColumnsForTopValues } from "back-end/src/jobs/refreshFactTableColumns";

function makeCol(
  column: string,
  overrides: Partial<ColumnInterface> = {},
): ColumnInterface {
  return {
    column,
    datatype: "string",
    deleted: false,
    name: column,
    description: "",
    numberFormat: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  };
}

describe("selectColumnsForTopValues", () => {
  describe("with supportsEfficient=true", () => {
    it("selects all eligible string columns when under the cap", () => {
      const columns = [
        makeCol("country"),
        makeCol("browser"),
        makeCol("plan_type"),
      ];
      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: [],
        supportsEfficient: true,
      });
      expect(result.map((c) => c.column)).toEqual([
        "country",
        "browser",
        "plan_type",
      ]);
    });

    it("excludes user-id type columns", () => {
      const columns = [
        makeCol("user_id"),
        makeCol("device_id"),
        makeCol("country"),
      ];
      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: ["user_id", "device_id"],
        supportsEfficient: true,
      });
      expect(result.map((c) => c.column)).toEqual(["country"]);
    });

    it("excludes non-string columns", () => {
      const columns = [
        makeCol("country"),
        makeCol("revenue", { datatype: "number" }),
        makeCol("created_at", { datatype: "date" }),
        makeCol("is_active", { datatype: "boolean" }),
        makeCol("payload", { datatype: "json" }),
      ];
      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: [],
        supportsEfficient: true,
      });
      expect(result.map((c) => c.column)).toEqual(["country"]);
    });

    it("excludes deleted columns", () => {
      const columns = [
        makeCol("country"),
        makeCol("old_col", { deleted: true }),
        makeCol("browser"),
      ];
      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: [],
        supportsEfficient: true,
      });
      expect(result.map((c) => c.column)).toEqual(["country", "browser"]);
    });

    it("caps total columns at maxColumns", () => {
      const columns = Array.from({ length: 60 }, (_, i) => makeCol(`col_${i}`));
      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: [],
        supportsEfficient: true,
        maxColumns: 50,
      });
      expect(result).toHaveLength(50);
      expect(result[0].column).toBe("col_0");
      expect(result[49].column).toBe("col_49");
    });

    it("always includes alwaysInlineFilter and isAutoSliceColumn; fills remaining slots with new columns up to the total cap", () => {
      const columns: ColumnInterface[] = [];
      // A bunch of plain columns
      for (let i = 0; i < 60; i++) {
        columns.push(makeCol(`plain_${i}`));
      }
      // Always-captured columns
      columns.push(makeCol("always_1", { alwaysInlineFilter: true }));
      columns.push(makeCol("auto_slice_1", { isAutoSliceColumn: true }));

      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: [],
        supportsEfficient: true,
        maxColumns: 50,
      });

      const columnNames = result.map((c) => c.column);

      // Total cap is 50: 2 always-captured + 48 new = 50 total
      expect(result).toHaveLength(50);
      expect(columnNames).toContain("always_1");
      expect(columnNames).toContain("auto_slice_1");
      expect(columnNames).toContain("plain_0");
      expect(columnNames).toContain("plain_47");
      expect(columnNames).not.toContain("plain_48");
      expect(columnNames).not.toContain("plain_59");
    });

    it("still includes all always-captured columns even if they exceed the total cap", () => {
      const columns: ColumnInterface[] = [];
      // More always-captured columns than the cap
      for (let i = 0; i < 55; i++) {
        columns.push(makeCol(`always_${i}`, { alwaysInlineFilter: true }));
      }
      columns.push(makeCol("plain_1"));

      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: [],
        supportsEfficient: true,
        maxColumns: 50,
      });

      const columnNames = result.map((c) => c.column);
      // All 55 always-captured included; no room for plain
      expect(result).toHaveLength(55);
      expect(columnNames).not.toContain("plain_1");
    });

    it("excludes user-id type columns even when marked alwaysInlineFilter", () => {
      const columns = [
        makeCol("user_id", { alwaysInlineFilter: true }),
        makeCol("country"),
      ];
      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: ["user_id"],
        supportsEfficient: true,
      });
      expect(result.map((c) => c.column)).toEqual(["country"]);
    });
  });

  describe("with supportsEfficient=false", () => {
    it("only includes explicitly opted-in columns (alwaysInlineFilter or isAutoSliceColumn)", () => {
      const columns = [
        makeCol("country"),
        makeCol("browser", { alwaysInlineFilter: true }),
        makeCol("plan_type", { isAutoSliceColumn: true }),
        makeCol("other"),
      ];
      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: [],
        supportsEfficient: false,
      });
      expect(result.map((c) => c.column)).toEqual(["browser", "plan_type"]);
    });

    it("returns an empty list when no columns are explicitly opted in", () => {
      const columns = [makeCol("country"), makeCol("browser")];
      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: [],
        supportsEfficient: false,
      });
      expect(result).toEqual([]);
    });

    it("excludes user-id type columns even when opted in", () => {
      const columns = [
        makeCol("user_id", { alwaysInlineFilter: true }),
        makeCol("country", { isAutoSliceColumn: true }),
      ];
      const result = selectColumnsForTopValues({
        columns,
        userIdTypes: ["user_id"],
        supportsEfficient: false,
      });
      expect(result.map((c) => c.column)).toEqual(["country"]);
    });
  });
});
