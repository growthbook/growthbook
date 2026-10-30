import { createBigQueryClient } from "back-end/src/services/bigqueryClient";
import { detectEventForwarderWarehouseRegion } from "back-end/src/services/eventForwarder/detectRegion";
import { runSnowflakeQuery } from "back-end/src/services/snowflake";
import { logger } from "back-end/src/util/logger";

jest.mock("back-end/src/services/bigqueryClient", () => ({
  createBigQueryClient: jest.fn(),
}));
jest.mock("back-end/src/services/snowflake", () => ({
  runSnowflakeQuery: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedCreateBigQueryClient = createBigQueryClient as jest.MockedFunction<
  typeof createBigQueryClient
>;
const mockedRunSnowflakeQuery = runSnowflakeQuery as jest.MockedFunction<
  typeof runSnowflakeQuery
>;

describe("detectEventForwarderWarehouseRegion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reads a Databricks region from the Zerobus endpoint", async () => {
    const detected = await detectEventForwarderWarehouseRegion({
      type: "databricks",
      params: {},
      location: "growthbook_events",
      zerobusEndpoint: "https://adb.zerobus.eu-west-1.cloud.databricks.com",
    });

    expect(detected).toEqual({
      warehouseRegionId: "eu-west-1",
      growthBookRegion: "eu-west-1",
    });
    expect(mockedCreateBigQueryClient).not.toHaveBeenCalled();
    expect(mockedRunSnowflakeQuery).not.toHaveBeenCalled();
  });

  it("returns null for a Databricks endpoint that has no region", async () => {
    const detected = await detectEventForwarderWarehouseRegion({
      type: "databricks",
      params: {},
      location: "growthbook_events",
      zerobusEndpoint: "https://adb.cloud.databricks.com",
    });

    expect(detected).toBeNull();
  });

  it("reads a BigQuery region from the dataset location", async () => {
    const getMetadata = jest
      .fn()
      .mockResolvedValue([{ location: "europe-west1" }]);
    const dataset = jest.fn().mockReturnValue({ getMetadata });
    mockedCreateBigQueryClient.mockReturnValue({ dataset } as never);

    const detected = await detectEventForwarderWarehouseRegion({
      type: "bigquery",
      params: { defaultProject: "analytics", projectId: "other" },
      location: "growthbook_events",
    });

    expect(dataset).toHaveBeenCalledWith("growthbook_events", {
      projectId: "analytics",
    });
    expect(detected).toEqual({
      warehouseRegionId: "europe-west1",
      growthBookRegion: "eu-west-1",
    });
    expect(mockedRunSnowflakeQuery).not.toHaveBeenCalled();
  });

  it("returns null for BigQuery when the project or dataset is missing", async () => {
    const detected = await detectEventForwarderWarehouseRegion({
      type: "bigquery",
      params: { projectId: "analytics" },
      location: "  ",
    });

    expect(detected).toBeNull();
    expect(mockedCreateBigQueryClient).not.toHaveBeenCalled();
  });

  it("reads a Snowflake region from CURRENT_REGION()", async () => {
    mockedRunSnowflakeQuery.mockResolvedValue({
      rows: [{ region: "AWS_US_WEST_2" }],
    } as never);

    const detected = await detectEventForwarderWarehouseRegion({
      type: "snowflake",
      params: { account: "xy12345.us-west-2" },
      location: "EVENTS",
    });

    expect(mockedRunSnowflakeQuery).toHaveBeenCalledWith(
      { account: "xy12345.us-west-2" },
      "SELECT CURRENT_REGION() AS region",
      undefined,
      { queryType: "informationSchema" },
    );
    expect(detected).toEqual({
      warehouseRegionId: "us-west-2",
      growthBookRegion: "us-east-1",
    });
  });

  it("returns null when Snowflake's region is not a known warehouse region", async () => {
    mockedRunSnowflakeQuery.mockResolvedValue({
      rows: [{ region: "AWS_NOT_A_PLACE" }],
    } as never);

    const detected = await detectEventForwarderWarehouseRegion({
      type: "snowflake",
      params: { account: "xy12345" },
      location: "EVENTS",
    });

    expect(detected).toBeNull();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("returns null when the warehouse lookup fails", async () => {
    mockedRunSnowflakeQuery.mockRejectedValue(new Error("network down"));

    const detected = await detectEventForwarderWarehouseRegion({
      type: "snowflake",
      params: { account: "xy12345" },
      location: "EVENTS",
    });

    expect(detected).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      { type: "snowflake", message: "network down" },
      "Could not detect event forwarder warehouse region",
    );
  });
});
