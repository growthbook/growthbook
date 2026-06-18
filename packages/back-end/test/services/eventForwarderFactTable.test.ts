import type { DataSourceInterface } from "shared/types/datasource";
import type { FactTableInterface } from "shared/types/fact-table";
import * as SharedUtil from "shared/util";
import {
  ensureEventForwarderEventsFactTable,
  deleteEventForwarderEventsFactTableForDatasource,
  mergeEventForwarderFactTableColumnFromDesired,
  queueEventForwarderEventsFactTablesColumnsRefresh,
  syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange,
} from "back-end/src/services/eventForwarder/factTable";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as FactTableModel from "back-end/src/models/FactTableModel";
import * as EventForwarderConfig from "back-end/src/services/eventForwarder/config";
import * as DataSourceService from "back-end/src/services/datasource";
import * as RefreshFactTableColumns from "back-end/src/jobs/refreshFactTableColumns";
import * as Organizations from "back-end/src/services/organizations";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/models/FactTableModel");
jest.mock("back-end/src/services/eventForwarder/config");
jest.mock("shared/util", () => ({
  ...jest.requireActual<typeof SharedUtil>("shared/util"),
  getEventForwarderSinkTypeForDatasource: jest.fn(),
}));
jest.mock("back-end/src/services/datasource");
jest.mock("back-end/src/jobs/refreshFactTableColumns");
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn(),
}));

const mockedGetDataSourceById =
  DataSourceModel.getDataSourceById as jest.MockedFunction<
    typeof DataSourceModel.getDataSourceById
  >;
const mockedGetFactTable = FactTableModel.getFactTable as jest.MockedFunction<
  typeof FactTableModel.getFactTable
>;
const mockedCreateFactTable =
  FactTableModel.createFactTable as jest.MockedFunction<
    typeof FactTableModel.createFactTable
  >;
const mockedDeleteFactTable =
  FactTableModel.deleteFactTable as jest.MockedFunction<
    typeof FactTableModel.deleteFactTable
  >;
const mockedUpdateFactTable =
  FactTableModel.updateFactTable as jest.MockedFunction<
    typeof FactTableModel.updateFactTable
  >;
const mockedGetContextForAgendaJobByOrgObject =
  Organizations.getContextForAgendaJobByOrgObject as jest.MockedFunction<
    typeof Organizations.getContextForAgendaJobByOrgObject
  >;
// Sentinel returned by the mocked background-job context factory. The event
// forwarder sync passes this to updateFactTable so it can bypass the
// managedBy === "api" guard; the tests assert it is threaded through unchanged.
const agendaContext = {
  org: { id: "org1" },
  auditUser: null,
} as never;
const mockedDecrypt =
  EventForwarderConfig.decryptEventForwarderConfigModel as jest.MockedFunction<
    typeof EventForwarderConfig.decryptEventForwarderConfigModel
  >;
const mockedGetBigQueryTablePrefix =
  EventForwarderConfig.getBigQueryEventForwarderTablePrefix as jest.MockedFunction<
    typeof EventForwarderConfig.getBigQueryEventForwarderTablePrefix
  >;
const mockedGetSnowflakeTablePrefix =
  EventForwarderConfig.getSnowflakeEventForwarderTablePrefix as jest.MockedFunction<
    typeof EventForwarderConfig.getSnowflakeEventForwarderTablePrefix
  >;
const mockedGetSourceIntegrationObject =
  DataSourceService.getSourceIntegrationObject as jest.MockedFunction<
    typeof DataSourceService.getSourceIntegrationObject
  >;
const mockedGetSinkType =
  SharedUtil.getEventForwarderSinkTypeForDatasource as jest.MockedFunction<
    typeof SharedUtil.getEventForwarderSinkTypeForDatasource
  >;
const mockedQueueFactTableColumnsRefresh =
  RefreshFactTableColumns.queueFactTableColumnsRefresh as jest.MockedFunction<
    typeof RefreshFactTableColumns.queueFactTableColumnsRefresh
  >;
