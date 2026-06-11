import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import {
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import type { ReqContext } from "back-end/types/request";
import {
  listSessionReplays,
  updateMaterializedColumns,
} from "back-end/src/services/clickhouse";
import { updateMaterializedColumnsInClickhouse } from "back-end/src/services/licenseServerManagedClickhouse";
import {
  getFactTablesForDatasource,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { getGrowthbookDatasource } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";

jest.mock("back-end/src/services/licenseServerManagedClickhouse", () => ({
  updateMaterializedColumnsInClickhouse: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTablesForDatasource: jest.fn(),
  updateFactTableColumns: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getGrowthbookDatasource: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));

const mockGetFactTablesForDatasource = jest.mocked(getFactTablesForDatasource);
const mockUpdateFactTableColumns = jest.mocked(updateFactTableColumns);
const mockUpdateMaterializedColumnsLicense = jest.mocked(
  updateMaterializedColumnsInClickhouse,
);
const mockGetGrowthbookDatasource = jest.mocked(getGrowthbookDatasource);
const mockGetSourceIntegrationObject = jest.mocked(getSourceIntegrationObject);

function makeFactTableColumn(
  column: string,
  overrides: Partial<ColumnInterface> = {},
): ColumnInterface {
  return {
    column,
    name: column,
    datatype: "string",
    dateCreated: new Date("2024-01-01T00:00:00.000Z"),
    dateUpdated: new Date("2024-01-01T00:00:00.000Z"),
    deleted: false,
    description: "",
    numberFormat: "",
    ...overrides,
  };
}

function makeFactTable(columns: ColumnInterface[]): FactTableInterface {
  return {
    id: MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
    datasource: "managed_warehouse",
    columns,
  } as unknown as FactTableInterface;
}

describe("updateMaterializedColumns", () => {
  const context = {
    org: { id: "org_test" },
  } as unknown as ReqContext;

  const datasource = {
    id: "managed_warehouse",
    organization: "org_test",
    type: "growthbook_clickhouse",
    settings: {},
  } as unknown as GrowthbookClickhouseDataSource;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateFactTableColumns.mockResolvedValue(undefined as never);
  });

  it("restores an existing deleted column when adding a materialized column with the same name", async () => {
    const ft = makeFactTable([
      makeFactTableColumn("user_id", {
        deleted: true,
      }),
    ]);
    mockGetFactTablesForDatasource.mockResolvedValue([ft]);

    const finalColumns: MaterializedColumn[] = [
      {
        columnName: "user_id",
        sourceField: "user_id",
        datatype: "string",
        type: "identifier",
      },
    ];

    await updateMaterializedColumns({
      context,
      datasource,
      columnsToAdd: finalColumns,
      columnsToDelete: [],
      columnsToRename: [],
      finalColumns,
      originalColumns: [],
    });

    expect(mockUpdateMaterializedColumnsLicense).toHaveBeenCalledTimes(1);
    expect(mockUpdateFactTableColumns).toHaveBeenCalledTimes(1);
    const changes = mockUpdateFactTableColumns.mock.calls[0][1] as {
      columns: ColumnInterface[];
      userIdTypes: string[];
    };
    expect(changes.userIdTypes).toEqual(["user_id"]);
    expect(changes.columns.find((c) => c.column === "user_id")?.deleted).toBe(
      false,
    );
  });

  it("does not call the managed warehouse service when provisioning is not complete", async () => {
    const unprovisionedDs = {
      ...datasource,
      settings: { hasBeenProvisioned: false },
    } as unknown as GrowthbookClickhouseDataSource;

    await updateMaterializedColumns({
      context,
      datasource: unprovisionedDs,
      columnsToAdd: [],
      columnsToDelete: [],
      columnsToRename: [],
      finalColumns: [],
      originalColumns: [],
    });

    expect(mockUpdateMaterializedColumnsLicense).not.toHaveBeenCalled();
  });

  it("restores deleted rename destination and tombstones source when destination name already exists", async () => {
    const ft = makeFactTable([
      makeFactTableColumn("userId"),
      makeFactTableColumn("user_id", {
        deleted: true,
      }),
    ]);
    mockGetFactTablesForDatasource.mockResolvedValue([ft]);

    const finalColumns: MaterializedColumn[] = [
      {
        columnName: "user_id",
        sourceField: "user_id",
        datatype: "string",
        type: "identifier",
      },
    ];

    await updateMaterializedColumns({
      context,
      datasource,
      columnsToAdd: [],
      columnsToDelete: [],
      columnsToRename: [{ from: "userId", to: "user_id" }],
      finalColumns,
      originalColumns: [],
    });

    expect(mockUpdateMaterializedColumnsLicense).toHaveBeenCalledTimes(1);
    expect(mockUpdateFactTableColumns).toHaveBeenCalledTimes(1);
    const changes = mockUpdateFactTableColumns.mock.calls[0][1] as {
      columns: ColumnInterface[];
      userIdTypes: string[];
    };
    expect(changes.userIdTypes).toEqual(["user_id"]);
    expect(changes.columns.find((c) => c.column === "user_id")?.deleted).toBe(
      false,
    );
    expect(changes.columns.find((c) => c.column === "userId")?.deleted).toBe(
      true,
    );
  });
});

describe("listSessionReplays", () => {
  const context = {
    org: { id: "org_test" },
  } as unknown as ReqContext;

  const datasource = {
    id: "managed_warehouse",
    organization: "org_test",
    type: "growthbook_clickhouse",
    settings: {},
  } as unknown as GrowthbookClickhouseDataSource;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGrowthbookDatasource.mockResolvedValue(datasource);
  });

  it("adds supported session replay filters to the ClickHouse query", async () => {
    const runQuery = jest.fn().mockResolvedValue({ rows: [] });
    mockGetSourceIntegrationObject.mockReturnValue({
      runQuery,
    } as never);

    await listSessionReplays(context, {
      userId: "user'1",
      clientKey: "ck_1",
      state: "finalized",
      url: "https://example.com/path",
      country: "US",
      device: "desktop",
      minDurationSecs: 1.25,
      maxDurationSecs: 10,
      minEventCount: 5,
      maxEventCount: 25,
      featureKey: "flag'one",
      experimentKey: "exp_one",
      limit: 50,
      offset: 100,
    });

    expect(runQuery).toHaveBeenCalledTimes(1);
    const query = runQuery.mock.calls[0][0] as string;
    expect(query).toContain("deleted_at IS NULL");
    expect(query).toContain("user_id = 'user\\'1'");
    expect(query).toContain("client_key = 'ck_1'");
    expect(query).toContain("state = 'finalized'");
    expect(query).toContain(
      "positionCaseInsensitive(url_first, 'https://example.com/path') > 0",
    );
    expect(query).toContain("country = 'US'");
    expect(query).toContain("device = 'desktop'");
    expect(query).toContain("duration_ms >= 1250");
    expect(query).toContain("duration_ms <= 10000");
    expect(query).toContain("event_count >= 5");
    expect(query).toContain("event_count <= 25");
    expect(query).toContain("has(feature_keys, 'flag\\'one')");
    expect(query).toContain("has(experiment_keys, 'exp_one')");
    expect(query).toContain("LIMIT 50");
    expect(query).toContain("OFFSET 100");
  });

  it("returns an empty list when there is no datasource", async () => {
    mockGetGrowthbookDatasource.mockResolvedValue(null);
    const runQuery = jest.fn().mockResolvedValue({ rows: [] });
    mockGetSourceIntegrationObject.mockReturnValue({
      runQuery,
    } as never);

    await expect(listSessionReplays(context)).resolves.toEqual([]);
    expect(runQuery).not.toHaveBeenCalled();
  });
});
