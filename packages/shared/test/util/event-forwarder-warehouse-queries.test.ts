import type { ExposureQuery } from "shared/types/datasource";
import {
  buildEventForwarderAttributeValueSql,
  buildEventForwarderExperimentViewedTableReference,
  buildEventForwarderExposureQuerySql,
  buildEventForwarderFeatureUsageQuery,
  buildEventForwarderFeatureUsageQuerySql,
  buildEventForwarderFeatureUsageTableReference,
  EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
  EVENT_FORWARDER_MANAGED_FEATURE_USAGE_QUERY_DESCRIPTION,
  eventForwarderManagedExposureQueryExistsForUserIdType,
  eventForwarderManagedFeatureUsageQueryExists,
  generateEventForwarderExposureQueries,
  getActiveFeatureUsageQuery,
  isEventForwarderManagedExposureQuery,
  isEventForwarderManagedFeatureUsageQuery,
  mergeEventForwarderExposureQueries,
  reconcileEventForwarderManagedExposureQueries,
  refreshEventForwarderManagedExposureQuery,
} from "../../src/util/event-forwarder-warehouse-queries";
import { EVENT_FORWARDER_AVRO_PARTITION_FIELD } from "../../src/util/event-forwarder-fact-table";

describe("event-forwarder-warehouse-queries experiment_viewed table reference", () => {
  it("builds BigQuery experiment_viewed table reference", () => {
    expect(
      buildEventForwarderExperimentViewedTableReference({
        sinkType: "bigquery",
        projectId: "my-project",
        dataset: "analytics_123",
        tablePrefix: "gb",
      }),
    ).toBe(`\`my-project\`.\`analytics_123\`.\`gb_experiment_viewed\``);
  });

  it("builds Snowflake experiment_viewed table reference", () => {
    expect(
      buildEventForwarderExperimentViewedTableReference({
        sinkType: "snowflake",
        database: "MY_DB",
        schema: "PUBLIC",
        tablePrefix: "GB",
      }),
    ).toBe("MY_DB.PUBLIC.GB_EXPERIMENT_VIEWED");
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

  it("uses typed casts when attributeDatatype is provided", () => {
    expect(
      buildEventForwarderAttributeValueSql({
        sinkType: "bigquery",
        userIdType: "age",
        attributeDatatype: "number",
      }),
    ).toBe("SAFE_CAST(JSON_VALUE(`attributes`, '$.\"age\"') AS FLOAT64)");
  });

  it("resolves enriched attribute keys for exposure hash lookups", () => {
    expect(
      buildEventForwarderAttributeValueSql({
        sinkType: "bigquery",
        userIdType: "utmSource",
        attributeDatatype: "string",
      }),
    ).toBe("JSON_VALUE(`attributes`, '$.\"utm_source\"')");

    expect(
      buildEventForwarderAttributeValueSql({
        sinkType: "snowflake",
        userIdType: "browser",
        attributeDatatype: "string",
      }),
    ).toBe(
      'COALESCE(ATTRIBUTES:"ua_browser"::STRING, ATTRIBUTES:"browser"::STRING)',
    );
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
  it("creates one exposure query per managed identifier id", () => {
    // Callers pass the prefixed managed identifier ids; id/userIdType/name mirror
    // them, while the SQL extracts the real source attribute.
    const queries = generateEventForwarderExposureQueries(
      ["ef_user_id", "ef_anonymous_id"],
      {
        sinkType: "bigquery",
        projectId: "proj",
        dataset: "ds",
        tablePrefix: "gb",
      },
    );

    expect(queries).toHaveLength(2);
    expect(queries[0].id).toBe("ef_user_id");
    expect(queries[0].userIdType).toBe("ef_user_id");
    expect(queries[0].name).toBe("ef_user_id");
    expect(queries[1].id).toBe("ef_anonymous_id");
    expect(queries[1].userIdType).toBe("ef_anonymous_id");
    // Alias is the managed id; extraction reads the real attribute.
    expect(queries[0].query).toContain("AS `ef_user_id`");
    expect(queries[0].query).toContain('$."user_id"');
    expect(queries[0].description).toBe(
      EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
    );
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
      tablePrefix: "GB",
    });

    const merged = mergeEventForwarderExposureQueries(
      existing,
      ["user_id", "device_id"],
      {
        sinkType: "snowflake",
        database: "DB",
        schema: "PUBLIC",
        tablePrefix: "GB",
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
      tablePrefix: "GB",
    });

    expect(
      eventForwarderManagedExposureQueryExistsForUserIdType(
        existing,
        "user_id",
      ),
    ).toBe(true);

    const merged = mergeEventForwarderExposureQueries(existing, ["user_id"], {
      sinkType: "snowflake",
      database: "DB",
      schema: "PUBLIC",
      tablePrefix: "GB",
    });

    expect(merged).toHaveLength(1);
  });

  it("adds a managed query alongside a user's own query for the same identifier", () => {
    const existing: ExposureQuery[] = [
      {
        id: "user_id",
        name: "My custom query",
        userIdType: "user_id",
        dimensions: [],
        query: "SELECT custom",
      },
    ];

    const merged = mergeEventForwarderExposureQueries(
      existing,
      ["ef_user_id"],
      {
        sinkType: "snowflake",
        database: "DB",
        schema: "PUBLIC",
        tablePrefix: "GB",
      },
    );

    expect(merged).toHaveLength(2);
    // The user's own query is preserved untouched...
    expect(merged[0]).toEqual(existing[0]);
    // ...and the managed query is added with the prefixed id so it doesn't collide.
    expect(merged[1].id).toBe("ef_user_id");
    expect(merged[1].userIdType).toBe("ef_user_id");
    expect(merged[1].managedBy).toBe("api");
  });
});

describe("refreshEventForwarderManagedExposureQuery", () => {
  it("renames managed exposure query and regenerates typed SQL", () => {
    const existing = generateEventForwarderExposureQueries(["ef_user_id"], {
      sinkType: "bigquery",
      projectId: "proj",
      dataset: "ds",
      tablePrefix: "gb",
    });

    const refreshed = refreshEventForwarderManagedExposureQuery(
      existing,
      "ef_user_id",
      {
        property: "account_id",
        datatype: "number",
        hashAttribute: true,
      },
      {
        sinkType: "bigquery",
        projectId: "proj",
        dataset: "ds",
        tablePrefix: "gb",
      },
    );

    expect(refreshed[0].id).toBe("ef_account_id");
    expect(refreshed[0].userIdType).toBe("ef_account_id");
    expect(refreshed[0].name).toBe("ef_account_id");
    // Alias is the managed id; extraction reads the real account_id attribute.
    expect(refreshed[0].query).toContain("AS `ef_account_id`");
    expect(refreshed[0].query).toContain('$."account_id"');
    expect(refreshed[0].query).toContain("AS FLOAT64");
  });
});

describe("reconcileEventForwarderManagedExposureQueries", () => {
  it("rebuilds managed queries from desired hash attributes", () => {
    const existing = [
      ...generateEventForwarderExposureQueries(["ef_user_id", "ef_legacy_id"], {
        sinkType: "bigquery",
        projectId: "proj",
        dataset: "ds",
        tablePrefix: "gb",
      }),
      {
        id: "custom_query",
        userIdType: "custom_id",
        name: "Custom",
        dimensions: [],
        query: "SELECT custom_id FROM custom_table",
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      userIdTypes: ["ef_account_id", "ef_device_id"],
      params: {
        sinkType: "bigquery",
        projectId: "proj",
        dataset: "ds",
        tablePrefix: "gb",
      },
      attributeSchema: [
        {
          property: "account_id",
          datatype: "number",
          hashAttribute: true,
        },
        {
          property: "device_id",
          datatype: "string",
          hashAttribute: true,
        },
      ],
    });

    expect(reconciled).toHaveLength(3);
    expect(reconciled[0].id).toBe("custom_query");
    expect(reconciled.map((query) => query.userIdType)).toEqual([
      "custom_id",
      "ef_account_id",
      "ef_device_id",
    ]);
    expect(reconciled[1].managedBy).toBe("api");
    // account_id is a number attribute, resolved by stripping the ef_ prefix.
    expect(reconciled[1].query).toContain("AS FLOAT64");
    expect(
      reconciled.some((query) => query.userIdType === "ef_legacy_id"),
    ).toBe(false);
  });

  it("preserves queries without the managed marker", () => {
    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing: [
        {
          id: "stored_managed",
          userIdType: "legacy_id",
          name: "legacy_id",
          dimensions: [],
          query: "SELECT legacy_id",
        },
        {
          id: "custom_query",
          userIdType: "custom_id",
          name: "Custom",
          dimensions: [],
          query: "SELECT custom_id",
        },
      ],
      userIdTypes: [],
      params: {
        sinkType: "snowflake",
        database: "DB",
        schema: "PUBLIC",
        tablePrefix: "GB",
      },
    });

    expect(reconciled).toEqual([
      {
        id: "stored_managed",
        userIdType: "legacy_id",
        name: "legacy_id",
        dimensions: [],
        query: "SELECT legacy_id",
      },
      {
        id: "custom_query",
        userIdType: "custom_id",
        name: "Custom",
        dimensions: [],
        query: "SELECT custom_id",
      },
    ]);
  });
});

