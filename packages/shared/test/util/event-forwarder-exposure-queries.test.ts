import {
  buildEventForwarderAttributeValueSql,
  buildEventForwarderExperimentViewedTableReference,
  buildEventForwarderExposureQuerySql,
  EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE,
  exposureQueryExistsForUserIdType,
  generateEventForwarderExposureQueries,
  isEventForwarderManagedExposureQuery,
  mergeEventForwarderExposureQueries,
} from "../../src/util/event-forwarder-exposure-queries";
import { EVENT_FORWARDER_AVRO_PARTITION_FIELD } from "../../src/util/event-forwarder-fact-table";

describe("event-forwarder-exposure-queries table reference", () => {
  it("builds BigQuery experiment_viewed table reference", () => {
    expect(
      buildEventForwarderExperimentViewedTableReference({
        sinkType: "bigquery",
        projectId: "my-project",
        dataset: "analytics_123",
      }),
    ).toBe(
      `\`my-project\`.\`analytics_123\`.\`${EVENT_FORWARDER_EXPERIMENT_VIEWED_TABLE}\``,
    );
  });

  it("builds Snowflake experiment_viewed table reference", () => {
    expect(
      buildEventForwarderExperimentViewedTableReference({
        sinkType: "snowflake",
        database: "MY_DB",
        schema: "PUBLIC",
      }),
    ).toBe("MY_DB.PUBLIC.EXPERIMENT_VIEWED");
  });
});

describe("buildEventForwarderAttributeValueSql", () => {
  it("reads hash ids from BigQuery JSON attributes", () => {
    expect(
      buildEventForwarderAttributeValueSql({
        sinkType: "bigquery",
        userIdType: "user_id",
      }),
    ).toBe("CAST(JSON_VALUE(`attributes`, '$.\"user_id\"') AS STRING)");
  });

  it("reads hash ids from Snowflake VARIANT attributes with quoted paths", () => {
    expect(
      buildEventForwarderAttributeValueSql({
        sinkType: "snowflake",
        userIdType: "device_id",
      }),
    ).toBe('ATTRIBUTES:"device_id"::STRING');
  });

  it("sanitizes property names to match Avro map keys", () => {
    expect(
      buildEventForwarderAttributeValueSql({
        sinkType: "snowflake",
        userIdType: "user-id",
      }),
    ).toBe('ATTRIBUTES:"user_id"::STRING');
  });
});

describe("buildEventForwarderExposureQuerySql", () => {
  const tableRef = "`proj`.`ds`.`experiment_viewed`";

  it("includes received_at partition filter for BigQuery only", () => {
    const sql = buildEventForwarderExposureQuerySql({
      sinkType: "bigquery",
      tableRef,
      userIdType: "user_id",
    });

    expect(sql).toContain(
      "CAST(JSON_VALUE(`attributes`, '$.\"user_id\"') AS STRING) AS `user_id`",
    );
    expect(sql).toContain("experiment_id AS experiment_id");
    expect(sql).toContain(`FROM ${tableRef}`);
    expect(sql).toContain(
      `WHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`,
    );
    expect(sql).not.toContain("experiment_id LIKE");
    expect(sql).not.toContain("timestamp BETWEEN");
  });

  it("quotes reserved-word identifiers for BigQuery", () => {
    const sql = buildEventForwarderExposureQuerySql({
      sinkType: "bigquery",
      tableRef,
      userIdType: "user",
    });

    expect(sql).toContain(
      "CAST(JSON_VALUE(`attributes`, '$.\"user\"') AS STRING) AS `user`",
    );
  });

  it("has no WHERE clause for Snowflake", () => {
    const sql = buildEventForwarderExposureQuerySql({
      sinkType: "snowflake",
      tableRef: "MY_DB.PUBLIC.EXPERIMENT_VIEWED",
      userIdType: "device_id",
    });

    expect(sql).toContain('ATTRIBUTES:"device_id"::STRING AS device_id');
    expect(sql).toContain("TIMESTAMP AS timestamp");
    expect(sql).toContain("EXPERIMENT_ID AS experiment_id");
    expect(sql).toContain("VARIATION_ID AS variation_id");
    expect(sql).toContain("FROM MY_DB.PUBLIC.EXPERIMENT_VIEWED");
    expect(sql).not.toContain("WHERE");
  });
});

describe("generateEventForwarderExposureQueries", () => {
  it("creates one exposure query per identifier type", () => {
    const queries = generateEventForwarderExposureQueries(
      ["user_id", "anonymous_id"],
      {
        sinkType: "bigquery",
        projectId: "proj",
        dataset: "ds",
      },
    );

    expect(queries).toHaveLength(2);
    expect(queries[0].id).toBe("user_id");
    expect(queries[0].userIdType).toBe("user_id");
    expect(queries[1].userIdType).toBe("anonymous_id");
    expect(queries[0].dimensions).toEqual([]);
    expect(queries[0].managedBy).toBe("api");
    expect(isEventForwarderManagedExposureQuery(queries[0])).toBe(true);
  });
});

describe("mergeEventForwarderExposureQueries", () => {
  it("appends only missing identifier types", () => {
    const existing = generateEventForwarderExposureQueries(["user_id"], {
      sinkType: "snowflake",
      database: "DB",
      schema: "PUBLIC",
    });

    const merged = mergeEventForwarderExposureQueries(
      existing,
      ["user_id", "device_id"],
      {
        sinkType: "snowflake",
        database: "DB",
        schema: "PUBLIC",
      },
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].userIdType).toBe("user_id");
    expect(merged[1].userIdType).toBe("device_id");
  });

  it("is case-insensitive when checking existing queries", () => {
    const existing = generateEventForwarderExposureQueries(["USER_ID"], {
      sinkType: "snowflake",
      database: "DB",
      schema: "PUBLIC",
    });

    expect(exposureQueryExistsForUserIdType(existing, "user_id")).toBe(true);

    const merged = mergeEventForwarderExposureQueries(existing, ["user_id"], {
      sinkType: "snowflake",
      database: "DB",
      schema: "PUBLIC",
    });

    expect(merged).toHaveLength(1);
  });
});
