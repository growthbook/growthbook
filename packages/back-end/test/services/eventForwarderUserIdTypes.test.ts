import type { DataSourceInterface } from "shared/types/datasource";
import {
  buildEventForwarderExposureQuerySql,
  EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
} from "shared/util";
import {
  reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries,
  reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries,
} from "back-end/src/services/eventForwarder/datasourceSync";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as EventForwarderExposureQueries from "back-end/src/services/eventForwarder/sinkParams";
import * as DataSourceService from "back-end/src/services/datasource";

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

// Matches the params mocked onto buildExposureQueryParams below, so fixtures can
// hold byte-exact generator output rather than an abbreviation of it.
const EXPERIMENT_VIEWED_TABLE_REF =
  "`my-project`.`analytics_123`.`gb_experiment_viewed`";

function managedExposureSql({
  userIdType,
  sourceAttribute,
  attributeDatatype,
}: {
  userIdType: string;
  sourceAttribute: string;
  attributeDatatype: "string" | "number";
}) {
  return buildEventForwarderExposureQuerySql({
    sinkType: "bigquery",
    tableRef: EXPERIMENT_VIEWED_TABLE_REF,
    userIdType,
    sourceAttribute,
    attributeDatatype,
  });
}

function setupDataSourceMocks(raw?: DataSourceInterface) {
  if (raw) {
    mockedGetById.mockResolvedValue(raw);
  }
  mockedUpdate.mockResolvedValue(undefined);
}

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

  it("keeps stale managed records and the user's own entries", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        {
          userIdType: "legacy_id",
          description: "",
          attributes: ["legacy_id"],
          managedBy: "api",
        },
        { userIdType: "custom_id", description: "Custom" },
      ],
      queries: {
        exposure: [
          {
            id: "exq_legacy",
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
    // legacy_id stays exactly as it is, so it resumes updating if its attribute
    // comes back. Nothing the Event Forwarder created is ever deleted.
    expect(settings?.userIdTypes).toEqual([
      {
        userIdType: "legacy_id",
        description: "",
        attributes: ["legacy_id"],
        managedBy: "api",
      },
      { userIdType: "custom_id", description: "Custom" },
      {
        userIdType: "device_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["device_id"],
        managedBy: "api",
      },
    ]);
    expect(settings?.queries?.exposure).toEqual([
      {
        id: "exq_legacy",
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
      expect.objectContaining({
        userIdType: "device_id",
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

  it("creates an identifier type and a managed query for a new attribute", async () => {
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
      },
    ]);
    expect(settings?.queries?.exposure).toEqual([
      expect.objectContaining({
        userIdType: "id",
        managedBy: "api",
      }),
    ]);
  });

  it("regenerates managed exposure SQL when the hash attribute datatype changes", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        {
          userIdType: "user_id",
          description: "",
          attributes: ["user_id"],
          managedBy: "api",
        },
      ],
      queries: {
        exposure: [
          {
            id: "exq_user",
            userIdType: "user_id",
            name: "user_id",
            dimensions: [],
            managedBy: "api",
            query: managedExposureSql({
              userIdType: "user_id",
              sourceAttribute: "user_id",
              attributeDatatype: "string",
            }),
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
        // Preserved: experiments and reports reference this id, and the alias is
        // the warehouse column. Only the cast tracks the schema.
        id: "exq_user",
        userIdType: "user_id",
        name: "user_id",
        query: expect.stringContaining("FLOAT64"),
      }),
    );
  });

  it("adopts a pre-existing user identifier type and adds the missing query", async () => {
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
    };
    const legacyExposure = {
      id: "ef_user_id",
      userIdType: "ef_user_id",
      name: "ef_user_id",
      dimensions: ["country"],
      managedBy: "api" as const,
      // Byte-exact output of the pre-prefix generator: the prefixed name as the
      // alias, the bare attribute as the source.
      query: managedExposureSql({
        userIdType: "ef_user_id",
        sourceAttribute: "user_id",
        attributeDatatype: "string",
      }),
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

    // The name and the query id are untouched — every experiment, report, safe
    // rollout, template and ramp schedule holding them keeps resolving — and no
    // unprefixed twin appears. Only the managed marker is added.
    const settings = mockedUpdate.mock.calls[0][2].settings;
    expect(settings?.userIdTypes).toEqual([
      { ...legacyUserIdType, managedBy: "api" },
    ]);
    expect(settings?.queries?.exposure).toEqual([legacyExposure]);
  });

  it("writes nothing on the second sync of a legacy datasource", async () => {
    const attributeSchema = [
      { property: "user_id", datatype: "string" as const, hashAttribute: true },
    ];
    const linkedUserIdType = {
      userIdType: "ef_user_id",
      description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
      attributes: ["user_id"],
      managedBy: "api" as const,
    };
    const raw = ds("ds_1", {
      userIdTypes: [linkedUserIdType],
      queries: {
        exposure: [
          {
            id: "ef_user_id",
            userIdType: "ef_user_id",
            name: "ef_user_id",
            dimensions: ["country"],
            managedBy: "api",
            query: managedExposureSql({
              userIdType: "ef_user_id",
              sourceAttribute: "user_id",
              attributeDatatype: "string",
            }),
          },
        ],
      },
    });
    setupDataSourceMocks(raw);

    await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
      contextWithSchema(attributeSchema) as never,
      efConfig(),
      attributeSchema,
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("writes nothing when no hash attributes remain", async () => {
    const raw = ds("ds_1", {
      userIdTypes: [
        {
          userIdType: "legacy_id",
          description: "",
          attributes: ["legacy_id"],
          managedBy: "api",
        },
      ],
      queries: {
        exposure: [
          {
            id: "exq_legacy",
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

    // Removing the last hash attribute must not delete the identifier type an
    // identity join reads or the query id an experiment references, and must not
    // hand them to the user either — they resume updating if it comes back.
    expect(mockedUpdate).not.toHaveBeenCalled();
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
});
