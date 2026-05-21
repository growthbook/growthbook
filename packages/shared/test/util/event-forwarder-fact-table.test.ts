import {
  buildBigQueryEventForwarderTableReference,
  buildEventForwarderEventsFactTableColumns,
  buildEventForwarderEventsFactTableSql,
  buildSnowflakeEventForwarderTableReference,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  getEventForwarderEventsFactTableId,
  getEventForwarderEventsFactTableIdWithCollisionSuffix,
  getEventForwarderEventsFactTableName,
  isEventForwarderEventsFactTableCandidate,
  sanitizeDatasourceNameForFactTableId,
} from "../../src/util/event-forwarder-fact-table";

describe("event-forwarder-fact-table identity", () => {
  it("sanitizes datasource names for fact table ids", () => {
    expect(sanitizeDatasourceNameForFactTableId("Production Analytics")).toBe(
      "production_analytics",
    );
    expect(sanitizeDatasourceNameForFactTableId("  ")).toBe("datasource");
    expect(sanitizeDatasourceNameForFactTableId("123-abc")).toBe("_123-abc");
  });

  it("derives id and display name from datasource name", () => {
    expect(getEventForwarderEventsFactTableId("Production Analytics")).toBe(
      "production_analytics_events",
    );
    expect(getEventForwarderEventsFactTableName("Production Analytics")).toBe(
      "Production Analytics Events",
    );
  });

  it("appends collision suffix from datasource id", () => {
    expect(
      getEventForwarderEventsFactTableIdWithCollisionSuffix(
        "Analytics",
        "ds_abc123xyz",
      ),
    ).toBe("analytics_123xyz_events");
  });

  it("matches event forwarder fact table candidates", () => {
    expect(
      isEventForwarderEventsFactTableCandidate(
        {
          id: "production_analytics_events",
          name: "Production Analytics Events",
          managedBy: "api",
        },
        "Production Analytics",
      ),
    ).toBe(true);

    expect(
      isEventForwarderEventsFactTableCandidate(
        {
          id: "production_analytics_a1b2c3_events",
          name: "Old Name Events",
          managedBy: "api",
        },
        "Production Analytics",
      ),
    ).toBe(true);

    expect(
      isEventForwarderEventsFactTableCandidate(
        {
          id: "other_events",
          name: "Other Events",
          managedBy: "",
        },
        "Production Analytics",
      ),
    ).toBe(false);
  });
});

describe("event-forwarder-fact-table SQL", () => {
  it("builds BigQuery table reference", () => {
    expect(
      buildBigQueryEventForwarderTableReference(
        "my-project",
        "analytics_123",
        "gb_events",
      ),
    ).toBe("`my-project`.`analytics_123`.`gb_events`");
  });

  it("builds BigQuery fact table SQL with received_at partition filter", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "bigquery",
      projectId: "my-project",
      dataset: "analytics_123",
      tableName: "gb_events",
    });

    expect(sql).toContain("SELECT *");
    expect(sql).toContain("`my-project`.`analytics_123`.`gb_events`");
    expect(sql).toContain(
      `${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`,
    );
  });

  it("builds Snowflake table reference", () => {
    expect(
      buildSnowflakeEventForwarderTableReference(
        "MY_DB",
        "PUBLIC",
        "GB_EVENTS",
      ),
    ).toBe("MY_DB.PUBLIC.GB_EVENTS");
  });

  it("builds Snowflake fact table SQL with select all", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "snowflake",
      database: "MY_DB",
      schema: "PUBLIC",
      tableName: "GB_EVENTS",
    });

    expect(sql).toBe("SELECT *\nFROM MY_DB.PUBLIC.GB_EVENTS");
  });
});

describe("buildEventForwarderEventsFactTableColumns", () => {
  it("includes user id types, default avro fields, and hash attributes", () => {
    const columns = buildEventForwarderEventsFactTableColumns(
      ["user_id"],
      [
        {
          property: "device_id",
          datatype: "string",
          hashAttribute: true,
        },
        {
          property: "event_name",
          datatype: "string",
          hashAttribute: true,
        },
      ],
    );

    const columnNames = columns.map((c) => c.column);
    expect(columnNames).toContain("user_id");
    expect(columnNames).toContain("device_id");
    expect(columnNames).toContain("event_name");
    expect(columnNames).toContain("received_at");
    expect(columnNames).toContain("properties");

    const eventNameCol = columns.find((c) => c.column === "event_name");
    expect(eventNameCol?.alwaysInlineFilter).toBe(true);
  });
});
