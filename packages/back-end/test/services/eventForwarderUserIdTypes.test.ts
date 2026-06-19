import type { DataSourceInterface } from "shared/types/datasource";
import {
  initializeDatasourceUserIdTypesFromOrgAttributeSchema,
  reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries,
  reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries,
} from "back-end/src/services/eventForwarder/datasourceSync";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as EventForwarderExposureQueries from "back-end/src/services/eventForwarder/sinkParams";
import * as DataSourceService from "back-end/src/services/datasource";

const EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION =
  "Managed by Event Forwarder.";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
  updateDataSource: jest.fn(),
}));
jest.mock("back-end/src/services/eventForwarder/sinkParams");
jest.mock("back-end/src/services/datasource");

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

function setupDataSourceMocks(raw?: DataSourceInterface) {
  if (raw) {
    mockedGetById.mockResolvedValue(raw);
  }
  mockedUpdate.mockResolvedValue(undefined);
}

describe("initializeDatasourceUserIdTypesFromOrgAttributeSchema without event forwarder config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDataSourceMocks();
  });

  it("adds prefixed managed identifiers alongside existing user identifier types", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [{ userIdType: "user_id", description: "Existing" }],
    });
    setupDataSourceMocks(raw);

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
            // The user's own identifier type is preserved untouched; the managed
            // ones are prefixed so they coexist instead of overriding it.
            { userIdType: "user_id", description: "Existing" },
            {
              userIdType: "ef_USER_ID",
              description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
              attributes: ["USER_ID"],
            },
            {
              userIdType: "ef_id",
              description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
              attributes: ["id"],
            },
          ],
        },
      },
    );
  });

  it("writes userIdTypes when raw Mongo has none", async () => {
    const raw = ds("ds_1", {});
    setupDataSourceMocks(raw);

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
              userIdType: "ef_id",
              description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
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
    setupDataSourceMocks();
    mockedGetSourceIntegrationObject.mockReturnValue({
      params: { defaultProject: "my-project" },
    } as never);
    mockedBuildExposureQueryParams.mockReturnValue({
      sinkType: "bigquery",
      projectId: "my-project",
      dataset: "analytics_123",
      tablePrefix: "gb",
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
    setupDataSourceMocks(raw);
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

    const settings = mockedUpdate.mock.calls[0][2].settings;
    expect(settings?.userIdTypes).toEqual([
      { userIdType: "custom_id", description: "Custom" },
      {
        userIdType: "ef_device_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["device_id"],
      },
    ]);
    expect(settings?.queries?.exposure).toEqual([
      {
        id: "custom_query",
        userIdType: "custom_id",
        name: "Custom",
        dimensions: [],
        query: "SELECT custom_id",
      },
      expect.objectContaining({
        id: "ef_device_id",
        userIdType: "ef_device_id",
        managedBy: "api",
      }),
    ]);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "ds_1" }),
      expect.objectContaining({ settings: expect.anything() }),
      { skipEventForwarderManagedValidation: true },
    );

    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("adds new hash identifiers and managed exposure queries", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [],
      queries: { exposure: [] },
    });
    setupDataSourceMocks(raw);
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
      {
        userIdType: "ef_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["id"],
      },
    ]);
    expect(settings?.queries?.exposure).toEqual([
      expect.objectContaining({
        id: "ef_id",
        userIdType: "ef_id",
        managedBy: "api",
      }),
    ]);
  });

  it("regenerates managed exposure SQL when the hash attribute datatype changes", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        { userIdType: "ef_user_id", description: "", attributes: ["user_id"] },
      ],
      queries: {
        exposure: [
          {
            id: "ef_user_id",
            userIdType: "ef_user_id",
            name: "ef_user_id",
            dimensions: [],
            managedBy: "api",
            query:
              "SELECT CAST(JSON_VALUE(`attributes`, '$.\"user_id\"') AS STRING) AS `ef_user_id`",
          },
        ],
      },
    });
    setupDataSourceMocks(raw);
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
        id: "ef_user_id",
        userIdType: "ef_user_id",
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
    setupDataSourceMocks(raw);
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

    expect(mockedGetById).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("initialization with an event forwarder config reconciles datasource only", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [],
      queries: { exposure: [] },
    });
    setupDataSourceMocks(raw);
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
      {
        userIdType: "ef_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["id"],
      },
    ]);
    expect(mockedUpdate.mock.calls[0][2].settings?.queries?.exposure).toEqual([
      expect.objectContaining({
        id: "ef_id",
        userIdType: "ef_id",
        managedBy: "api",
      }),
    ]);
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
