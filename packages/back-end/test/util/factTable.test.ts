import { ColumnInterface } from "shared/types/fact-table";
import {
  DataSourceInterface,
  GrowthbookClickhouseDataSource,
} from "shared/types/datasource";
import {
  columnsHaveAutoSlices,
  deriveUserIdTypesFromColumns,
  ensureAutoSliceDefaults,
  normalizePersistedColumn,
  getMostRecentUpdateOccurrence,
  normalizeJSONFieldsInput,
  stripIncompatibleFields,
} from "back-end/src/util/factTable";

function makeColumn(column: string, deleted = false): ColumnInterface {
  return {
    column,
    deleted,
  } as unknown as ColumnInterface;
}

function makeClickhouseDatasource(
  materializedColumns: { columnName: string; type: string }[],
): GrowthbookClickhouseDataSource {
  return {
    type: "growthbook_clickhouse",
    settings: {
      materializedColumns,
      // Legacy growthbook_clickhouse warehouses mirror userIdTypes from their
      // materializedColumns identifiers (type === "identifier").
      userIdTypes: materializedColumns
        .filter((c) => c.type === "identifier")
        .map((c) => ({ userIdType: c.columnName, description: "" })),
    },
  } as unknown as GrowthbookClickhouseDataSource;
}

function makeStandardDatasource(
  userIdTypes: { userIdType: string }[],
): DataSourceInterface {
  return {
    type: "redshift",
    settings: { userIdTypes },
  } as unknown as DataSourceInterface;
}

describe("columnsHaveAutoSlices", () => {
  it("returns false when columns is undefined", () => {
    expect(columnsHaveAutoSlices()).toBe(false);
  });

  it("returns false for an empty array", () => {
    expect(columnsHaveAutoSlices([])).toBe(false);
  });

  it("returns false when no column configures auto slices", () => {
    expect(
      columnsHaveAutoSlices([
        { isAutoSliceColumn: false },
        { isAutoSliceColumn: false, autoSlices: undefined },
      ]),
    ).toBe(false);
  });

  it("returns true when a column is flagged isAutoSliceColumn", () => {
    expect(
      columnsHaveAutoSlices([
        { isAutoSliceColumn: false },
        { isAutoSliceColumn: true },
      ]),
    ).toBe(true);
  });

  it("returns true when a column supplies autoSlices values", () => {
    expect(columnsHaveAutoSlices([{ autoSlices: ["us", "ca"] }])).toBe(true);
  });

  it("treats an empty autoSlices array as truthy (matches existing handler behavior)", () => {
    expect(columnsHaveAutoSlices([{ autoSlices: [] }])).toBe(true);
  });
});

describe("normalizeJSONFieldsInput", () => {
  it("returns undefined when jsonFields is undefined", () => {
    expect(normalizeJSONFieldsInput(undefined)).toBeUndefined();
  });

  it("fills an omitted nested datatype with the empty-string sentinel", () => {
    expect(normalizeJSONFieldsInput({ foo: {} })).toEqual({
      foo: { datatype: "" },
    });
  });

  it("preserves a supplied nested datatype", () => {
    expect(normalizeJSONFieldsInput({ foo: { datatype: "number" } })).toEqual({
      foo: { datatype: "number" },
    });
  });

  it("normalizes each field independently", () => {
    expect(
      normalizeJSONFieldsInput({
        user_id: { datatype: "string" },
        age: {},
      }),
    ).toEqual({
      user_id: { datatype: "string" },
      age: { datatype: "" },
    });
  });
});

function makeConstraintColumn(
  overrides: Partial<ColumnInterface> = {},
): ColumnInterface {
  return {
    column: "col",
    name: "col",
    description: "",
    numberFormat: "",
    datatype: "string",
    dateCreated: new Date("2020-01-01"),
    dateUpdated: new Date("2020-01-01"),
    deleted: false,
    ...overrides,
  };
}

