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

    expect(sql).toContain("SELECT\n  timestamp,\n  event_name");
    expect(sql).toContain("`my-project`.`analytics_123`.`gb_events`");
    expect(sql).toContain(
      `${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`,
    );
  });

  it("projects selected BigQuery attributes from the JSON attributes column", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "bigquery",
      projectId: "my-project",
      dataset: "analytics_123",
      tableName: "gb_events",
      datasourceProjects: ["proj_1"],
      attributeSchema: [
        { property: "user_id", datatype: "string" },
        { property: "browser-type", datatype: "string" },
        { property: "archived", datatype: "string", archived: true },
        { property: "other_project", datatype: "string", projects: ["proj_2"] },
      ],
    });

    expect(sql).toBe(`SELECT
  timestamp,
  event_name,
  -- Attributes
  JSON_VALUE(\`attributes\`, '$."user_id"') AS user_id,
  JSON_VALUE(\`attributes\`, '$."browser_type"') AS browser_type
FROM \`my-project\`.\`analytics_123\`.\`gb_events\`
WHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`);
  });

  it("casts typed BigQuery attributes with SAFE_CAST or JSON_QUERY", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "bigquery",
      projectId: "my-project",
      dataset: "analytics_123",
      tableName: "gb_events",
      attributeSchema: [
        { property: "age", datatype: "number" },
        { property: "is_active", datatype: "boolean" },
        { property: "tags", datatype: "string[]" },
        { property: "scores", datatype: "number[]" },
        { property: "secrets", datatype: "secureString[]" },
      ],
    });

    expect(sql).toContain(
      `SAFE_CAST(JSON_VALUE(\`attributes\`, '$."age"') AS FLOAT64) AS age`,
    );
    expect(sql).toContain(
      `SAFE_CAST(JSON_VALUE(\`attributes\`, '$."is_active"') AS BOOL) AS is_active`,
    );
    expect(sql).toContain(`JSON_QUERY(\`attributes\`, '$."tags"') AS tags`);
    expect(sql).toContain(`JSON_QUERY(\`attributes\`, '$."scores"') AS scores`);
    expect(sql).toContain(
      `JSON_QUERY(\`attributes\`, '$."secrets"') AS secrets`,
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

  it("projects selected Snowflake attributes from the VARIANT attributes column", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "snowflake",
      database: "MY_DB",
      schema: "PUBLIC",
      tableName: "GB_EVENTS",
      attributeSchema: [
        { property: "user_id", datatype: "string" },
        { property: "browser", datatype: "string" },
      ],
    });

    expect(sql).toBe(`SELECT
  TIMESTAMP AS timestamp,
  EVENT_NAME AS event_name,
  -- Attributes
  ATTRIBUTES:"user_id" AS user_id,
  ATTRIBUTES:"browser" AS browser
FROM MY_DB.PUBLIC.GB_EVENTS`);
  });

  it("casts typed Snowflake attributes from flat string map values", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "snowflake",
      database: "MY_DB",
      schema: "PUBLIC",
      tableName: "GB_EVENTS",
      attributeSchema: [
        { property: "age", datatype: "number" },
        { property: "is_active", datatype: "boolean" },
        { property: "tags", datatype: "string[]" },
        { property: "scores", datatype: "number[]" },
        { property: "secrets", datatype: "secureString[]" },
      ],
    });

    expect(sql).toContain('TRY_TO_DOUBLE(ATTRIBUTES:"age") AS age');
    expect(sql).toContain(
      'TRY_TO_BOOLEAN(ATTRIBUTES:"is_active") AS is_active',
    );
    expect(sql).toContain('TRY_PARSE_JSON(ATTRIBUTES:"tags") AS tags');
    expect(sql).toContain('TRY_PARSE_JSON(ATTRIBUTES:"scores") AS scores');
    expect(sql).toContain('TRY_PARSE_JSON(ATTRIBUTES:"secrets") AS secrets');
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

  it("includes attribute schema fields as nested jsonFields", () => {
    const columns = buildEventForwarderEventsFactTableColumns(
      ["user_id"],
      [
        { property: "user_id", datatype: "string" },
        { property: "age", datatype: "number" },
        { property: "employee_id", datatype: "number", hashAttribute: true },
        { property: "is_employee", datatype: "boolean" },
        { property: "tags", datatype: "string[]" },
        { property: "archived", datatype: "string", archived: true },
        { property: "other_project", datatype: "string", projects: ["proj_2"] },
      ],
      ["proj_1"],
    );

    expect(columns[0].jsonFields).toEqual({
      user_id: { datatype: "string" },
      age: { datatype: "number" },
      employee_id: { datatype: "string" },
      is_employee: { datatype: "boolean" },
      tags: { datatype: "json" },
    });
  });
});