describe("event-forwarder-warehouse-queries feature_usage table reference", () => {
  it("builds BigQuery feature_usage table reference", () => {
    expect(
      buildEventForwarderFeatureUsageTableReference({
        sinkType: "bigquery",
        projectId: "my-project",
        dataset: "analytics_123",
        tablePrefix: "gb",
      }),
    ).toBe(`\`my-project\`.\`analytics_123\`.\`gb_feature_usage\``);
  });

  it("builds Snowflake feature_usage table reference", () => {
    expect(
      buildEventForwarderFeatureUsageTableReference({
        sinkType: "snowflake",
        database: "MY_DB",
        schema: "PUBLIC",
        tablePrefix: "GB",
      }),
    ).toBe("MY_DB.PUBLIC.GB_FEATURE_USAGE");
  });
});

describe("buildEventForwarderFeatureUsageQuerySql", () => {
  const tableRef = "`proj`.`ds`.`feature_usage`";

  it("includes received_at partition filter for BigQuery only", () => {
    const sql = buildEventForwarderFeatureUsageQuerySql({
      sinkType: "bigquery",
      tableRef,
    });

    expect(sql).toContain("timestamp AS timestamp");
    expect(sql).toContain("feature_key AS feature_key");
    expect(sql).toContain(`FROM ${tableRef}`);
    expect(sql).toContain(
      `WHERE ${EVENT_FORWARDER_AVRO_PARTITION_FIELD} BETWEEN '{{startDate}}' AND '{{endDate}}'`,
    );
  });

  it("has no WHERE clause for Snowflake and uppercases source columns", () => {
    const sql = buildEventForwarderFeatureUsageQuerySql({
      sinkType: "snowflake",
      tableRef: "MY_DB.PUBLIC.FEATURE_USAGE",
    });

    expect(sql).toContain("TIMESTAMP AS timestamp");
    expect(sql).toContain("FEATURE_KEY AS feature_key");
    expect(sql).toContain("FROM MY_DB.PUBLIC.FEATURE_USAGE");
    expect(sql).not.toContain("WHERE");
  });
});

