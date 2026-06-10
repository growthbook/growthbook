import type { DataSourceInterface } from "shared/types/datasource";
import {
  initializeDatasourceUserIdTypesFromOrgAttributeSchema,
  reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries,
  reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries,
} from "back-end/src/services/eventForwarderUserIdTypes";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as EventForwarderExposureQueries from "back-end/src/services/eventForwarderExposureQueries";
import * as DataSourceService from "back-end/src/services/datasource";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/services/eventForwarderExposureQueries");
jest.mock("back-end/src/services/datasource");

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
  schema: {
    property: string;
    datatype: "string" | "number";
    hashAttribute?: boolean;
  }[],
  overrides?: {
    getAll?: jest.Mock;
    update?: jest.Mock;
  },
) {
  return {
    org: {
      id: "org1",
      settings: { attributeSchema: schema },
    },
    models: {
      eventForwarderConfigs: {
        getAll: overrides?.getAll ?? jest.fn(),
        update:
          overrides?.update ??
          jest.fn(async (existing, updates) => ({ ...existing, ...updates })),
      },
    },
  };
}

function efConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "efc_1",
    organization: "org1",
    datasourceId: "ds_1",
    projects: [],
    topic: "topic",
    schemaId: 1,
    sinkType: "bigquery" as const,
    config: "encrypted",
    status: "pending" as const,
    ...overrides,
  };
}

describe("initializeDatasourceUserIdTypesFromOrgAttributeSchema without event forwarder config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});

describe("reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries", () => {
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

  it("removes stale managed identifiers and exposure queries while preserving custom entries", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        { userIdType: "legacy_id", description: "", attributes: ["legacy_id"] },
        { userIdType: "custom_id", description: "Custom" },
      ],
      queries: {
        exposure: [
          {
            id: "legacy_id",
            userIdType: "legacy_id",
            name: "legacy_id",
            dimensions: [],
            managedBy: "api",
            query: "SELECT legacy_id",
          },
          {
            id: "custom_query",
            userIdType: "custom_id",
            name: "Custom",
            dimensions: [],
            query: "SELECT custom_id",
          },
        ],
      },
    });
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);
    const attributeSchema = [
      {
        property: "device_id",
        datatype: "string" as const,
        hashAttribute: true,
      },
    ];
    const updateConfig = jest.fn();
    const config = efConfig();

    await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
      contextWithSchema(attributeSchema, { update: updateConfig }) as never,
      config,
      attributeSchema,
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "ds_1" }),
      {
        settings: {
          ...raw.settings,
          userIdTypes: [
            { userIdType: "custom_id", description: "Custom" },
            {
              userIdType: "device_id",
              description: "",
              attributes: ["device_id"],
            },
          ],
          queries: {
            exposure: [
              {
                id: "custom_query",
                userIdType: "custom_id",
                name: "Custom",
                dimensions: [],
                query: "SELECT custom_id",
              },
              expect.objectContaining({
                id: "device_id",
                userIdType: "device_id",
                managedBy: "api",
              }),
            ],
          },
        },
      },
      { skipEventForwarderManagedValidation: true },
    );

    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("adds new hash identifiers and managed exposure queries", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [],
      queries: { exposure: [] },
    });
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);
    const attributeSchema = [
      { property: "id", datatype: "string" as const, hashAttribute: true },
    ];

    await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
      contextWithSchema(attributeSchema) as never,
      efConfig(),
      attributeSchema,
    );

    const settings = mockedUpdate.mock.calls[0][2].settings;
    expect(settings?.userIdTypes).toEqual([
      { userIdType: "id", description: "", attributes: ["id"] },
    ]);
    expect(settings?.queries?.exposure).toEqual([
      expect.objectContaining({
        id: "id",
        userIdType: "id",
        managedBy: "api",
      }),
    ]);
  });

  it("regenerates managed exposure SQL when the hash attribute datatype changes", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        { userIdType: "user_id", description: "", attributes: ["user_id"] },
      ],
      queries: {
        exposure: [
          {
            id: "user_id",
            userIdType: "user_id",
            name: "user_id",
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
    const attributeSchema = [
      { property: "user_id", datatype: "number" as const, hashAttribute: true },
    ];

    await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
      contextWithSchema(attributeSchema) as never,
      efConfig(),
      attributeSchema,
    );

    const exposure = mockedUpdate.mock.calls[0][2].settings?.queries?.exposure;
    expect(exposure?.[0]).toEqual(
      expect.objectContaining({
        id: "user_id",
        userIdType: "user_id",
        query: expect.stringContaining("AS FLOAT64"),
      }),
    );
  });

  it("derives ownership from existing managed exposure queries", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        { userIdType: "legacy_id", description: "", attributes: ["legacy_id"] },
      ],
      queries: {
        exposure: [
          {
            id: "legacy_id",
            userIdType: "legacy_id",
            name: "legacy_id",
            dimensions: [],
            managedBy: "api",
            query: "SELECT legacy_id",
          },
        ],
      },
    });
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);
    const updateConfig = jest.fn();

    await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
      contextWithSchema([], { update: updateConfig }) as never,
      efConfig(),
      [],
    );

    expect(mockedUpdate.mock.calls[0][2].settings?.userIdTypes).toEqual([]);
    expect(mockedUpdate.mock.calls[0][2].settings?.queries?.exposure).toEqual(
      [],
    );
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("does nothing when no event forwarder configs exist", async () => {
    const getAll = jest.fn().mockResolvedValue([]);

    await reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries(
      {
        org: { id: "org1" },
        models: {
          eventForwarderConfigs: {
            getAll,
          },
        },
      } as never,
      [{ property: "id", datatype: "string", hashAttribute: true }],
    );

    expect(mockedGetRaw).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("initialization with an event forwarder config reconciles datasource only", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [],
      queries: { exposure: [] },
    });
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);
    const updateConfig = jest.fn();
    const attributeSchema = [
      { property: "id", datatype: "string" as const, hashAttribute: true },
    ];
    const config = efConfig();

    await initializeDatasourceUserIdTypesFromOrgAttributeSchema(
      contextWithSchema(attributeSchema, { update: updateConfig }) as never,
      "ds_1",
      config,
    );

    expect(mockedUpdate.mock.calls[0][2].settings?.userIdTypes).toEqual([
      { userIdType: "id", description: "", attributes: ["id"] },
    ]);
    expect(mockedUpdate.mock.calls[0][2].settings?.queries?.exposure).toEqual([
      expect.objectContaining({
        id: "id",
        userIdType: "id",
        managedBy: "api",
      }),
    ]);
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