describe("stripIncompatibleFields", () => {
  it("returns an unchanged-equivalent column when datatype is empty", () => {
    const column = makeConstraintColumn({
      datatype: "",
      alwaysInlineFilter: true,
      isAutoSliceColumn: true,
      numberFormat: "currency",
      jsonFields: { foo: { datatype: "string" } },
    });
    expect(stripIncompatibleFields(column)).toEqual(column);
  });

  it("leaves a valid column untouched", () => {
    const column = makeConstraintColumn({
      datatype: "string",
      alwaysInlineFilter: true,
    });
    expect(stripIncompatibleFields(column)).toEqual(column);
  });

  it("clears alwaysInlineFilter when the datatype is not string", () => {
    const column = makeConstraintColumn({
      datatype: "number",
      alwaysInlineFilter: true,
    });
    expect(stripIncompatibleFields(column)).toEqual({
      ...column,
      alwaysInlineFilter: false,
    });
  });

  it("clears isAutoSliceColumn and autoSlices when the datatype is not string or boolean", () => {
    const column = makeConstraintColumn({
      datatype: "number",
      isAutoSliceColumn: true,
      autoSlices: ["1", "2"],
    });
    expect(stripIncompatibleFields(column)).toEqual({
      ...column,
      isAutoSliceColumn: false,
      autoSlices: undefined,
    });
  });

  it("resets numberFormat to an empty string when the datatype is not number", () => {
    const column = makeConstraintColumn({
      datatype: "string",
      numberFormat: "currency",
    });
    expect(stripIncompatibleFields(column)).toEqual({
      ...column,
      numberFormat: "",
    });
  });

  it("clears jsonFields when the datatype is not json", () => {
    const column = makeConstraintColumn({
      datatype: "string",
      jsonFields: { foo: { datatype: "string" } },
    });
    expect(stripIncompatibleFields(column)).toEqual({
      ...column,
      jsonFields: undefined,
    });
  });
});

describe("ensureAutoSliceDefaults", () => {
  it("defaults autoSlices to [] when auto-slicing is enabled without values", () => {
    const column = makeConstraintColumn({
      datatype: "string",
      isAutoSliceColumn: true,
    });
    expect(ensureAutoSliceDefaults(column).autoSlices).toEqual([]);
  });

  it('coerces a boolean column autoSlices to ["true", "false"]', () => {
    const column = makeConstraintColumn({
      datatype: "boolean",
      isAutoSliceColumn: true,
      autoSlices: ["yes", "no"],
    });
    expect(ensureAutoSliceDefaults(column).autoSlices).toEqual([
      "true",
      "false",
    ]);
  });

  it("leaves autoSlices untouched on a non-auto-slice string column", () => {
    const column = makeConstraintColumn({ datatype: "string" });
    expect(ensureAutoSliceDefaults(column).autoSlices).toBeUndefined();
  });
});

describe("normalizePersistedColumn", () => {
  it("clears an incompatible prop instead of throwing", () => {
    const column = makeConstraintColumn({
      datatype: "number",
      alwaysInlineFilter: true,
    });
    expect(normalizePersistedColumn(column).alwaysInlineFilter).toBe(false);
  });

  it("drops auto-slicing when the datatype cannot support it", () => {
    const column = makeConstraintColumn({
      datatype: "number",
      isAutoSliceColumn: true,
      autoSlices: ["1", "2"],
    });
    const result = normalizePersistedColumn(column);
    expect(result.isAutoSliceColumn).toBe(false);
    expect(result.autoSlices).toBeUndefined();
  });

  it('coerces boolean auto-slice values to ["true", "false"]', () => {
    const column = makeConstraintColumn({
      datatype: "boolean",
      isAutoSliceColumn: true,
      autoSlices: ["yes", "no"],
    });
    expect(normalizePersistedColumn(column).autoSlices).toEqual([
      "true",
      "false",
    ]);
  });

  it("defers all healing while the datatype is empty", () => {
    const column = makeConstraintColumn({
      datatype: "",
      alwaysInlineFilter: true,
      numberFormat: "currency",
    });
    const result = normalizePersistedColumn(column);
    expect(result.alwaysInlineFilter).toBe(true);
    expect(result.numberFormat).toBe("currency");
  });
});

describe("getMostRecentUpdateOccurrence", () => {
  const updateTime = { time: "02:00", timezone: "UTC" };

  it("returns today's slot once now is past it", () => {
    expect(
      getMostRecentUpdateOccurrence(
        updateTime,
        new Date("2024-01-10T10:00:00Z"),
      ),
    ).toEqual(new Date("2024-01-10T02:00:00Z"));
  });

  it("is stable across the rest of the day (keeps the poller from re-claiming)", () => {
    const morning = getMostRecentUpdateOccurrence(
      updateTime,
      new Date("2024-01-10T02:30:00Z"),
    );
    const night = getMostRecentUpdateOccurrence(
      updateTime,
      new Date("2024-01-10T23:59:00Z"),
    );
    expect(morning).toEqual(night);
    expect(morning).toEqual(new Date("2024-01-10T02:00:00Z"));
  });

  it("rolls back to the previous day when now is before today's slot", () => {
    expect(
      getMostRecentUpdateOccurrence(
        updateTime,
        new Date("2024-01-10T01:00:00Z"),
      ),
    ).toEqual(new Date("2024-01-09T02:00:00Z"));
  });

  it("advances to the next day's slot once it passes (poller fires then)", () => {
    expect(
      getMostRecentUpdateOccurrence(
        updateTime,
        new Date("2024-01-11T02:30:00Z"),
      ),
    ).toEqual(new Date("2024-01-11T02:00:00Z"));
  });

  it("resolves the slot in the table's timezone", () => {
    expect(
      getMostRecentUpdateOccurrence(
        { time: "02:00", timezone: "America/New_York" },
        new Date("2024-01-10T12:00:00Z"),
      ),
    ).toEqual(new Date("2024-01-10T07:00:00Z"));
  });
});

