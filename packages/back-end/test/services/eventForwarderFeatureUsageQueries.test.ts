import type { DataSourceInterface } from "shared/types/datasource";
import { ensureEventForwarderFeatureUsageQuery } from "back-end/src/services/eventForwarder/datasourceQueries";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as EventForwarderConfig from "back-end/src/services/eventForwarder/config";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/services/eventForwarder/config");

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

describe("ensureEventForwarderFeatureUsageQuery", () => {
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

  it("creates a managed feature usage query for BigQuery", async () => {
    const raw = ds({ queries: { featureUsage: [] } });
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    const ids = await ensureEventForwarderFeatureUsageQuery(
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
            featureUsage: [
              expect.objectContaining({
                managedBy: "api",
              }),
            ],
          },
        }),
      },
      { skipEventForwarderManagedValidation: true },
    );

    const featureUsage =
      mockedUpdate.mock.calls[0][2].settings?.queries?.featureUsage ?? [];
    expect(featureUsage).toHaveLength(1);
    expect(featureUsage[0].query).toContain("gb_feature_usage");
    expect(featureUsage[0].query).toContain("feature_key AS feature_key");
    expect(featureUsage[0].query).toContain("received_at BETWEEN");
    expect(ids).toEqual([featureUsage[0].id]);
  });

  it("appends a managed query when a manual query already exists", async () => {
    const raw = ds({
      queries: {
        featureUsage: [{ id: "manual", query: "SELECT 1" }],
      },
    });
    mockedGetById.mockResolvedValue(raw);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics_123",
      tablePrefix: "gb",
      serviceAccountKey: "{}",
    });

    const ids = await ensureEventForwarderFeatureUsageQuery(
      context() as never,
      efConfig("bigquery"),
      { defaultProject: "my-project" } as never,
    );

    const featureUsage =
      mockedUpdate.mock.calls[0][2].settings?.queries?.featureUsage ?? [];
    expect(featureUsage).toHaveLength(2);
    expect(featureUsage[0].id).toBe("manual");
    expect(featureUsage[1].managedBy).toBe("api");
    expect(ids).toEqual([featureUsage[1].id]);
  });

  it("skips when a managed query already exists", async () => {
    const raw = ds({
      queries: {
        featureUsage: [{ id: "managed", query: "SELECT 2", managedBy: "api" }],
      },
    });
    mockedGetById.mockResolvedValue(raw);

    const ids = await ensureEventForwarderFeatureUsageQuery(
      context() as never,
      efConfig("bigquery"),
    );

    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(ids).toEqual(["managed"]);
  });

  it("creates Snowflake feature usage query without WHERE clause", async () => {
    const raw = ds({ queries: { featureUsage: [] } });
    mockedGetById.mockResolvedValue({ ...raw, type: "snowflake" });
    mockedDecrypt.mockReturnValue({
      database: "MY_DB",
      schema: "PUBLIC",
      tablePrefix: "GB",
      account: "acct",
      username: "user",
      privateKey: "key",
      role: "ROLE",
    });

    await ensureEventForwarderFeatureUsageQuery(
      context() as never,
      efConfig("snowflake"),
    );

    const featureUsage =
      mockedUpdate.mock.calls[0][2].settings?.queries?.featureUsage ?? [];
    expect(featureUsage[0].query).toContain("MY_DB.PUBLIC.GB_FEATURE_USAGE");
    expect(featureUsage[0].query).not.toContain("WHERE");
  });
});
