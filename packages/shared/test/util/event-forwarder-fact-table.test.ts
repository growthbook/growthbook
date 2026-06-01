import {
  buildBigQueryEventForwarderTableReference,
  buildEventForwarderEventsFactTableColumns,
  buildEventForwarderEventsFactTableSql,
  buildSnowflakeEventForwarderTableReference,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  getEventForwarderEventsFactTableId,
  getEventForwarderEventsFactTableName,
  isEventForwarderEventsFactTable,
} from "../../src/util/event-forwarder-fact-table";

describe("event-forwarder-fact-table identity", () => {
  it("derives id from datasource id and display name from datasource name", () => {
    expect(getEventForwarderEventsFactTableId("ds_abc123")).toBe(
      "ds_abc123_events",
    );
    expect(getEventForwarderEventsFactTableName("Production Analytics")).toBe(
      "Production Analytics Events",
    );
  });

  it("matches event forwarder fact tables by datasource id", () => {
    expect(
      isEventForwarderEventsFactTable(
        {
          id: "ds_abc123_events",
          managedBy: "api",
        },
        "ds_abc123",
      ),
    ).toBe(true);

    expect(
      isEventForwarderEventsFactTable(
        {
          id: "production_analytics_events",
          managedBy: "api",
        },
        "ds_abc123",
      ),
    ).toBe(false);

    expect(
      isEventForwarderEventsFactTable(
        {
          id: "ds_abc123_events",
          managedBy: "",
        },
        "ds_abc123",
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
  it("includes hash user id types as jsonFields on the attributes column", () => {
    const columns = buildEventForwarderEventsFactTableColumns(["user_id"]);

    expect(columns).toEqual([
      {
        column: "attributes",
        name: "attributes",
        description: "",
        numberFormat: "",
        datatype: "json",
        jsonFields: {
          user_id: { datatype: "string" },
        },
      },
    ]);
  });

  it("deduplicates user id types case-insensitively", () => {
    const columns = buildEventForwarderEventsFactTableColumns([
      "user_id",
      "User_ID",
    ]);

    expect(columns).toHaveLength(1);
    expect(columns[0].jsonFields).toEqual({
      user_id: { datatype: "string" },
    });
  });

  it("uses sanitized Avro field names in jsonFields", () => {
    const columns = buildEventForwarderEventsFactTableColumns(["user-id"]);

    expect(columns[0].jsonFields).toEqual({
      user_id: { datatype: "string" },
    });
  });
});
