import { ColumnInterface } from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { TestQueryResult } from "shared/types/integrations";
import {
  keepCurrentTopValues,
  runColumnsTopValueCountsQuery,
  refreshColumnTopValues,
  runColumnDetectionQuery,
  selectColumnsForTopValues,
} from "back-end/src/services/factTableColumns";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn() },
}));

const getSourceIntegrationObjectMock =
  getSourceIntegrationObject as jest.MockedFunction<
    typeof getSourceIntegrationObject
  >;

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

async function refreshColumns({
  column,
  result,
}: {
  column: ColumnInterface;
  result: TestQueryResult;
}): Promise<ColumnInterface[]> {
  // @ts-expect-error - this test only needs the query methods
  const integration: SourceIntegrationInterface = {
    getTestQuery: jest.fn().mockReturnValue("SELECT * FROM fact_table"),
    runTestQuery: jest.fn().mockResolvedValue(result),
  };
  getSourceIntegrationObjectMock.mockReturnValue(integration);

  // @ts-expect-error - this test only needs permissions and organization settings
  const context: ReqContext = {
    permissions: { canRunFactQueries: () => true },
    org: {},
  };
  // @ts-expect-error - this test does not read datasource fields
  const datasource: DataSourceInterface = {};

  return runColumnDetectionQuery(context, datasource, {
    id: "ftb_1",
    sql: "SELECT * FROM fact_table",
    eventName: "",
    columns: [column],
    userIdTypes: [],
  });
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

  it("caps total columns at maxColumns", () => {
    const columns = Array.from({ length: 60 }, (_, i) => makeCol(`col_${i}`));
    const result = selectColumnsForTopValues({
      columns,
      userIdTypes: [],
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
    });
    expect(result.map((c) => c.column)).toEqual(["country"]);
  });
});

describe("runColumnsTopValueCountsQuery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("asks the query for exact counts", async () => {
    const getColumnsTopValuesQuery = jest
      .fn()
      .mockReturnValue("SELECT top_values");
    const runColumnsTopValuesQuery = jest.fn().mockResolvedValue({
      rows: [{ column: "country", value: "US", count: 3 }],
    });
    // @ts-expect-error - this test only needs the top-values query methods
    const integration: SourceIntegrationInterface = {
      getColumnsTopValuesQuery,
      runColumnsTopValuesQuery,
    };
    getSourceIntegrationObjectMock.mockReturnValue(integration);
    // @ts-expect-error - this test only needs permissions and organization settings
    const context: ReqContext = {
      permissions: { canRunFactQueries: () => true },
      org: {},
    };
    // @ts-expect-error - this test only needs a datasource type
    const datasource: DataSourceInterface = { type: "clickhouse" };

    const result = await runColumnsTopValueCountsQuery(
      context,
      datasource,
      {
        id: "ftb_1",
        sql: "SELECT * FROM fact_table",
        eventName: "",
        columns: [],
      },
      [makeCol("country")],
      { needsCounts: true },
    );

    expect(getColumnsTopValuesQuery).toHaveBeenCalledWith(
      expect.objectContaining({ needsCounts: true }),
    );
    expect(runColumnsTopValuesQuery).toHaveBeenCalledWith(
      "SELECT top_values",
      "ftb_1",
    );
    expect(result).toEqual({ country: [{ value: "US", count: 3 }] });
  });
});

describe("refreshColumnTopValues", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports only columns from successful chunks", async () => {
    const columns = Array.from({ length: 26 }, (_, index) =>
      makeCol(`col_${index}`, {
        topValues: [`stale_${index}`],
      }),
    );
    const runColumnsTopValuesQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ column: "col_0", value: "fresh", count: 3 }],
      })
      .mockRejectedValueOnce(new Error("query failed"));
    // @ts-expect-error - this test only needs the top-values query methods
    const integration: SourceIntegrationInterface = {
      getColumnsTopValuesQuery: jest.fn().mockReturnValue("SELECT top_values"),
      runColumnsTopValuesQuery,
    };
    getSourceIntegrationObjectMock.mockReturnValue(integration);
    // @ts-expect-error - this test only needs permissions and organization settings
    const context: ReqContext = {
      permissions: { canRunFactQueries: () => true },
      org: {},
    };
    // @ts-expect-error - this test only needs a datasource type
    const datasource: DataSourceInterface = { type: "bigquery" };

    const updates = await refreshColumnTopValues(
      context,
      datasource,
      {
        id: "ftb_1",
        sql: "SELECT * FROM fact_table",
        eventName: "",
        userIdTypes: [],
      },
      columns,
    );

    expect(updates.map((u) => u.column)).toEqual(
      columns.slice(0, 25).map((column) => column.column),
    );
    expect(updates[0].snapshot.values).toEqual([{ value: "fresh", count: 3 }]);
    expect(updates[1].snapshot.values).toEqual([]);
    // The detected columns themselves are left for the caller to update
    expect(columns[0].topValues).toEqual(["stale_0"]);
  });
});

