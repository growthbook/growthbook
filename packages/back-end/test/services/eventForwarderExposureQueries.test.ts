import type { DataSourceInterface } from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { ensureEventForwarderExposureQueries } from "back-end/src/services/eventForwarder/datasourceQueries";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as EventForwarderConfig from "back-end/src/services/eventForwarder/config";
import { encryptParams } from "back-end/src/services/datasource";
import { queueDelayedEventForwarderWarehouseSyncForDatasource } from "back-end/src/services/eventForwarder/warehouseSync";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/services/eventForwarder/config");
jest.mock("back-end/src/services/eventForwarder/warehouseSync", () => ({
  queueDelayedEventForwarderWarehouseSyncForDatasource: jest.fn(),
}));

const mockedGetById = DataSourceModel.getDataSourceById as jest.MockedFunction<
  typeof DataSourceModel.getDataSourceById
>;
const mockedUpdate = DataSourceModel.updateDataSource as jest.MockedFunction<
  typeof DataSourceModel.updateDataSource
>;
const mockedDecrypt =
  EventForwarderConfig.decryptEventForwarderConfigModel as jest.MockedFunction<
    typeof EventForwarderConfig.decryptEventForwarderConfigModel
  >;
const mockedGetBigQueryTablePrefix =
  EventForwarderConfig.getBigQueryEventForwarderTablePrefix as jest.MockedFunction<
    typeof EventForwarderConfig.getBigQueryEventForwarderTablePrefix
  >;
const mockedGetBigQueryProjectId =
  EventForwarderConfig.getBigQueryEventForwarderProjectId as jest.MockedFunction<
    typeof EventForwarderConfig.getBigQueryEventForwarderProjectId
  >;
const mockedGetSnowflakeTablePrefix =
  EventForwarderConfig.getSnowflakeEventForwarderTablePrefix as jest.MockedFunction<
    typeof EventForwarderConfig.getSnowflakeEventForwarderTablePrefix
  >;
const mockedQueueWarehouseSync =
  queueDelayedEventForwarderWarehouseSyncForDatasource as jest.MockedFunction<
    typeof queueDelayedEventForwarderWarehouseSyncForDatasource
  >;

