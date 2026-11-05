import {
  buildSnowflakeEventForwarderColumnCheckSql,
  buildSnowflakeEventForwarderCreateTableSql,
} from "back-end/src/services/eventForwarder/snowflake";

// The query runner drags in SqlIntegration and its import cycle; only the DDL is under test.
jest.mock("back-end/src/services/snowflake", () => ({
  runSnowflakeQuery: jest.fn(),
}));

describe("buildSnowflakeEventForwarderCreateTableSql", () => {
  it("emits the contract DDL with VARIANT and TIMESTAMP_NTZ columns", () => {
    expect(buildSnowflakeEventForwarderCreateTableSql("DB.PUBLIC.GB_EVENTS"))
      .toBe(`CREATE TABLE IF NOT EXISTS DB.PUBLIC.GB_EVENTS (
  event_name STRING NOT NULL,
  event_uuid STRING,
  timestamp TIMESTAMP_NTZ,
  received_at TIMESTAMP_NTZ,
  client_key STRING,
  environment STRING,
  sdk_language STRING,
  sdk_version STRING,
  ip STRING,
  geo_country STRING,
  geo_city STRING,
  geo_lat DOUBLE,
  geo_lon DOUBLE,
  experiment_id STRING,
  variation_id STRING,
  feature_key STRING,
  properties VARIANT,
  attributes VARIANT
)`);
  });
});

describe("buildSnowflakeEventForwarderColumnCheckSql", () => {
  it("selects every contract column so a mismatched existing table fails", () => {
    expect(
      buildSnowflakeEventForwarderColumnCheckSql("DB.PUBLIC.GB_EVENTS"),
    ).toBe(
      "SELECT event_name, event_uuid, timestamp, received_at, client_key, environment, sdk_language, sdk_version, ip, geo_country, geo_city, geo_lat, geo_lon, experiment_id, variation_id, feature_key, properties, attributes FROM DB.PUBLIC.GB_EVENTS LIMIT 0",
    );
  });
});
