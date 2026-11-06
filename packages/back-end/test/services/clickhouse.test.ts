import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import { GrowthbookClickhouseDataSource } from "shared/types/datasource";
import { SDKAttributeSchema } from "shared/types/organization";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import {
  buildManagedWarehouseContextualBanditQueries,
  buildManagedWarehouseEventsFactTableSql,
  getManagedWarehouseEventsFactTableColumns,
  getManagedWarehouseUserIdTypes,
  planManagedWarehouseContextualBanditQuerySync,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import {
  listSessionReplays,
  syncManagedWarehouseContextualBanditQueries,
  syncManagedWarehouseIdentifiers,
} from "back-end/src/services/clickhouse";
import {
  dangerouslyGetFactTableByIdBypassPermission,
  dangerouslySyncManagedWarehouseFactTable,
} from "back-end/src/models/FactTableModel";
import {
  getGrowthbookDatasource,
  dangerouslyGetGrowthbookDatasourceBypassPermission,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";

jest.mock("back-end/src/services/licenseServerManagedClickhouse", () => ({
  dangerousRecreateClickhouseTables: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  dangerouslyGetFactTableByIdBypassPermission: jest.fn(),
  dangerouslySyncManagedWarehouseFactTable: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getGrowthbookDatasource: jest.fn(),
  dangerouslyGetGrowthbookDatasourceBypassPermission: jest.fn(),
  updateDataSource: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));

const mockGetGrowthbookDatasource = jest.mocked(getGrowthbookDatasource);
const mockGetSourceIntegrationObject = jest.mocked(getSourceIntegrationObject);
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

describe("syncManagedWarehouseIdentifiers", () => {
  const mockApplyPlan = jest.fn();
  const mockGetManagedQueries = jest.fn();
  const mockGetReferencing = jest.fn();
  const context = {
    org: { id: "org_test", settings: {} },
    models: {
      contextualBanditQueries: {
        getManagedWarehouseQueriesByDatasource: mockGetManagedQueries,
        dangerouslyApplyManagedWarehouseQuerySyncPlan: mockApplyPlan,
      },
      contextualBandits: {
        getByContextualBanditQueryIds: mockGetReferencing,
      },
    },
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
    mockGetManagedQueries.mockResolvedValue([]);
    mockGetReferencing.mockResolvedValue([]);
    mockApplyPlan.mockResolvedValue(undefined);
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

  it("syncs the generated contextual bandit queries from the passed schema", async () => {
    const schema: SDKAttributeSchema = [
      { property: "id", datatype: "string", hashAttribute: true },
      { property: "country", datatype: "string" },
    ];
    mockGetFactTableById.mockResolvedValue(makeManagedFactTable(schema));

    await syncManagedWarehouseIdentifiers(context, schema);

    expect(mockApplyPlan).toHaveBeenCalledTimes(1);
    expect(mockApplyPlan).toHaveBeenCalledWith(
      "managed_warehouse",
      planManagedWarehouseContextualBanditQuerySync({
        existing: [],
        desired: buildManagedWarehouseContextualBanditQueries(schema),
        referencedQueryIds: [],
      }),
      schema,
    );
  });

  it("still syncs the fact table when the contextual bandit sync fails", async () => {
    const schema: SDKAttributeSchema = [
      { property: "age", datatype: "string" },
    ];
    const ft = makeManagedFactTable(schema, (cols) => {
      const attrs = cols.find((c) => c.column === "attributes")!;
      attrs.jsonFields = { age: { datatype: "number" } };
    });
    mockGetFactTableById.mockResolvedValue(ft);
    mockGetManagedQueries.mockRejectedValue(new Error("boom"));

    await expect(
      syncManagedWarehouseIdentifiers(context, schema),
    ).resolves.toBeUndefined();

    expect(mockSyncFactTable).toHaveBeenCalledTimes(1);
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
    expect(mockApplyPlan).not.toHaveBeenCalled();
  });
});

describe("syncManagedWarehouseContextualBanditQueries", () => {
  const mockApplyPlan = jest.fn();
  const mockGetManagedQueries = jest.fn();
  const mockGetReferencing = jest.fn();
  const schema: SDKAttributeSchema = [
    { property: "id", datatype: "string", hashAttribute: true },
    { property: "company_id", datatype: "string", hashAttribute: true },
    { property: "country", datatype: "string" },
    { property: "plan", datatype: "number" },
  ];
  const context = {
    org: { id: "org_test", settings: { attributeSchema: schema } },
    models: {
      contextualBanditQueries: {
        getManagedWarehouseQueriesByDatasource: mockGetManagedQueries,
        dangerouslyApplyManagedWarehouseQuerySyncPlan: mockApplyPlan,
      },
      contextualBandits: {
        getByContextualBanditQueryIds: mockGetReferencing,
      },
    },
  } as unknown as ReqContext;

  const datasource = {
    id: "managed_warehouse",
    organization: "org_test",
    type: "growthbook_clickhouse",
    settings: {
      useJsonColumns: true,
      queries: {},
      migratedIdentifiers: ["legacy_key"],
      migratedColumns: [
        {
          columnName: "tier",
          sourceField: "tier",
          datatype: "string",
          type: "dimension",
        },
      ],
      idAttributeIdentifier: "user_id",
    },
  } as unknown as GrowthbookClickhouseDataSource;

  function managedQuery(id: string, userIdType: string) {
    return {
      id,
      organization: "org_test",
      datasourceId: "managed_warehouse",
      managedBy: "api",
      name: userIdType,
      userIdType,
      query: "",
      targetingAttributeColumns: [],
      dateCreated: new Date("2026-01-01"),
      dateUpdated: new Date("2026-01-01"),
      owner: "",
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetManagedQueries.mockResolvedValue([]);
    mockGetReferencing.mockResolvedValue([]);
    mockApplyPlan.mockResolvedValue(undefined);
  });

  it("derives the queries from the datasource settings and the org schema", async () => {
    await syncManagedWarehouseContextualBanditQueries(context, datasource);

    const desired = buildManagedWarehouseContextualBanditQueries(
      schema,
      ["legacy_key"],
      datasource.settings.migratedColumns,
      "user_id",
    );
    expect(desired.map((q) => q.userIdType)).toEqual([
      "user_id",
      "device_id",
      "company_id",
      "legacy_key",
    ]);
    expect(mockApplyPlan).toHaveBeenCalledWith(
      "managed_warehouse",
      planManagedWarehouseContextualBanditQuerySync({
        existing: [],
        desired,
        referencedQueryIds: [],
      }),
      schema,
    );
  });

  it("prefers an explicitly passed schema over the context's", async () => {
    const fresh: SDKAttributeSchema = [
      ...schema,
      { property: "browser", datatype: "string" },
    ];

    await syncManagedWarehouseContextualBanditQueries(
      context,
      datasource,
      fresh,
    );

    const [, plan, passedSchema] = mockApplyPlan.mock.calls[0];
    expect(passedSchema).toBe(fresh);
    expect(plan.create[0].targetingAttributeColumns).toEqual([
      "browser",
      "country",
    ]);
  });

  it("preserves the context attributes of bandits that use the existing queries", async () => {
    const existing = [
      managedQuery("cbq_user", "user_id"),
      managedQuery("cbq_device", "device_id"),
    ];
    mockGetManagedQueries.mockResolvedValue(existing);
    mockGetReferencing.mockResolvedValue([
      {
        id: "cb_running",
        contextualBanditQueryId: "cbq_user",
        archived: false,
        contextualAttributes: ["country"],
      },
      {
        id: "cb_archived",
        contextualBanditQueryId: "cbq_device",
        archived: true,
        contextualAttributes: ["plan"],
      },
    ]);
    const countryIsNowAnIdentifier: SDKAttributeSchema = [
      { property: "id", datatype: "string", hashAttribute: true },
      { property: "country", datatype: "string", hashAttribute: true },
      { property: "plan", datatype: "number" },
    ];

    await syncManagedWarehouseContextualBanditQueries(
      context,
      datasource,
      countryIsNowAnIdentifier,
    );

    expect(mockGetReferencing).toHaveBeenCalledWith(["cbq_user", "cbq_device"]);
    const [, plan] = mockApplyPlan.mock.calls[0];
    const userUpdate = plan.update.find(
      (u: { existing: { id: string } }) => u.existing.id === "cbq_user",
    );
    expect(userUpdate.changes.targetingAttributeColumns).toEqual(["country"]);
    expect(userUpdate.changes.query).toContain(
      "attributes.country::Nullable(String) AS country",
    );
    expect(userUpdate.changes.query).not.toContain("AS plan");
    expect(
      plan.create.map((q: { userIdType: string }) => q.userIdType),
    ).toEqual(["country", "legacy_key"]);
  });

  it("no-ops for non-managed and legacy warehouses", async () => {
    await syncManagedWarehouseContextualBanditQueries(context, {
      ...datasource,
      type: "clickhouse",
    } as unknown as GrowthbookClickhouseDataSource);
    await syncManagedWarehouseContextualBanditQueries(context, {
      ...datasource,
      settings: { queries: {} },
    } as unknown as GrowthbookClickhouseDataSource);

    expect(mockGetManagedQueries).not.toHaveBeenCalled();
    expect(mockApplyPlan).not.toHaveBeenCalled();
  });
});