function ds(
  settings: DataSourceInterface["settings"] = {},
): DataSourceInterface {
  return {
    id: "ds_1",
    organization: "org1",
    name: "Production Analytics",
    type: "bigquery",
    description: "",
    params: {
      defaultProject: "my-project",
      defaultDataset: "analytics_123",
    } as DataSourceInterface["params"],
    settings,
    projects: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
}

function efConfig(sinkType: "bigquery" | "snowflake" = "bigquery") {
  return {
    id: "efc_1",
    datasourceId: "ds_1",
    sinkType,
    config: "encrypted",
    status: "pending" as const,
    organization: "org1",
    projects: [],
    topic: "topic",
  };
}

function context(
  attributeSchema: {
    property: string;
    datatype: "string";
    hashAttribute?: boolean;
  }[] = [
    { property: "device_id", datatype: "string", hashAttribute: true },
    { property: "user_id", datatype: "string", hashAttribute: true },
  ],
) {
  return {
    org: { id: "org1", settings: { attributeSchema } },
    userId: "user_1",
  };
}

describe("ensureEventForwarderExposureQueries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetBigQueryTablePrefix.mockReturnValue("gb");
    mockedGetBigQueryProjectId.mockImplementation(
      (config, params) =>
        config.projectId?.trim() ||
        params?.defaultProject?.trim() ||
        params?.projectId?.trim() ||
        "",
    );
    mockedGetSnowflakeTablePrefix.mockReturnValue("GB");
  });

  it("creates BigQuery exposure queries using decrypted params when datasourceParams is omitted", async () => {
    const bigqueryParams: BigQueryConnectionParams = {
      projectId: "my-project",
      clientEmail: "test@example.com",
      privateKey: "key",
    };
    const raw = ds({
      userIdTypes: [{ userIdType: "ef_device_id", description: "" }],
      queries: { exposure: [] },
    });
    raw.params = encryptParams(bigqueryParams);
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
      ["ef_device_id"],
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        settings: expect.objectContaining({
          queries: {
            exposure: [
              expect.objectContaining({
                userIdType: "ef_device_id",
                id: "ef_device_id",
                managedBy: "api",
              }),
            ],
          },
        }),
      },
      { skipEventForwarderManagedValidation: true },
    );
  });

  it("creates one exposure query per synced userIdType for BigQuery", async () => {
    const raw = ds({
      userIdTypes: [
        { userIdType: "ef_user_id", description: "" },
        { userIdType: "ef_device_id", description: "" },
      ],
      queries: { exposure: [] },
    });
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
      ["ef_user_id", "ef_device_id"],
      { defaultProject: "my-project" } as never,
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        settings: expect.objectContaining({
          queries: {
            exposure: expect.arrayContaining([
              expect.objectContaining({
                userIdType: "ef_user_id",
                id: "ef_user_id",
                managedBy: "api",
              }),
              expect.objectContaining({
                userIdType: "ef_device_id",
                id: "ef_device_id",
              }),
            ]),
          },
        }),
      },
      { skipEventForwarderManagedValidation: true },
    );

    const exposure =
      mockedUpdate.mock.calls[0][2].settings?.queries?.exposure ?? [];
    expect(exposure).toHaveLength(2);
    expect(exposure[0].query).toContain("gb_experiment_viewed");
    expect(exposure[0].query).toContain("received_at BETWEEN");
    expect(exposure[0].query).not.toContain("experiment_id LIKE");
    expect(mockedQueueWarehouseSync).toHaveBeenCalledWith(
      expect.anything(),
      "ds_1",
    );
  });

  it("creates Snowflake exposure queries without WHERE clause", async () => {
    const raw = ds({
      userIdTypes: [{ userIdType: "user_id", description: "" }],
      queries: { exposure: [] },
    });
    mockedGetById.mockResolvedValue({
      ...raw,
      type: "snowflake",
      params: {} as DataSourceInterface["params"],
    });
    mockedDecrypt.mockReturnValue({
      database: "MY_DB",
      schema: "PUBLIC",
      tablePrefix: "GB",
      account: "acct",
      username: "user",
      privateKey: "key",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("snowflake"),
      ["user_id"],
    );

    const exposure =
      mockedUpdate.mock.calls[0][2].settings?.queries?.exposure ?? [];
    expect(exposure).toHaveLength(1);
    expect(exposure[0].query).toContain("MY_DB.PUBLIC.GB_EXPERIMENT_VIEWED");
    expect(exposure[0].query).not.toContain("WHERE");
  });

  it("is idempotent when exposure queries already exist", async () => {
    const raw = ds({
      userIdTypes: [{ userIdType: "user_id", description: "" }],
      queries: {
        exposure: [
          {
            id: "ef_user_id",
            name: "ef_user_id",
            userIdType: "user_id",
            dimensions: [],
            managedBy: "api",
            query: "SELECT 1",
          },
        ],
      },
    });
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
      ["user_id"],
      { defaultProject: "my-project" } as never,
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedQueueWarehouseSync).not.toHaveBeenCalled();
  });

  it("appends only missing identifier types without overwriting existing", async () => {
    const raw = ds({
      userIdTypes: [
        { userIdType: "user_id", description: "" },
        { userIdType: "device_id", description: "" },
      ],
      queries: {
        exposure: [
          {
            id: "user_id",
            name: "Custom",
            userIdType: "user_id",
            dimensions: [],
            query: "SELECT custom",
          },
        ],
      },
    });
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
      ["device_id"],
      { defaultProject: "my-project" } as never,
    );

    const exposure =
      mockedUpdate.mock.calls[0][2].settings?.queries?.exposure ?? [];
    expect(exposure).toHaveLength(2);
    expect(exposure[0].query).toBe("SELECT custom");
    expect(exposure[1].userIdType).toBe("device_id");
  });

  it("skips when synced userIdTypes is empty", async () => {
    mockedGetById.mockResolvedValue(ds({ userIdTypes: [], queries: {} }));

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
      [],
      { defaultProject: "my-project" } as never,
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedGetById).not.toHaveBeenCalled();
  });

  it("does not create exposure queries for non-hash synced userIdTypes", async () => {
    const raw = ds({
      userIdTypes: [
        { userIdType: "anonymous_id", description: "Pre-existing" },
        { userIdType: "device_id", description: "" },
      ],
      queries: { exposure: [] },
    });
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    await ensureEventForwarderExposureQueries(
      context([
        { property: "device_id", datatype: "string", hashAttribute: true },
      ]) as never,
      efConfig("bigquery"),
      ["anonymous_id", "device_id"],
      { defaultProject: "my-project" } as never,
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        settings: expect.objectContaining({
          queries: {
            exposure: [
              expect.objectContaining({
                userIdType: "device_id",
              }),
            ],
          },
        }),
      },
      { skipEventForwarderManagedValidation: true },
    );

    const exposure =
      mockedUpdate.mock.calls[0][2].settings?.queries?.exposure ?? [];
    expect(exposure).toHaveLength(1);
    expect(exposure.some((q) => q.userIdType === "anonymous_id")).toBe(false);
  });

  it("uses passed attributeSchema when context org schema is stale", async () => {
    const raw = ds({
      userIdTypes: [{ userIdType: "ef_device_id", description: "" }],
      queries: { exposure: [] },
    });
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    const updatedAttributeSchema = [
      {
        property: "device_id",
        datatype: "string" as const,
        hashAttribute: true,
      },
    ];

    await ensureEventForwarderExposureQueries(
      context([]) as never,
      efConfig("bigquery"),
      ["ef_device_id"],
      { defaultProject: "my-project" } as never,
      updatedAttributeSchema,
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        settings: expect.objectContaining({
          queries: {
            exposure: [
              expect.objectContaining({
                userIdType: "ef_device_id",
                id: "ef_device_id",
                managedBy: "api",
              }),
            ],
          },
        }),
      },
      { skipEventForwarderManagedValidation: true },
    );
  });
});