const mockedQueueFactTableColumnsRefreshAt =
  RefreshFactTableColumns.queueFactTableColumnsRefreshAt as jest.MockedFunction<
    typeof RefreshFactTableColumns.queueFactTableColumnsRefreshAt
  >;

function datasource(
  overrides: Partial<DataSourceInterface> = {},
): DataSourceInterface {
  return {
    id: "ds_1",
    organization: "org1",
    name: "Production Analytics",
    type: "bigquery",
    description: "",
    params: {} as DataSourceInterface["params"],
    settings: {
      userIdTypes: [{ userIdType: "user_id", description: "" }],
    },
    projects: ["proj_1"],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  };
}

function context() {
  return {
    org: {
      id: "org1",
      settings: { attributeSchema: [] },
    },
    userId: "user_1",
    models: {
      eventForwarderConfigs: {
        getAll: jest.fn(),
        update: jest.fn(),
      },
    },
  };
}

function eventsFactTable(
  overrides: Partial<FactTableInterface> = {},
): FactTableInterface {
  return {
    id: "ds_1_events",
    name: "Production Analytics Events",
    managedBy: "api",
    organization: "org1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    description: "",
    owner: "",
    projects: [],
    tags: [],
    datasource: "ds_1",
    userIdTypes: ["user_id"],
    sql: "",
    eventName: "",
    columns: [],
    filters: [],
    ...overrides,
  };
}

describe("ensureEventForwarderEventsFactTable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetBigQueryTablePrefix.mockReturnValue("gb");
    mockedGetSnowflakeTablePrefix.mockReturnValue("GB");
  });

  it("creates fact table with datasource id and display name", async () => {
    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedGetFactTable.mockResolvedValue(null);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });
    const createdFactTable = eventsFactTable();
    mockedCreateFactTable.mockResolvedValue(createdFactTable as never);

    const factTableId = await ensureEventForwarderEventsFactTable(
      context() as never,
      {
        id: "efc_1",
        datasourceId: "ds_1",
        sinkType: "bigquery",
        config: "encrypted",
        status: "pending",
        organization: "org1",
        projects: [],
        topic: "topic",
      },
      {
        defaultProject: "my-project",
        defaultDataset: "analytics_123",
      } as never,
    );

    expect(mockedCreateFactTable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "ds_1_events",
        name: "Production Analytics Events",
        managedBy: "api",
        datasource: "ds_1",
        userIdTypes: ["user_id"],
        columns: [
          {
            column: "attributes",
            name: "attributes",
            description: "",
            numberFormat: "",
            datatype: "json",
            jsonFields: {
              user_id: { datatype: "string" },
            },
          },
        ],
      }),
    );

    const createArgs = mockedCreateFactTable.mock.calls[0][1];
    expect(createArgs.sql).toContain(
      "`my-project`.`analytics_123`.`gb_events`",
    );
    expect(createArgs.sql).toContain("received_at BETWEEN");
    expect(mockedQueueFactTableColumnsRefresh).toHaveBeenCalledWith(
      createdFactTable,
    );
    expect(factTableId).toBe("ds_1_events");
  });

  it("skips when fact table already exists for datasource", async () => {
    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedGetFactTable.mockResolvedValue({
      id: "ds_1_events",
      datasource: "ds_1",
    } as never);

    const factTableId = await ensureEventForwarderEventsFactTable(
      context() as never,
      {
        id: "efc_1",
        datasourceId: "ds_1",
        sinkType: "bigquery",
        config: "encrypted",
        status: "pending",
        organization: "org1",
        projects: [],
        topic: "topic",
      },
      { defaultProject: "my-project" } as never,
    );

    expect(mockedCreateFactTable).not.toHaveBeenCalled();
    expect(mockedQueueFactTableColumnsRefresh).not.toHaveBeenCalled();
    expect(factTableId).toBe("ds_1_events");
  });
});

