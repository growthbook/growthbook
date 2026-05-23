import type { DataSourceInterface } from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { ensureEventForwarderExposureQueries } from "back-end/src/services/eventForwarderExposureQueries";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as EventForwarderConfig from "back-end/src/services/eventForwarderConfig";
import { encryptParams } from "back-end/src/services/datasource";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/services/eventForwarderConfig");

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
const mockedDecrypt =
  EventForwarderConfig.decryptEventForwarderConfigModel as jest.MockedFunction<
    typeof EventForwarderConfig.decryptEventForwarderConfigModel
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

function context() {
  return {
    org: { id: "org1", settings: { attributeSchema: [] } },
    userId: "user_1",
  };
}

describe("ensureEventForwarderExposureQueries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates BigQuery exposure queries using decrypted params when datasourceParams is omitted", async () => {
    const bigqueryParams: BigQueryConnectionParams = {
      projectId: "my-project",
      clientEmail: "test@example.com",
      privateKey: "key",
    };
    const raw = ds({
      userIdTypes: [{ userIdType: "device_id", description: "" }],
      queries: { exposure: [] },
    });
    raw.params = encryptParams(bigqueryParams);
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tableName: "gb_events",
      serviceAccountKey: "{}",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
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
                id: "device_id",
                managedBy: "api",
              }),
            ],
          },
        }),
      },
    );
  });

  it("creates one exposure query per userIdType for BigQuery", async () => {
    const raw = ds({
      userIdTypes: [
        { userIdType: "user_id", description: "" },
        { userIdType: "device_id", description: "" },
      ],
      queries: { exposure: [] },
    });
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tableName: "gb_events",
      serviceAccountKey: "{}",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
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
                userIdType: "user_id",
                id: "user_id",
                managedBy: "api",
              }),
              expect.objectContaining({
                userIdType: "device_id",
                id: "device_id",
              }),
            ]),
          },
        }),
      },
    );

    const exposure =
      mockedUpdate.mock.calls[0][2].settings?.queries?.exposure ?? [];
    expect(exposure).toHaveLength(2);
    expect(exposure[0].query).toContain("experiment_viewed");
    expect(exposure[0].query).toContain("received_at BETWEEN");
    expect(exposure[0].query).not.toContain("experiment_id LIKE");
  });

  it("creates Snowflake exposure queries without WHERE clause", async () => {
    const raw = ds({
      userIdTypes: [{ userIdType: "user_id", description: "" }],
      queries: { exposure: [] },
    });
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue({
      ...raw,
      type: "snowflake",
      params: {} as DataSourceInterface["params"],
    });
    mockedDecrypt.mockReturnValue({
      database: "MY_DB",
      schema: "PUBLIC",
      tableName: "gb_events",
      account: "acct",
      username: "user",
      privateKey: "key",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("snowflake"),
    );

    const exposure =
      mockedUpdate.mock.calls[0][2].settings?.queries?.exposure ?? [];
    expect(exposure).toHaveLength(1);
    expect(exposure[0].query).toContain("MY_DB.PUBLIC.experiment_viewed");
    expect(exposure[0].query).not.toContain("WHERE");
  });

  it("is idempotent when exposure queries already exist", async () => {
    const raw = ds({
      userIdTypes: [{ userIdType: "user_id", description: "" }],
      queries: {
        exposure: [
          {
            id: "user_id",
            name: "user_id",
            userIdType: "user_id",
            dimensions: [],
            query: "SELECT 1",
          },
        ],
      },
    });
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tableName: "gb_events",
      serviceAccountKey: "{}",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
      { defaultProject: "my-project" } as never,
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
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
    mockedGetRaw.mockResolvedValue(raw);
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tableName: "gb_events",
      serviceAccountKey: "{}",
    });

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
      { defaultProject: "my-project" } as never,
    );

    const exposure =
      mockedUpdate.mock.calls[0][2].settings?.queries?.exposure ?? [];
    expect(exposure).toHaveLength(2);
    expect(exposure[0].query).toBe("SELECT custom");
    expect(exposure[1].userIdType).toBe("device_id");
  });

  it("skips when no userIdTypes on datasource", async () => {
    mockedGetRaw.mockResolvedValue(ds({ userIdTypes: [], queries: {} }));

    await ensureEventForwarderExposureQueries(
      context() as never,
      efConfig("bigquery"),
      { defaultProject: "my-project" } as never,
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedGetById).not.toHaveBeenCalled();
  });
});
