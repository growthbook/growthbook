import type { DataSourceInterface } from "shared/types/datasource";
import {
  initializeDatasourceUserIdTypesFromOrgAttributeSchema,
  syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema,
  syncHashAttributeMetadataForEventForwarder,
} from "back-end/src/services/eventForwarderUserIdTypes";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as EventForwarderExposureQueries from "back-end/src/services/eventForwarderExposureQueries";
import * as DataSourceService from "back-end/src/services/datasource";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/services/eventForwarderExposureQueries");
jest.mock("back-end/src/services/datasource");

const mockedEnsureExposure =
  EventForwarderExposureQueries.ensureEventForwarderExposureQueries as jest.MockedFunction<
    typeof EventForwarderExposureQueries.ensureEventForwarderExposureQueries
  >;

const mockedGetRaw =
  DataSourceModel.getRawDataSourceById as jest.MockedFunction<
    typeof DataSourceModel.getRawDataSourceById
  >;
const mockedGetById = DataSourceModel.getDataSourceById as jest.MockedFunction<
  typeof DataSourceModel.getDataSourceById
>;
const mockedUpdate = DataSourceModel.updateDataSource as jest.MockedFunction<
  typeof DataSourceModel.updateDataSource
>;
const mockedGetSourceIntegrationObject =
  DataSourceService.getSourceIntegrationObject as jest.MockedFunction<
    typeof DataSourceService.getSourceIntegrationObject
  >;
const mockedBuildExposureQueryParams =
  EventForwarderExposureQueries.buildExposureQueryParams as jest.MockedFunction<
    typeof EventForwarderExposureQueries.buildExposureQueryParams
  >;

function ds(
  id: string,
  settings: DataSourceInterface["settings"] = {},
): DataSourceInterface {
  return {
    id,
    organization: "org1",
    name: "ds",
    type: "bigquery",
    description: "",
    params: {} as DataSourceInterface["params"],
    settings,
    projects: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
}

function contextWithSchema(
  schema: { property: string; datatype: "string"; hashAttribute?: boolean }[],
) {
  return {
    org: {
      id: "org1",
      settings: { attributeSchema: schema },
    },
    models: {
      eventForwarderConfigs: {
        getAll: jest.fn(),
      },
    },
  };
}

describe("initializeDatasourceUserIdTypesFromOrgAttributeSchema", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnsureExposure.mockResolvedValue(undefined);
  });

  it("merges hash attributes without overriding existing names (case insensitive)", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [{ userIdType: "user_id", description: "Existing" }],
    });
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);

    await initializeDatasourceUserIdTypesFromOrgAttributeSchema(
      contextWithSchema([
        { property: "USER_ID", datatype: "string", hashAttribute: true },
        { property: "id", datatype: "string", hashAttribute: true },
      ]) as never,
      "ds_1",
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        settings: {
          userIdTypes: [
            { userIdType: "user_id", description: "Existing" },
            {
              userIdType: "id",
              description: "",
              attributes: ["id"],
            },
          ],
        },
      },
    );
  });

  it("writes userIdTypes when raw Mongo has none", async () => {
    const raw = ds("ds_1", {});
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue({ ...raw, settings: {} });

    await initializeDatasourceUserIdTypesFromOrgAttributeSchema(
      contextWithSchema([
        { property: "id", datatype: "string", hashAttribute: true },
        { property: "country", datatype: "string" },
      ]) as never,
      "ds_1",
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        settings: {
          userIdTypes: [
            {
              userIdType: "id",
              description: "",
              attributes: ["id"],
            },
          ],
        },
      },
    );
  });

  it("ensures exposure queries when event forwarder config is provided", async () => {
    const raw = ds("ds_1", {});
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);

    const config = {
      id: "efc_1",
      datasourceId: "ds_1",
      sinkType: "bigquery" as const,
      config: "encrypted",
      status: "pending" as const,
      organization: "org1",
      projects: [],
      topic: "topic",
    };

    await initializeDatasourceUserIdTypesFromOrgAttributeSchema(
      contextWithSchema([
        { property: "id", datatype: "string", hashAttribute: true },
      ]) as never,
      "ds_1",
      config,
    );

    expect(mockedEnsureExposure).toHaveBeenCalledWith(
      expect.anything(),
      config,
      ["id"],
      undefined,
      [{ property: "id", datatype: "string", hashAttribute: true }],
      { queueWarehouseSync: false },
    );
  });
});

