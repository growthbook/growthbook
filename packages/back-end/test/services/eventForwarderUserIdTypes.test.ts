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

  it("adds managed identifiers alongside existing user identifier types", async () => {
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
            // The user's own identifier type is preserved untouched, and the
            // same-named managed one is skipped rather than duplicating the name.
            { userIdType: "user_id", description: "Existing" },
            {
              userIdType: "id",
              description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
              attributes: ["id"],
              managedBy: "api",
              sourceAttribute: "id",
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
              userIdType: "id",
              description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
              attributes: ["id"],
              managedBy: "api",
              sourceAttribute: "id",
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
        {
          userIdType: "legacy_id",
          description: "",
          attributes: ["legacy_id"],
          managedBy: "api",
          sourceAttribute: "legacy_id",
        },
        { userIdType: "custom_id", description: "Custom" },
      ],
      queries: {
        exposure: [
          {
            id: "exq_legacy",
            userIdType: "legacy_id",
            name: "legacy_id",
            sourceAttribute: "legacy_id",
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
        userIdType: "device_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["device_id"],
        managedBy: "api",
        sourceAttribute: "device_id",
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
        userIdType: "device_id",
        sourceAttribute: "device_id",
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
        userIdType: "id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["id"],
        managedBy: "api",
        sourceAttribute: "id",
      },
    ]);
    expect(settings?.queries?.exposure).toEqual([
      expect.objectContaining({
        userIdType: "id",
        sourceAttribute: "id",
        managedBy: "api",
      }),
    ]);
  });

  it("leaves managed exposure SQL alone when the hash attribute datatype changes", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        {
          userIdType: "user_id",
          description: "",
          attributes: ["user_id"],
          managedBy: "api",
          sourceAttribute: "user_id",
        },
      ],
      queries: {
        exposure: [
          {
            id: "exq_user",
            userIdType: "user_id",
            name: "user_id",
            sourceAttribute: "user_id",
            dimensions: [],
            managedBy: "api",
            query:
              "SELECT CAST(JSON_VALUE(`attributes`, '$.\"user_id\"') AS STRING) AS `user_id`",
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

    // Reconciliation only adds and removes. The stored cast is now stale against
    // the schema, but rewriting it would move the column type out from under
    // every experiment already reading it — that is the user's call to make.
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("takes over a pre-existing user identifier type and adds only the missing query", async () => {
    const raw = ds("ds_1", {
      // Datasource that predates the Event Forwarder.
      userIdTypes: [
        { userIdType: "user_id", description: "Mine", attributes: ["user_id"] },
      ],
      queries: {
        exposure: [
          {
            id: "exq_mine",
            userIdType: "user_id",
            name: "My own query",
            dimensions: [],
            query: "SELECT user_id FROM my_own_table",
          },
        ],
      },
    });
    setupDataSourceMocks(raw);
    const attributeSchema = [
      { property: "user_id", datatype: "string" as const, hashAttribute: true },
    ];

    await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
      contextWithSchema(attributeSchema) as never,
      efConfig(),
      attributeSchema,
    );

    const settings = mockedUpdate.mock.calls[0][2].settings;
    expect(settings?.userIdTypes).toEqual([
      {
        userIdType: "user_id",
        description: "Mine",
        attributes: ["user_id"],
        managedBy: "api",
        sourceAttribute: "user_id",
      },
    ]);
    // Their query has different SQL, so it survives and the managed one is added
    // beside it rather than replacing it.
    expect(settings?.queries?.exposure).toHaveLength(2);
    expect(settings?.queries?.exposure?.[0]).toEqual(
      raw.settings?.queries?.exposure?.[0],
    );
    expect(settings?.queries?.exposure?.[1]).toEqual(
      expect.objectContaining({
        userIdType: "user_id",
        sourceAttribute: "user_id",
        managedBy: "api",
      }),
    );
  });

  it("adopts a legacy ef_-prefixed datasource in place, without a migration", async () => {
    // Exactly what a datasource provisioned before this change looks like: the
    // attribute is encoded in the name, the exposure query id is that same name,
    // and neither record carries a link.
    const legacyUserIdType = {
      userIdType: "ef_user_id",
      description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
      attributes: ["user_id"],
      managedBy: "api" as const,
    };
    const legacyExposure = {
      id: "ef_user_id",
      userIdType: "ef_user_id",
      name: "ef_user_id",
      dimensions: ["country"],
      managedBy: "api" as const,
      query:
        "SELECT CAST(JSON_VALUE(`attributes`, '$.\"user_id\"') AS STRING) AS `ef_user_id`",
    };
    const raw = ds("ds_1", {
      userIdTypes: [legacyUserIdType],
      queries: { exposure: [legacyExposure] },
    });
    setupDataSourceMocks(raw);
    const attributeSchema = [
      { property: "user_id", datatype: "string" as const, hashAttribute: true },
    ];

    await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
      contextWithSchema(attributeSchema) as never,
      efConfig(),
      attributeSchema,
    );

    const settings = mockedUpdate.mock.calls[0][2].settings;
    // One identifier type for the attribute — no unprefixed twin beside it — and
    // the exposure query keeps the id every experiment already references.
    expect(settings?.userIdTypes).toEqual([
      { ...legacyUserIdType, sourceAttribute: "user_id" },
    ]);
    expect(settings?.queries?.exposure).toEqual([
      { ...legacyExposure, sourceAttribute: "user_id" },
    ]);
  });

  it("stops writing once a legacy datasource is linked", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        {
          userIdType: "ef_user_id",
          description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
          attributes: ["user_id"],
          managedBy: "api",
          sourceAttribute: "user_id",
        },
      ],
      queries: {
        exposure: [
          {
            id: "ef_user_id",
            userIdType: "ef_user_id",
            name: "ef_user_id",
            sourceAttribute: "user_id",
            dimensions: ["country"],
            managedBy: "api",
            query: "SELECT legacy",
          },
        ],
      },
    });
    setupDataSourceMocks(raw);
    const attributeSchema = [
      { property: "user_id", datatype: "string" as const, hashAttribute: true },
    ];

    await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
      contextWithSchema(attributeSchema) as never,
      efConfig(),
      attributeSchema,
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("removes managed identifiers and queries when no hash attributes remain", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        {
          userIdType: "legacy_id",
          description: "",
          attributes: ["legacy_id"],
          managedBy: "api",
          sourceAttribute: "legacy_id",
        },
      ],
      queries: {
        exposure: [
          {
            id: "exq_legacy",
            userIdType: "legacy_id",
            name: "legacy_id",
            sourceAttribute: "legacy_id",
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
        userIdType: "id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["id"],
        managedBy: "api",
        sourceAttribute: "id",
      },
    ]);
    expect(mockedUpdate.mock.calls[0][2].settings?.queries?.exposure).toEqual([
      expect.objectContaining({
        userIdType: "id",
        sourceAttribute: "id",
        managedBy: "api",
      }),
    ]);
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
