import type { DataSourceInterface } from "shared/types/datasource";
import type { FactTableInterface } from "shared/types/fact-table";
import { EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS } from "shared/util";
import {
  ensureEventForwarderEventsFactTable,
  syncEventForwarderEventsFactTableDisplayName,
  deleteEventForwarderEventsFactTableForDatasource,
  queueEventForwarderEventsFactTablesColumnsRefresh,
  queueDelayedFactTableColumnsRefreshForEventForwarderDatasources,
} from "back-end/src/services/eventForwarderFactTable";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as FactTableModel from "back-end/src/models/FactTableModel";
import * as EventForwarderConfig from "back-end/src/services/eventForwarderConfig";
import * as RefreshFactTableColumns from "back-end/src/jobs/refreshFactTableColumns";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/models/FactTableModel");
jest.mock("back-end/src/services/eventForwarderConfig");
jest.mock("back-end/src/jobs/refreshFactTableColumns");

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
const mockedUpdateFactTable =
  FactTableModel.updateFactTable as jest.MockedFunction<
    typeof FactTableModel.updateFactTable
  >;
const mockedDeleteFactTable =
  FactTableModel.deleteFactTable as jest.MockedFunction<
    typeof FactTableModel.deleteFactTable
  >;
const mockedDecrypt =
  EventForwarderConfig.decryptEventForwarderConfigModel as jest.MockedFunction<
    typeof EventForwarderConfig.decryptEventForwarderConfigModel
  >;
const mockedGetSinkType =
  EventForwarderConfig.getEventForwarderSinkTypeForDatasource as jest.MockedFunction<
    typeof EventForwarderConfig.getEventForwarderSinkTypeForDatasource
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
  });

  it("creates fact table with datasource id and display name", async () => {
    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedGetFactTable.mockResolvedValue(null);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tableName: "gb_events",
      serviceAccountKey: "{}",
    });
    const createdFactTable = eventsFactTable();
    mockedCreateFactTable.mockResolvedValue(createdFactTable as never);

    await ensureEventForwarderEventsFactTable(
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
            column: "user_id",
            name: "user_id",
            description: "",
            numberFormat: "",
            datatype: "string",
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
  });

  it("skips when fact table already exists for datasource", async () => {
    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedGetFactTable.mockResolvedValue({
      id: "ds_1_events",
      datasource: "ds_1",
    } as never);

    await ensureEventForwarderEventsFactTable(
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
  });
});

describe("syncEventForwarderEventsFactTableDisplayName", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates display name when datasource is renamed", async () => {
    const ft = eventsFactTable();
    mockedGetFactTable.mockResolvedValue(ft as never);

    await syncEventForwarderEventsFactTableDisplayName(
      context() as never,
      datasource({ name: "Prod Analytics" }),
    );

    expect(mockedUpdateFactTable).toHaveBeenCalledWith(
      expect.anything(),
      ft,
      { name: "Prod Analytics Events" },
      { bypassManagedByCheck: true },
    );
  });

  it("skips when display name is already current", async () => {
    mockedGetFactTable.mockResolvedValue(eventsFactTable() as never);

    await syncEventForwarderEventsFactTableDisplayName(
      context() as never,
      datasource(),
    );

    expect(mockedUpdateFactTable).not.toHaveBeenCalled();
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

describe("queueDelayedFactTableColumnsRefreshForEventForwarderDatasources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("queues refreshAt for event forwarder fact tables only", async () => {
    const ctx = context();
    ctx.models.eventForwarderConfigs.getAll.mockResolvedValue([
      { datasourceId: "ds_1", sinkType: "bigquery" },
    ]);

    const ft = eventsFactTable({ id: "ds_1_events", datasource: "ds_1" });

    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedGetFactTable.mockResolvedValue(ft);

    await queueDelayedFactTableColumnsRefreshForEventForwarderDatasources(
      ctx as never,
    );

    const expectedRunAt = new Date(
      Date.now() + EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS,
    );
    expect(mockedQueueFactTableColumnsRefreshAt).toHaveBeenCalledTimes(1);
    expect(mockedQueueFactTableColumnsRefreshAt).toHaveBeenCalledWith(
      ft,
      expectedRunAt,
    );
    expect(mockedQueueFactTableColumnsRefresh).not.toHaveBeenCalled();
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