describe("keepCurrentTopValues", () => {
  const snapshot = {
    values: [{ value: "US", count: 5 }],
    refreshedAt: new Date("2026-08-19T12:00:00.000Z"),
  };

  it("drops columns that are no longer eligible", () => {
    const result = keepCurrentTopValues({
      currentColumns: [
        makeCol("country"),
        makeCol("user_id"),
        makeCol("deleted_column", { deleted: true }),
      ],
      currentUserIdTypes: ["user_id"],
      updates: [
        { column: "country", snapshot },
        { column: "user_id", snapshot },
        { column: "deleted_column", snapshot },
        { column: "gone", snapshot },
      ],
    });

    expect(result.map((u) => u.column)).toEqual(["country"]);
  });

  it("keeps Auto Slice levels edited while the query ran", () => {
    // Slices a user edited during the (slow) top-values scan must survive,
    // not be clobbered by levels generated from the job-start snapshot.
    const result = keepCurrentTopValues({
      currentColumns: [
        makeCol("country", {
          isAutoSliceColumn: true,
          autoSlices: ["user-edited"],
        }),
        makeCol("plan", { isAutoSliceColumn: true }),
        makeCol("browser", {
          isAutoSliceColumn: false,
          autoSlices: ["current-manual"],
        }),
      ],
      currentUserIdTypes: [],
      updates: [
        { column: "country", snapshot, autoSlices: ["stale-generated"] },
        { column: "plan", snapshot, autoSlices: ["free", "pro"] },
        { column: "browser", snapshot, autoSlices: ["stale-generated"] },
      ],
    });

    expect(result.map((u) => u.autoSlices)).toEqual([
      undefined,
      ["free", "pro"],
      undefined,
    ]);
  });
});

describe("runColumnDetectionQuery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps case-distinct keys in JSON stored as a string", async () => {
    const columns = await refreshColumns({
      column: makeCol("payload", {
        datatype: "json",
        dataTypeFromWarehouse: "string",
        jsonFields: { userId: { datatype: "number" } },
      }),
      result: {
        columns: [{ name: "payload", dataType: "string" }],
        results: [{ payload: '{"userid": 2}' }],
        duration: 1,
      },
    });

    expect(columns[0].jsonFields).toEqual({
      userId: { datatype: "number" },
      userid: { datatype: "number" },
    });
  });

  it("keeps case-distinct keys in a native JSON column", async () => {
    const columns = await refreshColumns({
      column: makeCol("payload", {
        datatype: "json",
        dataTypeFromWarehouse: "json",
        jsonFields: { userId: { datatype: "number" } },
      }),
      result: {
        columns: [{ name: "payload", dataType: "json" }],
        results: [{ payload: { userid: 2 } }],
        duration: 1,
      },
    });

    expect(columns[0].jsonFields).toEqual({
      userId: { datatype: "number" },
      userid: { datatype: "number" },
    });
  });

  it("reconciles casing changes in STRUCT fields returned by warehouse schema metadata", async () => {
    const columns = await refreshColumns({
      column: makeCol("payload", {
        datatype: "json",
        dataTypeFromWarehouse: "json",
        jsonFields: { userid: { datatype: "number" } },
      }),
      result: {
        columns: [
          {
            name: "payload",
            dataType: "json",
            fields: [{ name: "userId", dataType: "number" }],
          },
        ],
        results: [{ payload: { userId: 1 } }],
        duration: 1,
      },
    });

    expect(columns[0].jsonFields).toEqual({
      userid: { datatype: "number" },
    });
  });

  it("backfills a missing warehouse datatype from query metadata", async () => {
    const columns = await refreshColumns({
      column: makeCol("payload", {
        datatype: "json",
      }),
      result: {
        columns: [{ name: "payload", dataType: "string" }],
        results: [{ payload: '{"id": 1}' }],
        duration: 1,
      },
    });

    expect(columns[0]).toMatchObject({
      datatype: "json",
      dataTypeFromWarehouse: "string",
    });
  });

  it("keeps the last warehouse datatype when the query response has no metadata", async () => {
    const columns = await refreshColumns({
      column: makeCol("payload", {
        datatype: "json",
        dataTypeFromWarehouse: "string",
      }),
      result: {
        results: [{ payload: '{"id": 1}' }],
        duration: 1,
      },
    });

    expect(columns[0].dataTypeFromWarehouse).toBe("string");
  });

  it("marks a missing column deleted without clearing its warehouse datatype", async () => {
    const columns = await refreshColumns({
      column: makeCol("payload", {
        dataTypeFromWarehouse: "string",
      }),
      result: {
        results: [],
        duration: 1,
      },
    });

    expect(columns[0]).toMatchObject({
      deleted: true,
      dataTypeFromWarehouse: "string",
    });
  });

  it("does not mutate the input columns", async () => {
    const column = makeCol("missing");
    const originalDateUpdated = column.dateUpdated;

    await refreshColumns({
      column,
      result: {
        results: [],
        duration: 1,
      },
    });

    expect(column.deleted).toBe(false);
    expect(column.dateUpdated).toBe(originalDateUpdated);
  });
});