describe("queueEventForwarderEventsFactTablesColumnsRefresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("queues refresh for each event forwarder datasource fact table", async () => {
    const ctx = context();
    ctx.models.eventForwarderConfigs.getAll.mockResolvedValue([
      {
        datasourceId: "ds_1",
        sinkType: "bigquery",
      },
      {
        datasourceId: "ds_2",
        sinkType: "snowflake",
      },
    ]);

    const ft1 = eventsFactTable({ id: "ds_1_events", datasource: "ds_1" });
    const ft2 = eventsFactTable({
      id: "ds_2_events",
      datasource: "ds_2",
      name: "Other Events",
    });

    mockedGetDataSourceById.mockImplementation(async (_ctx, id) => {
      if (id === "ds_1") {
        return datasource({ id: "ds_1" });
      }
      if (id === "ds_2") {
        return datasource({ id: "ds_2", name: "Other" });
      }
      return datasource({ id: id as string });
    });
    mockedGetFactTable.mockImplementation(async (_ctx, factTableId) => {
      if (factTableId === "ds_1_events") {
        return ft1;
      }
      if (factTableId === "ds_2_events") {
        return ft2;
      }
      return null;
    });

    await queueEventForwarderEventsFactTablesColumnsRefresh(ctx as never);

    expect(mockedQueueFactTableColumnsRefresh).toHaveBeenCalledTimes(2);
    expect(mockedQueueFactTableColumnsRefresh).toHaveBeenCalledWith(ft1);
    expect(mockedQueueFactTableColumnsRefresh).toHaveBeenCalledWith(ft2);
  });

  it("skips datasources without an Events fact table", async () => {
    const ctx = context();
    ctx.models.eventForwarderConfigs.getAll.mockResolvedValue([
      {
        datasourceId: "ds_1",
        sinkType: "bigquery",
      },
    ]);

    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedGetFactTable.mockResolvedValue(null);

    await queueEventForwarderEventsFactTablesColumnsRefresh(ctx as never);

    expect(mockedQueueFactTableColumnsRefresh).not.toHaveBeenCalled();
  });
});

describe("syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetBigQueryTablePrefix.mockReturnValue("gb");
    mockedGetSnowflakeTablePrefix.mockReturnValue("GB");
    mockedGetContextForAgendaJobByOrgObject.mockReturnValue(agendaContext);
  });

  it("updates managed fact table attribute jsonFields and queues delayed refresh", async () => {
    const ctx = context();
    ctx.models.eventForwarderConfigs.getAll.mockResolvedValue([
      {
        datasourceId: "ds_1",
        sinkType: "bigquery",
      },
    ]);

    const ds = datasource({
      settings: {
        userIdTypes: [{ userIdType: "user_id", description: "" }],
      },
      projects: ["proj_1"],
    });
    const ft = eventsFactTable({
      columns: [
        {
          column: "attributes",
          name: "attributes",
          description: "",
          numberFormat: "",
          datatype: "json",
          jsonFields: {
            user_id: { datatype: "string" },
          },
          dateCreated: new Date(),
          dateUpdated: new Date(),
          deleted: false,
        },
      ],
    });

    mockedGetDataSourceById.mockResolvedValue(ds);
    mockedGetFactTable.mockResolvedValue(ft);
    mockedGetSourceIntegrationObject.mockReturnValue({
      params: {
        defaultProject: "my-project",
      },
    } as never);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    await syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange(
      ctx as never,
      [
        { property: "user_id", datatype: "string", hashAttribute: true },
        { property: "age", datatype: "number" },
        { property: "other_project", datatype: "string", projects: ["proj_2"] },
      ],
    );

    expect(mockedGetContextForAgendaJobByOrgObject).toHaveBeenCalledWith(
      ctx.org,
    );
    expect(mockedUpdateFactTable).toHaveBeenCalledWith(agendaContext, ft, {
      columns: [
        expect.objectContaining({
          column: "attributes",
          name: "attributes",
          description: "",
          numberFormat: "",
          datatype: "json",
          jsonFields: {
            user_id: { datatype: "string" },
            age: { datatype: "number" },
          },
        }),
      ],
      columnRefreshPending: true,
      sql: expect.stringContaining(
        "SAFE_CAST(JSON_VALUE(`attributes`, '$.\"age\"') AS FLOAT64) AS age",
      ),
    });
    expect(mockedQueueFactTableColumnsRefreshAt).toHaveBeenCalledWith(
      ft,
      expect.any(Date),
    );
  });

  it("marks column refresh pending when metadata is already current", async () => {
    const ctx = context();
    ctx.models.eventForwarderConfigs.getAll.mockResolvedValue([
      {
        datasourceId: "ds_1",
        sinkType: "bigquery",
      },
    ]);

    const ds = datasource({
      settings: {
        userIdTypes: [{ userIdType: "user_id", description: "" }],
      },
      projects: ["proj_1"],
    });
    const sql = `SELECT
  timestamp,
  event_name,
  -- Attributes
  JSON_VALUE(\`attributes\`, '$."user_id"') AS user_id
FROM \`my-project\`.\`analytics_123\`.\`gb_events\`
WHERE received_at BETWEEN '{{startDate}}' AND '{{endDate}}'`;
    const ft = eventsFactTable({
      sql,
      columnRefreshPending: false,
      columns: [
        {
          column: "attributes",
          name: "attributes",
          description: "",
          numberFormat: "",
          datatype: "json",
          jsonFields: {
            user_id: { datatype: "string" },
          },
          dateCreated: new Date(),
          dateUpdated: new Date(),
          deleted: false,
        },
      ],
    });

    mockedGetDataSourceById.mockResolvedValue(ds);
    mockedGetFactTable.mockResolvedValue(ft);
    mockedGetSourceIntegrationObject.mockReturnValue({
      params: {
        defaultProject: "my-project",
      },
    } as never);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    await syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange(
      ctx as never,
      [{ property: "user_id", datatype: "string", hashAttribute: true }],
    );

    expect(mockedUpdateFactTable).toHaveBeenCalledWith(agendaContext, ft, {
      columnRefreshPending: true,
    });
    expect(mockedQueueFactTableColumnsRefreshAt).toHaveBeenCalledWith(
      ft,
      expect.any(Date),
    );
  });
});

