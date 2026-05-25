import { checkEventForwarderWarehouseReady } from "back-end/src/services/eventForwarderWarehouseReadiness";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as EventForwarderConfig from "back-end/src/services/eventForwarderConfig";
import * as DatasourceService from "back-end/src/services/datasource";
import * as EventForwarderWarehouseColumnValidity from "back-end/src/services/eventForwarderWarehouseColumnValidity";

jest.mock("back-end/src/models/DataSourceModel");
jest.mock("back-end/src/services/eventForwarderConfig");
jest.mock("back-end/src/services/datasource");
jest.mock("back-end/src/services/eventForwarderWarehouseColumnValidity");

const mockedGetRaw =
  DataSourceModel.getRawDataSourceById as jest.MockedFunction<
    typeof DataSourceModel.getRawDataSourceById
  >;
const mockedGetDs = DataSourceModel.getDataSourceById as jest.MockedFunction<
  typeof DataSourceModel.getDataSourceById
>;
const mockedGetEfConfig =
  EventForwarderConfig.getEventForwarderConfigForDatasource as jest.MockedFunction<
    typeof EventForwarderConfig.getEventForwarderConfigForDatasource
  >;
const mockedDecrypt =
  EventForwarderConfig.decryptEventForwarderConfigModel as jest.MockedFunction<
    typeof EventForwarderConfig.decryptEventForwarderConfigModel
  >;
const mockedIntegration =
  DatasourceService.getSourceIntegrationObject as jest.MockedFunction<
    typeof DatasourceService.getSourceIntegrationObject
  >;
const mockedTestExposure =
  DatasourceService.testQueryValidity as jest.MockedFunction<
    typeof DatasourceService.testQueryValidity
  >;
const mockedTestFeatureUsage =
  DatasourceService.testFeatureUsageQueryValidity as jest.MockedFunction<
    typeof DatasourceService.testFeatureUsageQueryValidity
  >;
const mockedTestColumnProbe =
  EventForwarderWarehouseColumnValidity.testEventForwarderWarehouseColumnProbeValidity as jest.MockedFunction<
    typeof EventForwarderWarehouseColumnValidity.testEventForwarderWarehouseColumnProbeValidity
  >;

describe("checkEventForwarderWarehouseReady", () => {
  const context = {
    org: {
      id: "org1",
      settings: { testQueryDays: 7 },
    },
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetRaw.mockResolvedValue({
      settings: {
        queries: {
          exposure: [
            {
              id: "user_id",
              userIdType: "user_id",
              managedBy: "api",
              query: "SELECT 1",
            },
          ],
          featureUsage: [
            {
              id: "fu_1",
              managedBy: "api",
              query: "SELECT 1",
            },
          ],
        },
      },
    } as never);
    mockedGetDs.mockResolvedValue({
      id: "ds_1",
      type: "bigquery",
      settings: { userIdTypes: [{ userIdType: "user_id" }] },
    } as never);
    mockedGetEfConfig.mockResolvedValue({
      sinkType: "bigquery",
      config: "encrypted",
    } as never);
    mockedDecrypt.mockReturnValue({
      dataset: "analytics",
      tableName: "gb_events",
    });
    mockedIntegration.mockReturnValue({
      params: { projectId: "proj", defaultProject: "proj" },
    } as never);
    mockedTestExposure.mockResolvedValue(undefined);
    mockedTestFeatureUsage.mockResolvedValue(undefined);
    mockedTestColumnProbe.mockResolvedValue(undefined);
  });

  it("returns ready when all three Event Forwarder tables pass", async () => {
    const result = await checkEventForwarderWarehouseReady(context, "ds_1", {
      kind: "initial",
    });

    expect(result.ready).toBe(true);
    expect(mockedTestExposure).toHaveBeenCalled();
    expect(mockedTestFeatureUsage).toHaveBeenCalled();
    expect(mockedTestColumnProbe).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("`user_id` AS `user_id`"),
      ["user_id"],
      7,
      "timestamp",
    );
  });

  it("returns not ready when experiment_viewed query fails", async () => {
    mockedTestExposure.mockResolvedValue("Table not found");

    const result = await checkEventForwarderWarehouseReady(context, "ds_1", {
      kind: "initial",
    });

    expect(result.ready).toBe(false);
    expect(result.reasons[0]).toContain("experiment_viewed");
  });

  it("uses column probe for Snowflake events table with uppercase sources", async () => {
    mockedGetDs.mockResolvedValue({
      id: "ds_1",
      type: "snowflake",
      settings: { userIdTypes: [{ userIdType: "user_id" }] },
    } as never);
    mockedGetEfConfig.mockResolvedValue({
      sinkType: "snowflake",
      config: "encrypted",
    } as never);
    mockedDecrypt.mockReturnValue({
      database: "MY_DB",
      schema: "PUBLIC",
      tableName: "gb_events",
    });
    mockedIntegration.mockReturnValue({
      params: { account: "acct" },
    } as never);

    await checkEventForwarderWarehouseReady(context, "ds_1", {
      kind: "columnsAdded",
      columnNames: ["country", "plan"],
    });

    expect(mockedTestColumnProbe).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("COUNTRY AS country"),
      ["country", "plan"],
      7,
      "timestamp",
    );
    expect(mockedTestColumnProbe.mock.calls[0][1]).toContain("PLAN AS plan");
    expect(mockedTestColumnProbe.mock.calls[0][1]).not.toContain("WHERE");
  });

  it("reports missing columns from events table column probe", async () => {
    mockedTestColumnProbe.mockResolvedValue(
      "Missing required columns in response: plan",
    );

    const result = await checkEventForwarderWarehouseReady(context, "ds_1", {
      kind: "columnsAdded",
      columnNames: ["country", "plan"],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons[0]).toContain("events:");
    expect(result.reasons[0]).toContain("plan");
  });
});
