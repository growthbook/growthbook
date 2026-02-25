import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import {
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import type { ReqContext } from "back-end/types/request";
import {
  getManagedWarehouseUserIdTypes,
  updateMaterializedColumns,
} from "back-end/src/services/clickhouse";
import {
  getFactTablesForDatasource,
  updateFactTable,
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
  updateFactTable: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  lockDataSource: jest.fn(),
  unlockDataSource: jest.fn(),
}));

const mockGetFactTablesForDatasource = jest.mocked(getFactTablesForDatasource);
const mockUpdateFactTable = jest.mocked(updateFactTable);
const mockLockDataSource = jest.mocked(lockDataSource);
const mockUnlockDataSource = jest.mocked(unlockDataSource);

function makeClickhouseDatasource(
  materializedColumns: { columnName: string; type: string }[],
): GrowthbookClickhouseDataSource {
  return {
    type: "growthbook_clickhouse",
    settings: { materializedColumns },
  } as unknown as GrowthbookClickhouseDataSource;
}

function makeColumn(column: string, deleted = false): ColumnInterface {
  return {
    column,
    deleted,
  } as unknown as ColumnInterface;
}

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

describe("getManagedWarehouseUserIdTypes", () => {
  describe("throws when called with unsupported inputs", () => {
    it("throws for growthbook_clickhouse with wrong factTableId", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
      ]);
      expect(() =>
        getManagedWarehouseUserIdTypes(ds, "ch_exposures", []),
      ).toThrow(
        "This function can only be called for managed warehouse datasource and table.",
      );
    });
  });

  describe(`returns string[] for growthbook_clickhouse + ${MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID}`, () => {
    it("returns empty array when materializedColumns are missing", () => {
      const ds = {
        type: "growthbook_clickhouse",
        settings: {},
      } as unknown as GrowthbookClickhouseDataSource;
      const cols = [makeColumn("user_id")];
      expect(
        getManagedWarehouseUserIdTypes(
          ds,
          MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
          cols,
        ),
      ).toEqual([]);
    });

    it("returns empty array when datasource has no materializedColumns", () => {
      const ds = makeClickhouseDatasource([]);
      const cols = [makeColumn("user_id"), makeColumn("event_name")];
      expect(
        getManagedWarehouseUserIdTypes(
          ds,
          MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
          cols,
        ),
      ).toEqual([]);
    });

    it("returns empty array when no materialized columns are identifiers", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "revenue", type: "number" },
        { columnName: "country", type: "string" },
      ]);
      const cols = [makeColumn("revenue"), makeColumn("country")];
      expect(
        getManagedWarehouseUserIdTypes(
          ds,
          MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
          cols,
        ),
      ).toEqual([]);
    });

    it("returns identifier column names that exist as active columns", () => {
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
      expect(
        getManagedWarehouseUserIdTypes(
          ds,
          MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
          cols,
        ),
      ).toEqual(["user_id", "device_id"]);
    });

    it("excludes identifier columns that are deleted in the fact table", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
        { columnName: "device_id", type: "identifier" },
      ]);
      const cols = [
        makeColumn("user_id"),
        makeColumn("device_id", true), // deleted
      ];
      expect(
        getManagedWarehouseUserIdTypes(
          ds,
          MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
          cols,
        ),
      ).toEqual(["user_id"]);
    });

    it("returns empty array when all identifier columns are deleted", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
      ]);
      const cols = [makeColumn("user_id", true)]; // deleted
      expect(
        getManagedWarehouseUserIdTypes(
          ds,
          MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
          cols,
        ),
      ).toEqual([]);
    });

    it("excludes identifier columns not present in the fact table columns at all", () => {
      const ds = makeClickhouseDatasource([
        { columnName: "user_id", type: "identifier" },
        { columnName: "anonymous_id", type: "identifier" }, // not in fact table yet
      ]);
      const cols = [makeColumn("user_id")];
      expect(
        getManagedWarehouseUserIdTypes(
          ds,
          MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
          cols,
        ),
      ).toEqual(["user_id"]);
    });
  });
});

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
    mockUpdateFactTable.mockResolvedValue(undefined as never);
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

    expect(mockUpdateFactTable).toHaveBeenCalledTimes(1);
    const changes = mockUpdateFactTable.mock.calls[0][2] as {
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

    expect(mockUpdateFactTable).toHaveBeenCalledTimes(1);
    const changes = mockUpdateFactTable.mock.calls[0][2] as {
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
