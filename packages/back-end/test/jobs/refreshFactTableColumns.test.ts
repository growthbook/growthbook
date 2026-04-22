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
  it("selects all eligible string columns when under the cap", () => {
    const columns = [
      makeCol("country"),
      makeCol("browser"),
      makeCol("plan_type"),
    ];
    const result = selectColumnsForTopValues({
      columns,
      userIdTypes: [],
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
    });
    expect(result.map((c) => c.column)).toEqual(["country", "browser"]);
  });

  it("caps newly-captured columns at maxNewColumns", () => {
    const columns = Array.from({ length: 60 }, (_, i) => makeCol(`col_${i}`));
    const result = selectColumnsForTopValues({
      columns,
      userIdTypes: [],
      maxNewColumns: 50,
    });
    expect(result).toHaveLength(50);
    expect(result[0].column).toBe("col_0");
    expect(result[49].column).toBe("col_49");
  });

  it("always includes alwaysInlineFilter and isAutoSliceColumn even past the cap", () => {
    const columns: ColumnInterface[] = [];
    // 50 plain string columns
    for (let i = 0; i < 50; i++) {
      columns.push(makeCol(`plain_${i}`));
    }
    // Overflow plain columns that should get dropped
    columns.push(makeCol("overflow_plain_1"));
    columns.push(makeCol("overflow_plain_2"));
    // Always-captured columns past the cap
    columns.push(makeCol("always_1", { alwaysInlineFilter: true }));
    columns.push(makeCol("auto_slice_1", { isAutoSliceColumn: true }));

    const result = selectColumnsForTopValues({
      columns,
      userIdTypes: [],
      maxNewColumns: 50,
    });

    const columnNames = result.map((c) => c.column);

    expect(columnNames).toContain("always_1");
    expect(columnNames).toContain("auto_slice_1");
    expect(columnNames).not.toContain("overflow_plain_1");
    expect(columnNames).not.toContain("overflow_plain_2");
    // Always-captured (2) + 50 plain = 52 total
    expect(result).toHaveLength(52);
  });

  it("does not double-count always-captured columns against the new-column cap", () => {
    const columns: ColumnInterface[] = [
      makeCol("always_1", { alwaysInlineFilter: true }),
      makeCol("auto_1", { isAutoSliceColumn: true }),
    ];
    // Add exactly maxNewColumns plain columns
    for (let i = 0; i < 50; i++) {
      columns.push(makeCol(`plain_${i}`));
    }

    const result = selectColumnsForTopValues({
      columns,
      userIdTypes: [],
      maxNewColumns: 50,
    });

    // All 2 always-captured + 50 plain = 52, none should be dropped
    expect(result).toHaveLength(52);
  });

  it("excludes user-id type columns even when marked alwaysInlineFilter", () => {
    const columns = [
      makeCol("user_id", { alwaysInlineFilter: true }),
      makeCol("country"),
    ];
    const result = selectColumnsForTopValues({
      columns,
      userIdTypes: ["user_id"],
    });
    expect(result.map((c) => c.column)).toEqual(["country"]);
  });
});
