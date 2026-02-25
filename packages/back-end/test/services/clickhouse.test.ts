import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import {
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import type { ReqContext } from "back-end/types/request";
import { updateMaterializedColumns } from "back-end/src/services/clickhouse";
import {
  getFactTablesForDatasource,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import {
  lockDataSource,
  unlockDataSource,
} from "back-end/src/models/DataSourceModel";

const mockCommand = jest.fn();
const mockClickhouseClient = {
  command: mockCommand,
};

jest.mock("@clickhouse/client", () => ({
  createClient: jest.fn(() => mockClickhouseClient),
}));

jest.mock("back-end/src/util/secrets", () => ({
  CLICKHOUSE_HOST: "http://localhost:8123",
  CLICKHOUSE_ADMIN_USER: "admin",
  CLICKHOUSE_ADMIN_PASSWORD: "password",
  CLICKHOUSE_DATABASE: "default",
  CLICKHOUSE_MAIN_TABLE: "events",
  ENVIRONMENT: "development",
  IS_CLOUD: false,
  CLICKHOUSE_DEV_PREFIX: "dev_",
  CLICKHOUSE_OVERAGE_TABLE: "overage",
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTablesForDatasource: jest.fn(),
  updateFactTableColumns: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  lockDataSource: jest.fn(),
  unlockDataSource: jest.fn(),
}));

const mockGetFactTablesForDatasource = jest.mocked(getFactTablesForDatasource);
const mockUpdateFactTableColumns = jest.mocked(updateFactTableColumns);
const mockLockDataSource = jest.mocked(lockDataSource);
const mockUnlockDataSource = jest.mocked(unlockDataSource);

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
    mockCommand.mockResolvedValue(undefined);
    mockLockDataSource.mockResolvedValue(undefined as never);
    mockUnlockDataSource.mockResolvedValue(undefined as never);
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
