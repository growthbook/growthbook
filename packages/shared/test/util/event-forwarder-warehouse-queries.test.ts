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
  getActiveFeatureUsageQuery,
  reconcileEventForwarderManagedExposureQueries,
} from "../../src/util/event-forwarder-warehouse-queries";
import { isEventForwarderManaged } from "../../src/util/event-forwarder-datasource";
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

describe("reconcileEventForwarderManagedExposureQueries", () => {
  const params = {
    sinkType: "bigquery" as const,
    projectId: "proj",
    dataset: "ds",
    tablePrefix: "gb",
  };
  const stringAttribute = [
    { property: "user_id", datatype: "string" as const, hashAttribute: true },
  ];
  const numberAttribute = [
    { property: "user_id", datatype: "number" as const, hashAttribute: true },
  ];

  const pair = (userIdType: string, attribute = "user_id") => ({
    attribute,
    userIdType: { userIdType, managedBy: "api", attributes: [attribute] },
  });

  const generatedSql = (
    alias: string,
    attribute = "user_id",
    attributeDatatype: "string" | "number" | undefined = "string",
  ) =>
    buildEventForwarderExposureQuerySql({
      sinkType: params.sinkType,
      tableRef: buildEventForwarderExperimentViewedTableReference(params),
      userIdType: alias,
      sourceAttribute: attribute,
      attributeDatatype,
    });

  const reconcile = (
    existing: ExposureQuery[],
    pairs: ReturnType<typeof pair>[],
    attributeSchema = stringAttribute,
  ) =>
    reconcileEventForwarderManagedExposureQueries({
      existing,
      pairs,
      params,
      attributeSchema,
    });

  it("creates one managed query per paired identifier type", () => {
    const result = reconcile([], [pair("user_id")]);

    expect(result).toEqual([
      {
        id: "",
        userIdType: "user_id",
        name: "user_id",
        description: EVENT_FORWARDER_MANAGED_EXPOSURE_QUERY_DESCRIPTION,
        dimensions: [],
        managedBy: "api",
        query: generatedSql("user_id"),
      },
    ]);
  });

  it("aliases the identifier type's name while reading the source attribute", () => {
    const [created] = reconcile([], [pair("ef_user_id")]);

    expect(created.query).toContain("`ef_user_id`");
    expect(created.query).toContain('$."user_id"');
  });

  it("casts the column to the attribute's datatype", () => {
    const [created] = reconcile([], [pair("user_id")], numberAttribute);

    expect(created.query).toContain("FLOAT64");
  });

  it("prefixes the query name when an existing query already holds it", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_mine",
        userIdType: "device_id",
        name: "user_id",
        dimensions: [],
        query: "SELECT 1",
      },
    ];

    const result = reconcile(existing, [pair("user_id")]);

    expect(result).toHaveLength(2);
    expect(result[1].name).toBe("ef_user_id");
    expect(result[1].userIdType).toBe("user_id");
  });

  it("leaves a user query carrying identical SQL alone", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_mine",
        userIdType: "user_id",
        name: "mine",
        dimensions: [],
        query: generatedSql("user_id"),
      },
    ];

    expect(reconcile(existing, [pair("user_id")])).toEqual(existing);
  });

  it("still recognizes generator output that has been reformatted", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_mine",
        userIdType: "user_id",
        name: "mine",
        dimensions: [],
        query: `  ${generatedSql("user_id").replace(/\n/g, "\n  ")}  `,
      },
    ];

    expect(reconcile(existing, [pair("user_id")])).toEqual(existing);
  });

  it("still recognizes generator output written before the datatype changed", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_mine",
        userIdType: "user_id",
        name: "mine",
        dimensions: [],
        query: generatedSql("user_id", "user_id", undefined),
      },
    ];

    expect(reconcile(existing, [pair("user_id")])).toEqual(existing);
  });

  it("adds a managed query alongside a user query whose SQL differs", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_mine",
        userIdType: "user_id",
        name: "user_id",
        dimensions: [],
        query: "SELECT my_own_thing",
      },
    ];

    const result = reconcile(existing, [pair("user_id")]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(existing[0]);
    expect(result[1].name).toBe("ef_user_id");
    expect(result[1].managedBy).toBe("api");
  });

  it("regenerates the managed query even when a user query has the same SQL", () => {
    const userQuery: ExposureQuery = {
      id: "exq_mine",
      userIdType: "user_id",
      name: "mine",
      dimensions: [],
      query: generatedSql("user_id"),
    };
    const managedQuery: ExposureQuery = {
      id: "exq_managed",
      userIdType: "user_id",
      name: "user_id",
      dimensions: [],
      managedBy: "api",
      query: generatedSql("user_id"),
    };

    // Whichever order they are stored in, the managed query tracks the datatype
    // and the user's own query is left untouched.
    for (const existing of [
      [userQuery, managedQuery],
      [managedQuery, userQuery],
    ]) {
      const result = reconcile(existing, [pair("user_id")], numberAttribute);

      expect(result).toHaveLength(2);
      expect(result.find((q) => q.id === "exq_managed")?.query).toBe(
        generatedSql("user_id", "user_id", "number"),
      );
      expect(result.find((q) => q.id === "exq_mine")).toEqual(userQuery);
    }
  });

  it("keeps a managed query's id and name when it regenerates the SQL", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_stable",
        userIdType: "user_id",
        name: "user_id",
        dimensions: ["country"],
        hasNameCol: true,
        managedBy: "api",
        query: generatedSql("user_id"),
      },
    ];

    const [updated] = reconcile(existing, [pair("user_id")], numberAttribute);

    expect(updated.id).toBe("exq_stable");
    expect(updated.name).toBe("user_id");
    expect(updated.userIdType).toBe("user_id");
    expect(updated.dimensions).toEqual(["country"]);
    expect(updated.hasNameCol).toBe(true);
    expect(updated.query).toBe(generatedSql("user_id", "user_id", "number"));
  });

  it("keeps the id and name of a legacy ef_-named managed query", () => {
    const existing: ExposureQuery[] = [
      {
        id: "ef_user_id",
        userIdType: "ef_user_id",
        name: "ef_user_id",
        dimensions: [],
        managedBy: "api",
        query: generatedSql("ef_user_id"),
      },
    ];

    const result = reconcile(existing, [pair("ef_user_id")]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ef_user_id");
    expect(result[0].name).toBe("ef_user_id");
  });

  it("leaves a managed query alone when its attribute is gone", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_orphan",
        userIdType: "user_id",
        name: "user_id",
        dimensions: [],
        managedBy: "api",
        query: generatedSql("user_id"),
      },
    ];

    expect(reconcile(existing, [])).toEqual(existing);
  });

  it("leaves a user's own query on another identifier alone", () => {
    const existing: ExposureQuery[] = [
      {
        id: "exq_mine",
        userIdType: "device_id",
        name: "mine",
        dimensions: [],
        query: "SELECT 1",
      },
    ];

    const result = reconcile(existing, [pair("user_id")]);

    expect(result[0]).toEqual(existing[0]);
    expect(isEventForwarderManaged(result[0])).toBe(false);
  });

  it("writes nothing on repeated syncs", () => {
    const first = reconcile([], [pair("user_id")]);
    const second = reconcile(first, [pair("user_id")]);

    expect(second).toEqual(first);
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
    expect(isEventForwarderManaged(query)).toBe(true);
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