describe("syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnsureExposure.mockResolvedValue(undefined);
  });

  it("merges new hash attributes into all event forwarder datasources", async () => {
    const getAll = jest
      .fn()
      .mockResolvedValue([{ datasourceId: "ds_a" }, { datasourceId: "ds_b" }]);

    mockedGetRaw
      .mockResolvedValueOnce(
        ds("ds_a", {
          userIdTypes: [
            { userIdType: "id", description: "", attributes: ["id"] },
          ],
        }),
      )
      .mockResolvedValueOnce(ds("ds_b", { userIdTypes: [] }));

    mockedGetById
      .mockResolvedValueOnce(ds("ds_a"))
      .mockResolvedValueOnce(ds("ds_b"));

    const attributeSchema = [
      { property: "id", datatype: "string" as const, hashAttribute: true },
      {
        property: "device_id",
        datatype: "string" as const,
        hashAttribute: true,
      },
    ];

    await syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
      {
        org: { id: "org1" },
        models: { eventForwarderConfigs: { getAll } },
      } as never,
      attributeSchema,
    );

    expect(mockedUpdate).toHaveBeenCalledTimes(2);
    expect(mockedEnsureExposure).toHaveBeenCalledTimes(2);
    expect(mockedEnsureExposure).toHaveBeenCalledWith(
      expect.anything(),
      { datasourceId: "ds_a" },
      ["id", "device_id"],
      undefined,
      attributeSchema,
      { queueWarehouseSync: false },
    );
    expect(mockedEnsureExposure).toHaveBeenCalledWith(
      expect.anything(),
      { datasourceId: "ds_b" },
      ["id", "device_id"],
      undefined,
      attributeSchema,
      { queueWarehouseSync: false },
    );
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "ds_a" }),
      {
        settings: {
          userIdTypes: [
            { userIdType: "id", description: "", attributes: ["id"] },
            {
              userIdType: "device_id",
              description: "",
              attributes: ["device_id"],
            },
          ],
        },
      },
    );
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "ds_b" }),
      {
        settings: {
          userIdTypes: [
            {
              userIdType: "id",
              description: "",
              attributes: ["id"],
            },
            {
              userIdType: "device_id",
              description: "",
              attributes: ["device_id"],
            },
          ],
        },
      },
    );
  });

  it("does nothing when no event forwarder configs exist", async () => {
    const getAll = jest.fn().mockResolvedValue([]);

    await syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
      {
        org: { id: "org1" },
        models: { eventForwarderConfigs: { getAll } },
      } as never,
      [{ property: "id", datatype: "string", hashAttribute: true }],
    );

    expect(mockedGetRaw).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("ensures exposure queries even when hash userIdTypes already exist", async () => {
    const getAll = jest.fn().mockResolvedValue([{ datasourceId: "ds_a" }]);
    mockedGetRaw.mockResolvedValue(
      ds("ds_a", {
        userIdTypes: [
          {
            userIdType: "device_id",
            description: "",
            attributes: ["device_id"],
          },
        ],
      }),
    );

    const attributeSchema = [
      {
        property: "device_id",
        datatype: "string" as const,
        hashAttribute: true,
      },
    ];

    await syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
      {
        org: { id: "org1" },
        models: { eventForwarderConfigs: { getAll } },
      } as never,
      attributeSchema,
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedEnsureExposure).toHaveBeenCalledWith(
      expect.anything(),
      { datasourceId: "ds_a" },
      ["device_id"],
      undefined,
      attributeSchema,
      { queueWarehouseSync: false },
    );
  });
});

describe("syncHashAttributeMetadataForEventForwarder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSourceIntegrationObject.mockReturnValue({
      params: { defaultProject: "my-project" },
    } as never);
    mockedBuildExposureQueryParams.mockReturnValue({
      sinkType: "bigquery",
      projectId: "my-project",
      dataset: "analytics_123",
    });
  });

  it("renames identifier type and regenerates managed exposure query SQL", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        {
          userIdType: "user_id",
          description: "Primary id",
          attributes: ["user_id"],
        },
      ],
      queries: {
        exposure: [
          {
            id: "user_id",
            userIdType: "user_id",
            name: "user_id",
            description: "",
            dimensions: [],
            managedBy: "api",
            query:
              "SELECT CAST(JSON_VALUE(`attributes`, '$.\"user_id\"') AS STRING) AS `user_id`",
          },
        ],
      },
    });

    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);

    const before = {
      property: "user_id",
      datatype: "string" as const,
      hashAttribute: true,
    };
    const after = {
      property: "account_id",
      datatype: "string" as const,
      hashAttribute: true,
    };

    await syncHashAttributeMetadataForEventForwarder(
      {
        org: { id: "org1" },
        models: {
          eventForwarderConfigs: {
            getAll: jest
              .fn()
              .mockResolvedValue([
                { datasourceId: "ds_1", sinkType: "bigquery" },
              ]),
          },
        },
      } as never,
      {
        before,
        after,
        previousName: "user_id",
        attributeSchema: [after],
      },
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "ds_1" }),
      {
        settings: {
          userIdTypes: [
            {
              userIdType: "account_id",
              description: "Primary id",
              attributes: ["account_id"],
            },
          ],
          queries: {
            exposure: [
              expect.objectContaining({
                id: "account_id",
                userIdType: "account_id",
                name: "account_id",
                query: expect.stringContaining("account_id"),
              }),
            ],
          },
        },
      },
      { skipEventForwarderManagedValidation: true },
    );
  });

  it("regenerates exposure query SQL when hash attribute datatype changes", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        {
          userIdType: "user_id",
          description: "",
          attributes: ["user_id"],
        },
      ],
      queries: {
        exposure: [
          {
            id: "user_id",
            userIdType: "user_id",
            name: "user_id",
            description: "",
            dimensions: [],
            managedBy: "api",
            query:
              "SELECT CAST(JSON_VALUE(`attributes`, '$.\"user_id\"') AS STRING) AS `user_id`",
          },
        ],
      },
    });

    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);

    const before = {
      property: "user_id",
      datatype: "string" as const,
      hashAttribute: true,
    };
    const after = {
      property: "user_id",
      datatype: "number" as const,
      hashAttribute: true,
    };

    await syncHashAttributeMetadataForEventForwarder(
      {
        org: { id: "org1" },
        models: {
          eventForwarderConfigs: {
            getAll: jest
              .fn()
              .mockResolvedValue([
                { datasourceId: "ds_1", sinkType: "bigquery" },
              ]),
          },
        },
      } as never,
      {
        before,
        after,
        attributeSchema: [after],
      },
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "ds_1" }),
      {
        settings: expect.objectContaining({
          userIdTypes: [
            {
              userIdType: "user_id",
              description: "",
              attributes: ["user_id"],
            },
          ],
          queries: {
            exposure: [
              expect.objectContaining({
                id: "user_id",
                query: expect.stringContaining("AS FLOAT64"),
              }),
            ],
          },
        }),
      },
      { skipEventForwarderManagedValidation: true },
    );
  });
});
