import type { ExposureQuery, UserIdType } from "shared/types/datasource";
import {
  buildEventForwarderAttributeValueSql,
  buildEventForwarderExperimentViewedTableReference,
  buildEventForwarderExposureQuerySql,
  buildEventForwarderFeatureUsageQuery,
  buildEventForwarderFeatureUsageQuerySql,
  buildEventForwarderFeatureUsageTableReference,
  EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
  EVENT_FORWARDER_MANAGED_FEATURE_USAGE_QUERY_DESCRIPTION,
  eventForwarderManagedFeatureUsageQueryExists,
  generateEventForwarderExposureQueries,
  getActiveFeatureUsageQuery,
  isEventForwarderManagedExposureQuery,
  isEventForwarderManagedFeatureUsageQuery,
  reconcileEventForwarderManagedExposureQueries,
} from "../../src/util/event-forwarder-warehouse-queries";
import {
  buildEventForwarderPropertyValueSql,
  EVENT_FORWARDER_AVRO_PARTITION_FIELD,
} from "../../src/util/event-forwarder-fact-table";

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

  it("aliases the identifier name but reads the source attribute", () => {
    const sql = buildEventForwarderExposureQuerySql({
      sinkType: "bigquery",
      tableRef,
      userIdType: "logged_in_user",
      sourceAttribute: "user_id",
    });

    expect(sql).toContain(
      "CAST(JSON_VALUE(`attributes`, '$.\"user_id\"') AS STRING) AS `logged_in_user`",
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
  const bigqueryParams = {
    sinkType: "bigquery" as const,
    projectId: "proj",
    dataset: "ds",
    tablePrefix: "gb",
  };

  it("creates one exposure query per managed identifier type", () => {
    const queries = generateEventForwarderExposureQueries(
      [
        { userIdType: "user_id", managedBy: "api", sourceAttribute: "user_id" },
        {
          userIdType: "anonymous_id",
          managedBy: "api",
          sourceAttribute: "anonymous_id",
        },
      ],
      bigqueryParams,
    );

    expect(queries).toHaveLength(2);
    expect(queries[0].userIdType).toBe("user_id");
    expect(queries[0].name).toBe("user_id");
    expect(queries[0].sourceAttribute).toBe("user_id");
    expect(queries[1].userIdType).toBe("anonymous_id");
    expect(queries[0].query).toContain("AS `user_id`");
    expect(queries[0].query).toContain('$."user_id"');
    expect(queries[0].description).toBe(
      EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
    );
    expect(queries[0].dimensions).toEqual([]);
    expect(queries[0].managedBy).toBe("api");
    expect(isEventForwarderManagedExposureQuery(queries[0])).toBe(true);
  });

  it("leaves the id empty so the model layer mints a stable one", () => {
    const queries = generateEventForwarderExposureQueries(
      [{ userIdType: "user_id", managedBy: "api", sourceAttribute: "user_id" }],
      bigqueryParams,
    );

    expect(queries[0].id).toBe("");
  });

  it("aliases the renamed identifier while still reading the source attribute", () => {
    const queries = generateEventForwarderExposureQueries(
      [
        {
          userIdType: "logged_in_user",
          managedBy: "api",
          sourceAttribute: "user_id",
        },
      ],
      bigqueryParams,
      [{ property: "user_id", datatype: "string", hashAttribute: true }],
    );

    expect(queries[0].userIdType).toBe("logged_in_user");
    expect(queries[0].name).toBe("logged_in_user");
    expect(queries[0].sourceAttribute).toBe("user_id");
    expect(queries[0].query).toContain("AS `logged_in_user`");
    expect(queries[0].query).toContain('$."user_id"');
    expect(queries[0].query).not.toContain('$."logged_in_user"');
  });

  it("types the column from the source attribute's datatype", () => {
    const queries = generateEventForwarderExposureQueries(
      [
        {
          userIdType: "account",
          managedBy: "api",
          sourceAttribute: "account_id",
        },
      ],
      bigqueryParams,
      [{ property: "account_id", datatype: "number", hashAttribute: true }],
    );

    expect(queries[0].query).toContain("AS FLOAT64");
  });
});

describe("reconcileEventForwarderManagedExposureQueries", () => {
  const bigqueryParams = {
    sinkType: "bigquery" as const,
    projectId: "proj",
    dataset: "ds",
    tablePrefix: "gb",
  };

  const managedUserIdType = (
    userIdType: string,
    sourceAttribute: string,
  ): UserIdType => ({
    userIdType,
    managedBy: "api",
    sourceAttribute,
  });

  it("leaves an already-linked managed query completely untouched", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_stable",
        userIdType: "user_id",
        name: "user_id",
        sourceAttribute: "user_id",
        dimensions: ["country"],
        hasNameCol: true,
        managedBy: "api",
        query: "SELECT stale",
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      // Renamed out from under us. We still match it by source attribute, so no
      // second query appears — but we do not rewrite the one that is there.
      userIdTypes: [managedUserIdType("logged_in_user", "user_id")],
      params: bigqueryParams,
      attributeSchema: [
        { property: "user_id", datatype: "string", hashAttribute: true },
      ],
    });

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toEqual(existing[0]);
  });

  it("adds queries for newly managed identifier types", () => {
    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing: [],
      userIdTypes: [managedUserIdType("device_id", "device_id")],
      params: bigqueryParams,
    });

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].userIdType).toBe("device_id");
    expect(reconciled[0].managedBy).toBe("api");
  });

  it("drops managed queries whose source attribute is gone", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_legacy",
        userIdType: "legacy_id",
        name: "legacy_id",
        sourceAttribute: "legacy_id",
        dimensions: [],
        managedBy: "api",
        query: "SELECT legacy",
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      userIdTypes: [],
      params: bigqueryParams,
    });

    expect(reconciled).toEqual([]);
  });

  it("preserves queries without the managed marker", () => {
    const existing: ExposureQuery[] = [
      {
        id: "custom_query",
        userIdType: "custom_id",
        name: "Custom",
        dimensions: [],
        query: "SELECT custom_id",
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      userIdTypes: [],
      params: bigqueryParams,
    });

    expect(reconciled).toEqual(existing);
  });

  it("keeps a user's own query alongside the managed one for the same identifier", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_mine",
        name: "My custom query",
        userIdType: "user_id",
        dimensions: [],
        query: "SELECT custom",
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      userIdTypes: [managedUserIdType("user_id", "user_id")],
      params: bigqueryParams,
    });

    expect(reconciled).toHaveLength(2);
    expect(reconciled[0]).toEqual(existing[0]);
    expect(reconciled[1].managedBy).toBe("api");
    expect(reconciled[1].userIdType).toBe("user_id");
  });

  it("skips the managed query when the user already wrote an identical one", () => {
    const generated = generateEventForwarderExposureQueries(
      [managedUserIdType("user_id", "user_id")],
      bigqueryParams,
    );
    const existing: ExposureQuery[] = [
      {
        id: "exq_mine",
        name: "My own query",
        userIdType: "user_id",
        dimensions: [],
        // Same SQL, reformatted — whitespace alone should not read as different.
        query: `  ${generated[0].query.replace(/\n/g, "\n  ")}  `,
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      userIdTypes: [managedUserIdType("user_id", "user_id")],
      params: bigqueryParams,
    });

    expect(reconciled).toEqual(existing);
  });

  it("adds the managed query alongside a user query whose SQL differs", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_mine",
        name: "My own query",
        userIdType: "user_id",
        dimensions: [],
        query: "SELECT user_id FROM my_own_table",
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      userIdTypes: [managedUserIdType("user_id", "user_id")],
      params: bigqueryParams,
    });

    expect(reconciled).toHaveLength(2);
    expect(reconciled[0]).toEqual(existing[0]);
    expect(reconciled[1].managedBy).toBe("api");
    // Points at the reused identifier type, not a prefixed name.
    expect(reconciled[1].userIdType).toBe("user_id");
  });

  it("is idempotent across repeated syncs", () => {
    const userIdTypes = [managedUserIdType("logged_in_user", "user_id")];
    const first = reconcileEventForwarderManagedExposureQueries({
      existing: [],
      userIdTypes,
      params: bigqueryParams,
    }).map((query) => ({ ...query, id: "exq_assigned" }));

    const second = reconcileEventForwarderManagedExposureQueries({
      existing: first,
      userIdTypes,
      params: bigqueryParams,
    });

    expect(second).toEqual(first);
  });

  it("preserves the id of a legacy ef_-prefixed managed query", () => {
    const existing: ExposureQuery[] = [
      {
        // Written before the explicit link existed: no sourceAttribute, and the
        // id is the prefixed identifier name rather than an exq_ id.
        id: "ef_user_id",
        userIdType: "ef_user_id",
        name: "ef_user_id",
        dimensions: ["country"],
        hasNameCol: true,
        managedBy: "api",
        query: "SELECT stale",
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      // The identifier type reconcile keeps the legacy name and backfills the
      // link, so that is what reaches this function.
      userIdTypes: [managedUserIdType("ef_user_id", "user_id")],
      params: bigqueryParams,
      attributeSchema: [
        { property: "user_id", datatype: "string", hashAttribute: true },
      ],
    });

    expect(reconciled).toHaveLength(1);
    // Backfilling the link is the only write. Dropping and re-minting would
    // orphan every experiment, report, safe rollout, template, and ramp schedule
    // referencing the old id; rewriting the SQL would move the warehouse column.
    expect(reconciled[0]).toEqual({
      ...existing[0],
      sourceAttribute: "user_id",
    });
  });

  it("stops backfilling once the legacy query is linked", () => {
    const existing: ExposureQuery[] = [
      {
        id: "ef_user_id",
        userIdType: "ef_user_id",
        name: "ef_user_id",
        sourceAttribute: "user_id",
        dimensions: [],
        managedBy: "api",
        query: "SELECT stale",
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      userIdTypes: [managedUserIdType("ef_user_id", "user_id")],
      params: bigqueryParams,
      attributeSchema: [
        { property: "user_id", datatype: "string", hashAttribute: true },
      ],
    });

    expect(reconciled).toEqual(existing);
  });

  it("does not strip the ef_ prefix from a user-created query", () => {
    const existing: ExposureQuery[] = [
      {
        id: "custom_query",
        userIdType: "ef_user_id",
        name: "Mine",
        dimensions: [],
        query: "SELECT ef_user_id",
      },
    ];

    const reconciled = reconcileEventForwarderManagedExposureQueries({
      existing,
      userIdTypes: [],
      params: bigqueryParams,
    });

    expect(reconciled).toEqual(existing);
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

  it("includes received_at partition filter and property columns for BigQuery", () => {
    const sql = buildEventForwarderFeatureUsageQuerySql({
      sinkType: "bigquery",
      tableRef,
    });

    expect(sql).toContain("timestamp AS timestamp");
    expect(sql).toContain("feature_key AS feature_key");
    expect(sql).toContain("environment AS environment");
    expect(sql).toContain("JSON_VALUE(`properties`, '$.\"value\"') AS value");
    expect(sql).toContain("JSON_VALUE(`properties`, '$.\"source\"') AS source");
    expect(sql).toContain(
      "JSON_VALUE(`properties`, '$.\"ruleId\"') AS rule_id",
    );
    expect(sql).toContain(
      "JSON_VALUE(`properties`, '$.\"variationId\"') AS variation_id",
    );
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
    expect(sql).toContain("ENVIRONMENT AS environment");
    expect(sql).toContain('PROPERTIES:"value"::STRING AS value');
    expect(sql).toContain('PROPERTIES:"source"::STRING AS source');
    expect(sql).toContain('PROPERTIES:"ruleId"::STRING AS rule_id');
    expect(sql).toContain('PROPERTIES:"variationId"::STRING AS variation_id');
    expect(sql).toContain("FROM MY_DB.PUBLIC.FEATURE_USAGE");
    expect(sql).not.toContain("WHERE");
  });
});

