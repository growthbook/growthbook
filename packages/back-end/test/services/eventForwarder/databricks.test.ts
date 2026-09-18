import { buildDatabricksEventForwarderCreateTableSql } from "back-end/src/services/eventForwarder/databricks";

describe("buildDatabricksEventForwarderCreateTableSql", () => {
  it("emits the contract DDL with VARIANT columns clustered on received_at", () => {
    const sql = buildDatabricksEventForwarderCreateTableSql(
      "`main`.`analytics`.`gb_events`",
    );
    expect(sql)
      .toBe(`CREATE TABLE IF NOT EXISTS \`main\`.\`analytics\`.\`gb_events\` (
  event_name STRING NOT NULL,
  event_uuid STRING,
  timestamp TIMESTAMP,
  received_at TIMESTAMP,
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
) USING DELTA CLUSTER BY (received_at)`);
  });
});
