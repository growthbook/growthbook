import type { DataSourceInterface } from "shared/types/datasource";
import type { FactTableInterface } from "shared/types/fact-table";
import {
  ensureEventForwarderEventsFactTable,
  findEventForwarderEventsFactTableForDatasource,
  deleteEventForwarderEventsFactTableForDatasource,
} from "back-end/src/services/eventForwarderFactTable";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as FactTableModel from "back-end/src/models/FactTableModel";
import * as EventForwarderConfig from "back-end/src/services/eventForwarderConfig";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/models/FactTableModel");
jest.mock("back-end/src/services/eventForwarderConfig");

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
const mockedGetFactTablesForDatasource =
  FactTableModel.getFactTablesForDatasource as jest.MockedFunction<
    typeof FactTableModel.getFactTablesForDatasource
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
  };
}

describe("findEventForwarderEventsFactTableForDatasource", () => {
  it("finds api-managed Events fact table by name", () => {
    const ft: FactTableInterface = {
      id: "production_analytics_events",
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
    };

    expect(
      findEventForwarderEventsFactTableForDatasource(
        [ft],
        "Production Analytics",
      ),
    ).toBe(ft);
  });
});

describe("ensureEventForwarderEventsFactTable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates fact table with per-datasource id and name", async () => {
    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedGetFactTable.mockResolvedValue(null);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tableName: "gb_events",
      serviceAccountKey: "{}",
    });
    mockedCreateFactTable.mockResolvedValue({} as never);

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
        id: "production_analytics_events",
        name: "Production Analytics Events",
        managedBy: "api",
        datasource: "ds_1",
        userIdTypes: ["user_id"],
      }),
    );

    const createArgs = mockedCreateFactTable.mock.calls[0][1];
    expect(createArgs.sql).toContain(
      "`my-project`.`analytics_123`.`gb_events`",
    );
    expect(createArgs.sql).toContain("received_at BETWEEN");
  });

  it("skips when fact table already exists for datasource", async () => {
    mockedGetDataSourceById.mockResolvedValue(datasource());
    mockedGetFactTable.mockResolvedValue({
      id: "production_analytics_events",
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
  });

  it("uses collision suffix when base id is taken by another datasource", async () => {
    mockedGetDataSourceById.mockResolvedValue(datasource({ id: "ds_2" }));
    mockedGetFactTable.mockResolvedValue({
      id: "production_analytics_events",
      datasource: "ds_other",
    } as never);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tableName: "gb_events",
      serviceAccountKey: "{}",
    });
    mockedCreateFactTable.mockResolvedValue({} as never);

    await ensureEventForwarderEventsFactTable(
      context() as never,
      {
        id: "efc_1",
        datasourceId: "ds_2",
        sinkType: "bigquery",
        config: "encrypted",
        status: "pending",
        organization: "org1",
        projects: [],
        topic: "topic",
      },
      { defaultProject: "my-project" } as never,
    );

    expect(mockedCreateFactTable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "production_analytics_ds2_events",
      }),
    );
  });
});

describe("deleteEventForwarderEventsFactTableForDatasource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deletes api-managed Events fact table for datasource", async () => {
    const ft: FactTableInterface = {
      id: "production_analytics_events",
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
    };

    mockedGetSinkType.mockReturnValue("bigquery");
    mockedGetFactTablesForDatasource.mockResolvedValue([ft]);
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
