import {
  resolveDetectedEventForwarderRegion,
  warehouseRegionIdFromBigQueryLocation,
  warehouseRegionIdFromDatabricksZerobusEndpoint,
  warehouseRegionIdFromSnowflakeCurrentRegion,
} from "../../src/util/event-forwarder-region-inference";

describe("event forwarder region inference", () => {
  it("normalizes Snowflake CURRENT_REGION() values onto catalog ids", () => {
    expect(warehouseRegionIdFromSnowflakeCurrentRegion("AWS_US_WEST_2")).toBe(
      "us-west-2",
    );
    expect(
      warehouseRegionIdFromSnowflakeCurrentRegion("AWS_AP_NORTHEAST_1"),
    ).toBe("ap-northeast-1");
    expect(
      warehouseRegionIdFromSnowflakeCurrentRegion("AZURE_WESTEUROPE"),
    ).toBe("westeurope");
    expect(warehouseRegionIdFromSnowflakeCurrentRegion("AZURE_EASTUS2")).toBe(
      "eastus2",
    );
    expect(warehouseRegionIdFromSnowflakeCurrentRegion("GCP_US_CENTRAL1")).toBe(
      "us-central1",
    );
    expect(
      warehouseRegionIdFromSnowflakeCurrentRegion("GCP_EUROPE_WEST2"),
    ).toBe("europe-west2");
    expect(
      warehouseRegionIdFromSnowflakeCurrentRegion("PUBLIC.AWS_EU_WEST_1"),
    ).toBe("eu-west-1");
    expect(warehouseRegionIdFromSnowflakeCurrentRegion("not-a-region")).toBe(
      null,
    );
  });

  it("reads the region from a Databricks Zerobus host", () => {
    expect(
      warehouseRegionIdFromDatabricksZerobusEndpoint(
        "https://abc123.zerobus.us-east-1.cloud.databricks.com",
      ),
    ).toBe("us-east-1");
    expect(
      warehouseRegionIdFromDatabricksZerobusEndpoint(
        "abc123.zerobus.westeurope.azuredatabricks.net",
      ),
    ).toBe("westeurope");
    expect(
      warehouseRegionIdFromDatabricksZerobusEndpoint(
        "https://abc123.zerobus.us-central1.gcp.databricks.com/path",
      ),
    ).toBe("us-central1");
    expect(
      warehouseRegionIdFromDatabricksZerobusEndpoint(
        "https://dbc-abc.cloud.databricks.com",
      ),
    ).toBe(null);
    expect(
      warehouseRegionIdFromDatabricksZerobusEndpoint(
        "abc.zerobus.<region>.cloud.databricks.com",
      ),
    ).toBe(null);
  });

  it("keeps BigQuery multi-region locations uppercase", () => {
    expect(warehouseRegionIdFromBigQueryLocation("US")).toBe("US");
    expect(warehouseRegionIdFromBigQueryLocation("eu")).toBe("EU");
    expect(warehouseRegionIdFromBigQueryLocation("us-west1")).toBe("us-west1");
    expect(warehouseRegionIdFromBigQueryLocation("")).toBe(null);
  });

  it("maps a known warehouse region and drops an unknown one", () => {
    expect(
      resolveDetectedEventForwarderRegion("snowflake", "us-west-2"),
    ).toEqual({
      warehouseRegionId: "us-west-2",
      growthBookRegion: "us-east-1",
    });
    expect(
      resolveDetectedEventForwarderRegion("bigquery", "europe-west1"),
    ).toEqual({
      warehouseRegionId: "europe-west1",
      growthBookRegion: "eu-west-1",
    });
    expect(resolveDetectedEventForwarderRegion("snowflake", "us-west-1")).toBe(
      null,
    );
    expect(resolveDetectedEventForwarderRegion("databricks", null)).toBe(null);
  });
});