describe("buildEventForwarderPropertyValueSql", () => {
  it("extracts a property from the BigQuery JSON column", () => {
    expect(
      buildEventForwarderPropertyValueSql({
        sinkType: "bigquery",
        propertyKey: "ruleId",
      }),
    ).toBe("JSON_VALUE(`properties`, '$.\"ruleId\"')");
  });

  it("extracts a property from the Snowflake VARIANT column", () => {
    expect(
      buildEventForwarderPropertyValueSql({
        sinkType: "snowflake",
        propertyKey: "variationId",
      }),
    ).toBe('PROPERTIES:"variationId"::STRING');
  });

  it("escapes double quotes in BigQuery property keys", () => {
    expect(
      buildEventForwarderPropertyValueSql({
        sinkType: "bigquery",
        propertyKey: 'a"b',
      }),
    ).toBe('JSON_VALUE(`properties`, \'$."a\\\\"b"\')');
  });

  it("escapes backslashes in BigQuery property keys", () => {
    expect(
      buildEventForwarderPropertyValueSql({
        sinkType: "bigquery",
        propertyKey: "a\\b",
      }),
    ).toBe("JSON_VALUE(`properties`, '$.\"a\\\\\\\\b\"')");
  });

  it("escapes single quotes in BigQuery property keys", () => {
    expect(
      buildEventForwarderPropertyValueSql({
        sinkType: "bigquery",
        propertyKey: "a'b",
      }),
    ).toBe("JSON_VALUE(`properties`, '$.\"a\\'b\"')");
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
