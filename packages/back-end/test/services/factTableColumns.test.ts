import { ColumnInterface } from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { TestQueryResult } from "shared/types/integrations";
import {
  mergeRefreshedTopValues,
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
        rows: [{ column: "col_0", value: "fresh" }],
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

    const refreshedColumns = await refreshColumnTopValues(
      context,
      datasource,
      {
        sql: "SELECT * FROM fact_table",
        eventName: "",
        userIdTypes: [],
      },
      columns,
    );

    expect(refreshedColumns.map((column) => column.column)).toEqual(
      columns.slice(0, 25).map((column) => column.column),
    );
    expect(columns[0].topValues).toEqual(["fresh"]);
    expect(columns[1].topValues).toEqual([]);
    expect(columns[25].topValues).toEqual(["stale_25"]);
    expect(columns[25].topValuesDate).toBeUndefined();
  });
});

describe("mergeRefreshedTopValues", () => {
  it("preserves concurrent metadata and newly added virtual columns", () => {
    const topValuesDate = new Date("2026-08-19T12:00:00.000Z");
    const currentCountry = makeCol("country", {
      name: "Country label",
      description: "Edited while the query ran",
      alwaysInlineFilter: true,
      numberFormat: "compact",
    });
    const addedVirtualColumn = makeCol("revenue_bucket", {
      datatype: "number",
      isVirtual: true,
      sql: "CASE WHEN revenue > 100 THEN 1 ELSE 0 END",
    });
    const countryWithRefreshedTopValues = makeCol("country", {
      name: "Stale country label",
      description: "Stale description",
      topValues: ["US", "CA"],
      topValuesDate,
    });

    const result = mergeRefreshedTopValues({
      currentColumns: [currentCountry, addedVirtualColumn],
      currentUserIdTypes: [],
      refreshedColumns: [countryWithRefreshedTopValues],
    });

    expect(result).toEqual([
      {
        ...currentCountry,
        topValues: ["US", "CA"],
        topValuesDate,
      },
      addedVirtualColumn,
    ]);
  });

  it("does not merge columns without a successful refresh result", () => {
    const failedColumn = makeCol("failed", {
      topValues: ["current-failed"],
    });
    const missingEnrichmentColumn = makeCol("missing_enrichment", {
      topValues: ["current-missing"],
    });

    const result = mergeRefreshedTopValues({
      currentColumns: [failedColumn, missingEnrichmentColumn],
      currentUserIdTypes: [],
      refreshedColumns: [],
    });

    expect(result).toEqual([failedColumn, missingEnrichmentColumn]);
  });

  it("does not merge columns that are no longer eligible", () => {
    const userIdColumn = makeCol("user_id", {
      topValues: ["current-user"],
    });
    const deletedColumn = makeCol("deleted_column", {
      deleted: true,
      topValues: ["current-deleted"],
    });
    const refreshedColumns = [
      makeCol("user_id", {
        topValues: ["stale-user"],
        topValuesDate: new Date("2026-08-19T12:00:00.000Z"),
      }),
      makeCol("deleted_column", {
        topValues: ["stale-deleted"],
        topValuesDate: new Date("2026-08-19T12:00:00.000Z"),
      }),
    ];

    const result = mergeRefreshedTopValues({
      currentColumns: [userIdColumn, deletedColumn],
      currentUserIdTypes: ["user_id"],
      refreshedColumns,
    });

    expect(result).toEqual([userIdColumn, deletedColumn]);
  });

  it("preserves concurrently edited auto slices and derives fresh ones from refreshed top values", () => {
    const topValuesDate = new Date("2026-08-19T12:00:00.000Z");
    // Slices a user edited during the (slow) top-values scan must survive the
    // merge, not be clobbered by the stale job-start snapshot.
    const editedAutoSliceColumn = makeCol("country", {
      isAutoSliceColumn: true,
      autoSlices: ["user-edited"],
    });
    // An auto-slice column without existing slices derives them from the
    // freshly refreshed top values.
    const freshAutoSliceColumn = makeCol("plan", {
      isAutoSliceColumn: true,
    });
    const noLongerAutoSliceColumn = makeCol("browser", {
      isAutoSliceColumn: false,
      autoSlices: ["current-manual"],
    });

    const result = mergeRefreshedTopValues({
      currentColumns: [
        editedAutoSliceColumn,
        freshAutoSliceColumn,
        noLongerAutoSliceColumn,
      ],
      currentUserIdTypes: [],
      refreshedColumns: [
        makeCol("country", {
          isAutoSliceColumn: true,
          autoSlices: ["stale-generated"],
          topValues: ["US", "CA"],
          topValuesDate,
        }),
        makeCol("plan", {
          isAutoSliceColumn: true,
          // refreshColumnTopValues already derived these from the new top
          // values, since the current column had none.
          autoSlices: ["free", "pro"],
          topValues: ["free", "pro"],
          topValuesDate,
        }),
        makeCol("browser", {
          isAutoSliceColumn: true,
          autoSlices: ["stale-generated"],
          topValues: ["Chrome"],
          topValuesDate,
        }),
      ],
    });

    expect(result[0]).toEqual({
      ...editedAutoSliceColumn,
      topValues: ["US", "CA"],
      topValuesDate,
      autoSlices: ["user-edited"],
    });
    expect(result[1]).toEqual({
      ...freshAutoSliceColumn,
      topValues: ["free", "pro"],
      topValuesDate,
      autoSlices: ["free", "pro"],
    });
    expect(result[2]).toEqual({
      ...noLongerAutoSliceColumn,
      topValues: ["Chrome"],
      topValuesDate,
    });
  });
});

describe("runColumnDetectionQuery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
