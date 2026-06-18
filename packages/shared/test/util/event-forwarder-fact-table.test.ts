import {
  buildBigQueryEventForwarderTableReference,
  buildEventForwarderEventsFactTableColumns,
  buildEventForwarderEventsFactTableSql,
  buildSnowflakeEventForwarderTableReference,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
  getEventForwarderEventsFactTableId,
  getEventForwarderEventsFactTableName,
  isEventForwarderEventsFactTable,
  resolveEventForwarderAttributeLookupKeys,
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
      tablePrefix: "gb",
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
      tablePrefix: "gb",
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
      tablePrefix: "gb",
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

  it("projects userIdTypes with string cast when not in attribute schema", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "snowflake",
      database: "MY_DB",
      schema: "PUBLIC",
      tablePrefix: "GB",
      userIdTypes: ["device_id"],
    });

    expect(sql).toContain('ATTRIBUTES:"device_id"::STRING AS device_id');
    expect(sql).toContain("-- Attributes");
  });

  it("uses typed casts for hash attributes that are in the attribute schema", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "snowflake",
      database: "MY_DB",
      schema: "PUBLIC",
      tablePrefix: "GB",
      attributeSchema: [
        { property: "employee_id", datatype: "number", hashAttribute: true },
      ],
    });

    expect(sql).toContain(
      'TRY_TO_DOUBLE(ATTRIBUTES:"employee_id"::STRING) AS employee_id',
    );
    expect(sql).not.toContain(
      'ATTRIBUTES:"employee_id"::STRING AS employee_id',
    );
  });

  it("uses typed casts for userIdTypes backed by hash attributes", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "bigquery",
      projectId: "my-project",
      dataset: "analytics_123",
      tablePrefix: "gb",
      userIdTypes: ["employee_id"],
      attributeSchema: [
        { property: "employee_id", datatype: "number", hashAttribute: true },
      ],
    });

    expect(sql).toContain(
      `SAFE_CAST(JSON_VALUE(\`attributes\`, '$."employee_id"') AS FLOAT64) AS employee_id`,
    );
    expect(sql).not.toContain(
      `CAST(JSON_VALUE(\`attributes\`, '$."employee_id"') AS STRING)`,
    );
  });

  it("projects a prefixed managed identifier id, extracting its source attribute", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "bigquery",
      projectId: "my-project",
      dataset: "analytics_123",
      tablePrefix: "gb",
      // Managed identifier id is prefixed; the column alias keeps the id while the
      // value is read from the underlying "employee_id" attribute.
      userIdTypes: ["ef_employee_id"],
      attributeSchema: [
        { property: "employee_id", datatype: "number", hashAttribute: true },
      ],
    });

    expect(sql).toContain(
      `SAFE_CAST(JSON_VALUE(\`attributes\`, '$."employee_id"') AS FLOAT64) AS ef_employee_id`,
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
      tablePrefix: "GB",
      attributeSchema: [
        { property: "user_id", datatype: "string" },
        { property: "browser", datatype: "string" },
      ],
    });

    expect(sql).toBe(`SELECT
  TIMESTAMP AS timestamp,
  EVENT_NAME AS event_name,
  -- Attributes
  ATTRIBUTES:"user_id"::STRING AS user_id,
  COALESCE(ATTRIBUTES:"ua_browser"::STRING, ATTRIBUTES:"browser"::STRING) AS browser
FROM MY_DB.PUBLIC.GB_EVENTS`);
  });

  it("maps default auto-attributes to enriched warehouse keys in BigQuery SQL", () => {
    const defaultAutoAttributes = [
      { property: "id", datatype: "string" as const, hashAttribute: true },
      { property: "url", datatype: "string" as const },
      { property: "path", datatype: "string" as const },
      { property: "host", datatype: "string" as const },
      { property: "query", datatype: "string" as const },
      {
        property: "deviceType",
        datatype: "enum" as const,
        enum: "desktop,mobile",
      },
      {
        property: "browser",
        datatype: "enum" as const,
        enum: "chrome,edge,firefox,safari,unknown",
      },
      { property: "utmSource", datatype: "string" as const },
      { property: "utmMedium", datatype: "string" as const },
      { property: "utmCampaign", datatype: "string" as const },
      { property: "utmTerm", datatype: "string" as const },
      { property: "utmContent", datatype: "string" as const },
    ];

    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "bigquery",
      projectId: "my-project",
      dataset: "analytics_123",
      tablePrefix: "gb",
      attributeSchema: defaultAutoAttributes,
    });

    expect(sql).toContain(
      `JSON_VALUE(\`attributes\`, '$."utm_source"') AS utmSource`,
    );
    expect(sql).toContain(
      `COALESCE(JSON_VALUE(\`attributes\`, '$."ua_browser"'), JSON_VALUE(\`attributes\`, '$."browser"')) AS browser`,
    );
    expect(sql).toContain(
      `COALESCE(JSON_VALUE(\`attributes\`, '$."url_path"'), JSON_VALUE(\`attributes\`, '$."path"')) AS path`,
    );
    expect(sql).toContain(
      `COALESCE(JSON_VALUE(\`attributes\`, '$."ua_device_type"'), JSON_VALUE(\`attributes\`, '$."deviceType"')) AS deviceType`,
    );
    expect(sql).toContain(`JSON_VALUE(\`attributes\`, '$."id"') AS id`);
    expect(sql).toContain(`JSON_VALUE(\`attributes\`, '$."url"') AS url`);
  });

  it("casts typed Snowflake attributes from flat string map values", () => {
    const sql = buildEventForwarderEventsFactTableSql({
      sinkType: "snowflake",
      database: "MY_DB",
      schema: "PUBLIC",
      tablePrefix: "GB",
      attributeSchema: [
        { property: "age", datatype: "number" },
        { property: "is_active", datatype: "boolean" },
        { property: "tags", datatype: "string[]" },
        { property: "scores", datatype: "number[]" },
        { property: "secrets", datatype: "secureString[]" },
      ],
    });

    expect(sql).toContain('TRY_TO_DOUBLE(ATTRIBUTES:"age"::STRING) AS age');
    expect(sql).toContain(
      'TRY_TO_BOOLEAN(ATTRIBUTES:"is_active"::STRING) AS is_active',
    );
    expect(sql).toContain('TRY_PARSE_JSON(ATTRIBUTES:"tags"::STRING) AS tags');
    expect(sql).toContain(
      'TRY_PARSE_JSON(ATTRIBUTES:"scores"::STRING) AS scores',
    );
    expect(sql).toContain(
      'TRY_PARSE_JSON(ATTRIBUTES:"secrets"::STRING) AS secrets',
    );
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
      employee_id: { datatype: "number" },
      is_employee: { datatype: "boolean" },
      tags: { datatype: "json" },
    });
  });
});

describe("resolveEventForwarderAttributeLookupKeys", () => {
  it("maps promoted UTM attributes to snake_case warehouse keys", () => {
    expect(resolveEventForwarderAttributeLookupKeys("utmSource")).toEqual([
      "utm_source",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("utmMedium")).toEqual([
      "utm_medium",
    ]);
  });

  it("prefers enriched keys with SDK fallbacks for browser and URL fields", () => {
    expect(resolveEventForwarderAttributeLookupKeys("browser")).toEqual([
      "ua_browser",
      "browser",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("path")).toEqual([
      "url_path",
      "path",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("query")).toEqual([
      "url_query",
      "query",
    ]);
  });

  it("is case-insensitive for known mappings", () => {
    expect(resolveEventForwarderAttributeLookupKeys("UTMSource")).toEqual([
      "utm_source",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("Browser")).toEqual([
      "ua_browser",
      "browser",
    ]);
  });

  it("sanitizes custom attribute properties", () => {
    expect(resolveEventForwarderAttributeLookupKeys("logged-in")).toEqual([
      "logged_in",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("company")).toEqual([
      "company",
    ]);
  });
});
