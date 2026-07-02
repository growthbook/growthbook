import {
  normalizeBigQueryLocationToCloudRegion,
  normalizeSnowflakeCurrentRegion,
  parseSnowflakeCloudRegionFromUrl,
} from "../../src/util/event-forwarder-cluster";

describe("parseSnowflakeCloudRegionFromUrl", () => {
  it("parses legacy locator hosts with an explicit cloud token", () => {
    expect(
      parseSnowflakeCloudRegionFromUrl(
        "https://xy12345.us-east-2.aws.snowflakecomputing.com",
      ),
    ).toEqual({ cloud: "aws", region: "us-east-2" });

    expect(
      parseSnowflakeCloudRegionFromUrl(
        "xy12345.us-central1.gcp.snowflakecomputing.com",
      ),
    ).toEqual({ cloud: "gcp", region: "us-central1" });

    expect(
      parseSnowflakeCloudRegionFromUrl(
        "https://xy12345.west-us-2.azure.snowflakecomputing.com",
      ),
    ).toEqual({ cloud: "azure", region: "westus2" });
  });

  it("returns null for modern org-style hosts without a cloud token", () => {
    expect(
      parseSnowflakeCloudRegionFromUrl(
        "https://myorg-myacct.snowflakecomputing.com",
      ),
    ).toBeNull();
  });

  it("returns null for non-snowflake or empty hosts", () => {
    expect(parseSnowflakeCloudRegionFromUrl("")).toBeNull();
    expect(parseSnowflakeCloudRegionFromUrl(undefined)).toBeNull();
    expect(parseSnowflakeCloudRegionFromUrl("https://example.com")).toBeNull();
  });
});

describe("normalizeSnowflakeCurrentRegion", () => {
  it("normalizes AWS/GCP region identifiers", () => {
    expect(normalizeSnowflakeCurrentRegion("AWS_US_EAST_1")).toEqual({
      cloud: "aws",
      region: "us-east-1",
    });
    expect(normalizeSnowflakeCurrentRegion("GCP_EUROPE_WEST4")).toEqual({
      cloud: "gcp",
      region: "europe-west4",
    });
  });

  it("normalizes Azure identifiers without separators", () => {
    expect(normalizeSnowflakeCurrentRegion("AZURE_WESTUS2")).toEqual({
      cloud: "azure",
      region: "westus2",
    });
  });

  it("strips a region-group prefix", () => {
    expect(normalizeSnowflakeCurrentRegion("PUBLIC.AWS_US_EAST_1")).toEqual({
      cloud: "aws",
      region: "us-east-1",
    });
  });

  it("returns null for unknown or empty input", () => {
    expect(normalizeSnowflakeCurrentRegion("")).toBeNull();
    expect(normalizeSnowflakeCurrentRegion(undefined)).toBeNull();
    expect(normalizeSnowflakeCurrentRegion("ORACLE_US_ASHBURN_1")).toBeNull();
  });
});

describe("normalizeBigQueryLocationToCloudRegion", () => {
  it("maps a regional location to gcp + region", () => {
    expect(normalizeBigQueryLocationToCloudRegion("us-central1")).toEqual({
      cloud: "gcp",
      region: "us-central1",
    });
    expect(normalizeBigQueryLocationToCloudRegion("europe-west4")).toEqual({
      cloud: "gcp",
      region: "europe-west4",
    });
  });

  it("returns null for multi-region locations (no single Confluent region)", () => {
    expect(normalizeBigQueryLocationToCloudRegion("US")).toBeNull();
    expect(normalizeBigQueryLocationToCloudRegion("EU")).toBeNull();
    expect(
      normalizeBigQueryLocationToCloudRegion("US-MULTI-REGION"),
    ).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(normalizeBigQueryLocationToCloudRegion("")).toBeNull();
    expect(normalizeBigQueryLocationToCloudRegion(undefined)).toBeNull();
  });
});
