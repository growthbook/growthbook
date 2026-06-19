import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import {
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import { SDKAttributeSchema } from "shared/types/organization";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import {
  buildManagedWarehouseEventsFactTableSql,
  getManagedWarehouseEventsFactTableColumns,
  getManagedWarehouseUserIdTypes,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import {
  syncManagedWarehouseIdentifiers,
  updateMaterializedColumns,
} from "back-end/src/services/clickhouse";
import { updateMaterializedColumnsInClickhouse } from "back-end/src/services/licenseServerManagedClickhouse";
import {
  dangerouslyGetFactTableByIdBypassPermission,
  dangerouslySyncManagedWarehouseFactTable,
  getFactTablesForDatasource,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import {
  dangerouslyGetGrowthbookDatasourceBypassPermission,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";

jest.mock("back-end/src/services/licenseServerManagedClickhouse", () => ({
  updateMaterializedColumnsInClickhouse: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTablesForDatasource: jest.fn(),
  updateFactTableColumns: jest.fn(),
  dangerouslyGetFactTableByIdBypassPermission: jest.fn(),
  dangerouslySyncManagedWarehouseFactTable: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  dangerouslyGetGrowthbookDatasourceBypassPermission: jest.fn(),
  updateDataSource: jest.fn(),
}));

const mockGetFactTablesForDatasource = jest.mocked(getFactTablesForDatasource);
const mockUpdateFactTableColumns = jest.mocked(updateFactTableColumns);
const mockUpdateMaterializedColumnsLicense = jest.mocked(
  updateMaterializedColumnsInClickhouse,
);
const mockGetFactTableById = jest.mocked(
  dangerouslyGetFactTableByIdBypassPermission,
);
const mockSyncFactTable = jest.mocked(dangerouslySyncManagedWarehouseFactTable);
const mockGetDatasource = jest.mocked(
  dangerouslyGetGrowthbookDatasourceBypassPermission,
);
const mockUpdateDataSource = jest.mocked(updateDataSource);

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

describe("syncManagedWarehouseIdentifiers", () => {
  const context = {
    org: { id: "org_test", settings: {} },
  } as unknown as ReqContext;

  const datasource = {
    id: "managed_warehouse",
    organization: "org_test",
    type: "growthbook_clickhouse",
    settings: { useJsonColumns: true, queries: {} },
  } as unknown as GrowthbookClickhouseDataSource;

  // Build a fact table that already matches the desired state for a schema, so
  // any write is driven solely by the override the test applies on top.
  function makeManagedFactTable(
    schema: SDKAttributeSchema,
    columnOverride?: (cols: ColumnInterface[]) => void,
  ): FactTableInterface {
    const columns = getManagedWarehouseEventsFactTableColumns(schema).map((c) =>
      makeFactTableColumn(c.column, {
        datatype: c.datatype,
        ...(c.alwaysInlineFilter
          ? { alwaysInlineFilter: c.alwaysInlineFilter }
          : {}),
        ...(c.jsonFields ? { jsonFields: c.jsonFields } : {}),
      }),
    );
    columnOverride?.(columns);
    return {
      id: MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
      datasource: "managed_warehouse",
      columns,
      sql: buildManagedWarehouseEventsFactTableSql(schema),
      userIdTypes: getManagedWarehouseUserIdTypes(schema),
    } as unknown as FactTableInterface;
  }

  function getSyncedColumns(): ColumnInterface[] {
    return (
      mockSyncFactTable.mock.calls[0][2] as { columns: ColumnInterface[] }
    ).columns;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDatasource.mockResolvedValue(datasource);
    mockUpdateDataSource.mockResolvedValue(undefined as never);
    mockSyncFactTable.mockResolvedValue(undefined as never);
  });

  it("updates the attributes JSON field type when an attribute datatype changes", async () => {
    const schema: SDKAttributeSchema = [
      { property: "age", datatype: "string" },
    ];
    // Fact table still reflects the old `number` type for `age`.
    const ft = makeManagedFactTable(schema, (cols) => {
      const attrs = cols.find((c) => c.column === "attributes")!;
      attrs.jsonFields = { age: { datatype: "number" } };
    });
    mockGetFactTableById.mockResolvedValue(ft);

    await syncManagedWarehouseIdentifiers(context, schema);

    expect(mockSyncFactTable).toHaveBeenCalledTimes(1);
    const attributes = getSyncedColumns().find(
      (c) => c.column === "attributes",
    );
    expect(attributes?.jsonFields).toEqual({ age: { datatype: "string" } });
  });

  it("preserves data-discovered JSON fields not present in the schema", async () => {
    const schema: SDKAttributeSchema = [
      { property: "plan", datatype: "string" },
    ];
    const ft = makeManagedFactTable(schema, (cols) => {
      const attrs = cols.find((c) => c.column === "attributes")!;
      // Field the refresh job discovered from data but not in the schema.
      attrs.jsonFields = { discovered_field: { datatype: "number" } };
    });
    mockGetFactTableById.mockResolvedValue(ft);

    await syncManagedWarehouseIdentifiers(context, schema);

    expect(mockSyncFactTable).toHaveBeenCalledTimes(1);
    const attributes = getSyncedColumns().find(
      (c) => c.column === "attributes",
    );
    expect(attributes?.jsonFields).toEqual({
      discovered_field: { datatype: "number" },
      plan: { datatype: "string" },
    });
  });

  it("deletes removed custom identifiers but keeps refresh-discovered real columns", async () => {
    const schema: SDKAttributeSchema = [
      { property: "plan", datatype: "string" },
    ];
    const ft = makeManagedFactTable(schema, (cols) => {
      // A real `SELECT *` column the refresh job discovered (reserved name).
      cols.push(makeFactTableColumn("session_id"));
      // A former custom identifier no longer in the schema (non-reserved).
      cols.push(makeFactTableColumn("company_id"));
    });
    mockGetFactTableById.mockResolvedValue(ft);

    await syncManagedWarehouseIdentifiers(context, schema);

    expect(mockSyncFactTable).toHaveBeenCalledTimes(1);
    const synced = getSyncedColumns();
    expect(synced.find((c) => c.column === "session_id")?.deleted).toBe(false);
    expect(synced.find((c) => c.column === "company_id")?.deleted).toBe(true);
  });

  it("does not write the fact table when nothing changed", async () => {
    const schema: SDKAttributeSchema = [
      { property: "plan", datatype: "string" },
    ];
    mockGetFactTableById.mockResolvedValue(makeManagedFactTable(schema));

    await syncManagedWarehouseIdentifiers(context, schema);

    expect(mockSyncFactTable).not.toHaveBeenCalled();
  });

  it("no-ops for legacy (materialized-column) warehouses", async () => {
    mockGetDatasource.mockResolvedValue({
      ...datasource,
      settings: { queries: {} },
    } as unknown as GrowthbookClickhouseDataSource);

    await syncManagedWarehouseIdentifiers(context, []);

    expect(mockUpdateDataSource).not.toHaveBeenCalled();
    expect(mockGetFactTableById).not.toHaveBeenCalled();
    expect(mockSyncFactTable).not.toHaveBeenCalled();
  });
});