describe("buildEventForwarderFeatureUsageQuery", () => {
  it("creates a managed feature usage query", () => {
    const query = buildEventForwarderFeatureUsageQuery({
      sinkType: "bigquery",
      projectId: "proj",
      dataset: "ds",
      tablePrefix: "gb",
    });

    expect(query.managedBy).toBe("api");
    expect(query.description).toBe(
      EVENT_FORWARDER_MANAGED_FEATURE_USAGE_QUERY_DESCRIPTION,
    );
    expect(query.query).toContain("feature_usage");
    expect(isEventForwarderManagedFeatureUsageQuery(query as never)).toBe(true);
  });
});

describe("getActiveFeatureUsageQuery", () => {
  it("prefers managed queries when multiple exist", () => {
    const active = getActiveFeatureUsageQuery([
      { id: "manual", query: "SELECT 1", managedBy: "" },
      { id: "managed", query: "SELECT 2", managedBy: "api" },
    ]);

    expect(active?.id).toBe("managed");
  });

  it("falls back to the first query when none are managed", () => {
    const active = getActiveFeatureUsageQuery([
      { id: "manual", query: "SELECT 1" },
    ]);

    expect(active?.id).toBe("manual");
  });
});

describe("eventForwarderManagedFeatureUsageQueryExists", () => {
  it("returns true when a managed query exists", () => {
    expect(
      eventForwarderManagedFeatureUsageQueryExists([
        { id: "manual", query: "SELECT 1" },
        { id: "managed", query: "SELECT 2", managedBy: "api" },
      ]),
    ).toBe(true);
  });
});