describe("deriveUserIdTypesFromColumns", () => {
  describe("growthbook_clickhouse datasource", () => {
    it("returns identifier userIdTypes that appear in active fact table columns", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
        { columnName: "device_id", type: "identifier" },
        { columnName: "revenue", type: "number" },
      ]);
      const cols = [
        makeColumn("user_id"),
        makeColumn("device_id"),
        makeColumn("revenue"),
      ];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([
        "user_id",
        "device_id",
      ]);
    });

    it("excludes deleted fact table columns", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
        { columnName: "device_id", type: "identifier" },
      ]);
      const cols = [
        makeColumn("user_id"),
        makeColumn("device_id", true), // deleted
      ];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual(["user_id"]);
    });

    it("excludes identifier columns not present in fact table columns", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
        { columnName: "anonymous_id", type: "identifier" }, // not in fact table
      ]);
      const cols = [makeColumn("user_id")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual(["user_id"]);
    });

    it("returns empty array when userIdTypes is empty", () => {
      const ds = makeClickhouseDatasource([]);
      const cols = [makeColumn("user_id"), makeColumn("event_name")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when userIdTypes is missing", () => {
      const ds = {
        type: "growthbook_clickhouse",
        settings: {},
      } as unknown as GrowthbookClickhouseDataSource;
      const cols = [makeColumn("user_id")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when no identifiers match any column", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "revenue", type: "number" },
        { columnName: "country", type: "string" },
      ]);
      const cols = [makeColumn("revenue"), makeColumn("country")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when all identifier columns are deleted", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
      ]);
      const cols = [makeColumn("user_id", true)];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when columns list is empty", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
      ]);
      expect(deriveUserIdTypesFromColumns(ds, [])).toEqual([]);
    });
  });

  describe("standard (non-ClickHouse) datasources", () => {
    it("returns datasource userIdTypes that appear as active fact table columns", () => {
      const ds = makeStandardDatasource([
        { userIdType: "user_id" },
        { userIdType: "anonymous_id" },
      ]);
      const cols = [
        makeColumn("user_id"),
        makeColumn("anonymous_id"),
        makeColumn("revenue"),
      ];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([
        "user_id",
        "anonymous_id",
      ]);
    });

    it("excludes deleted fact table columns", () => {
      const ds = makeStandardDatasource([
        { userIdType: "user_id" },
        { userIdType: "anonymous_id" },
      ]);
      const cols = [
        makeColumn("user_id"),
        makeColumn("anonymous_id", true), // deleted
      ];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual(["user_id"]);
    });

    it("excludes userIdTypes not present as columns in the fact table", () => {
      const ds = makeStandardDatasource([
        { userIdType: "user_id" },
        { userIdType: "anonymous_id" }, // not a column
      ]);
      const cols = [makeColumn("user_id"), makeColumn("revenue")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual(["user_id"]);
    });

    it("returns empty array when datasource has no userIdTypes", () => {
      const ds = makeStandardDatasource([]);
      const cols = [makeColumn("user_id")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when datasource userIdTypes is missing", () => {
      const ds = {
        type: "redshift",
        settings: {},
      } as unknown as DataSourceInterface;
      const cols = [makeColumn("user_id")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });

    it("returns empty array when columns list is empty", () => {
      const ds = makeStandardDatasource([{ userIdType: "user_id" }]);
      expect(deriveUserIdTypesFromColumns(ds, [])).toEqual([]);
    });

    it("returns empty array when no identifiers match any column", () => {
      const ds = makeStandardDatasource([{ userIdType: "user_id" }]);
      const cols = [makeColumn("revenue"), makeColumn("country")];
      expect(deriveUserIdTypesFromColumns(ds, cols)).toEqual([]);
    });
  });
});