describe("mergeEventForwarderFactTableColumnFromDesired", () => {
  it("builds explicit column metadata without spreading stale fields", () => {
    const now = new Date("2026-06-08T00:00:00.000Z");
    const existing = {
      column: "attributes",
      name: "attributes",
      description: "",
      numberFormat: "",
      datatype: "json" as const,
      jsonFields: { user_id: { datatype: "string" as const } },
      dateCreated: new Date("2026-06-07T00:00:00.000Z"),
      dateUpdated: new Date("2026-06-07T00:00:00.000Z"),
      deleted: true,
      topValues: ["a"],
      autoSlices: ["a"],
      lockedAutoSlices: [],
    };

    const merged = mergeEventForwarderFactTableColumnFromDesired(
      {
        column: "attributes",
        name: "attributes",
        description: "",
        numberFormat: "",
        datatype: "json",
        jsonFields: {
          user_id: { datatype: "string" },
          age: { datatype: "number" },
        },
      },
      existing,
      now,
    );

    expect(merged).toEqual({
      column: "attributes",
      name: "attributes",
      description: "",
      numberFormat: "",
      datatype: "json",
      jsonFields: {
        user_id: { datatype: "string" },
        age: { datatype: "number" },
      },
      dateCreated: existing.dateCreated,
      dateUpdated: now,
      deleted: false,
      topValues: ["a"],
      autoSlices: ["a"],
      lockedAutoSlices: [],
    });
  });
});

describe("deleteEventForwarderEventsFactTableForDatasource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deletes api-managed Events fact table for datasource", async () => {
    const ft = eventsFactTable();

    mockedGetSinkType.mockReturnValue("bigquery");
    mockedGetFactTable.mockResolvedValue(ft);
    mockedDeleteFactTable.mockResolvedValue(undefined as never);

    await deleteEventForwarderEventsFactTableForDatasource(
      context() as never,
      datasource(),
    );

    expect(mockedDeleteFactTable).toHaveBeenCalledWith(expect.anything(), ft, {
      bypassManagedByCheck: true,
    });
  });
});
