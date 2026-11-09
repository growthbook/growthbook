import {
  adobeExperiencePlatformQueryServiceDialect,
  athenaDialect,
  bigQueryDialect,
  clickHouseDialect,
  databricksDialect,
  mssqlDialect,
  mysqlDialect,
  postgresDialect,
  prestoDialect,
  redshiftDialect,
  snowflakeDialect,
  verticaDialect,
} from "../../src/dialects";
import {
  findFeatureUsageColumnsNeedingQuotes,
  getFeatureUsageIdentifierExpression,
  getFeatureUsageJsonFieldError,
  getFeatureUsageFeatureKeyColumn,
  getFeatureUsageIdentifierColumn,
  getFeatureUsageRequiredColumns,
  getFeatureUsageRuleIdColumn,
  getFeatureUsageTimestampColumn,
} from "../../src/util/feature-usage-queries";

describe("feature usage query column getters", () => {
  it("fall back to the standard names without a mapping", () => {
    const query = {};
    expect(getFeatureUsageTimestampColumn(query)).toBe("timestamp");
    expect(getFeatureUsageFeatureKeyColumn(query)).toBe("feature_key");
    expect(getFeatureUsageRuleIdColumn(query)).toBe("rule_id");
    expect(getFeatureUsageIdentifierColumn(query, "user_id")).toBe("user_id");
  });

  it("return the mapped columns", () => {
    const query = {
      columnMapping: {
        timestampColumn: "ts",
        featureKeyColumn: "feature",
        ruleIdColumn: "ruleId",
        userIdColumns: { user_id: "uid" },
      },
    };
    expect(getFeatureUsageTimestampColumn(query)).toBe("ts");
    expect(getFeatureUsageFeatureKeyColumn(query)).toBe("feature");
    expect(getFeatureUsageRuleIdColumn(query)).toBe("ruleId");
    expect(getFeatureUsageIdentifierColumn(query, "user_id")).toBe("uid");
    expect(getFeatureUsageIdentifierColumn(query, "device_id")).toBe(
      "device_id",
    );
  });
});

describe("getFeatureUsageRequiredColumns", () => {
  it("only requires timestamp and feature_key for an unmapped query", () => {
    expect(getFeatureUsageRequiredColumns({})).toEqual([
      "timestamp",
      "feature_key",
    ]);
  });

  it("requires every mapped column and each declared identifier", () => {
    expect(
      getFeatureUsageRequiredColumns({
        userIdTypes: ["user_id", "device_id"],
        columnMapping: {
          timestampColumn: "ts",
          valueColumn: "val",
          userIdColumns: { user_id: "uid" },
        },
      }),
    ).toEqual(["ts", "feature_key", "val", "uid", "device_id"]);
  });
});

describe("findFeatureUsageColumnsNeedingQuotes", () => {
  it("flags special characters everywhere and capitals on lowercase-fold warehouses", () => {
    const query = {
      columnMapping: {
        featureKeyColumn: "featureKey",
        valueColumn: "my value",
        userIdColumns: { user_id: "uid" },
      },
    };
    expect(findFeatureUsageColumnsNeedingQuotes(query, "lower")).toEqual([
      "featureKey",
      "my value",
    ]);
    expect(findFeatureUsageColumnsNeedingQuotes(query, "upper")).toEqual([
      "my value",
    ]);
  });
});

describe("JSON field identifiers", () => {
  const jsonColumns = [{ column: "attributes", datatype: "json" as const }];
  const mapped = (column: string, columns = jsonColumns) => ({
    columnMapping: { userIdColumns: { user_id: column } },
    columns,
  });

  it("allows one level into a JSON column", () => {
    expect(
      getFeatureUsageJsonFieldError(mapped("attributes.customerId")),
    ).toBeNull();
  });

  it("rejects a field in a column that isn't JSON", () => {
    expect(
      getFeatureUsageJsonFieldError(
        mapped("attributes.customerId", [
          { column: "attributes", datatype: "string" },
        ]),
      ),
    ).toMatch(/isn't a JSON column/);
  });

  it("rejects more than one level and unusual names", () => {
    expect(getFeatureUsageJsonFieldError(mapped("attributes.user.id"))).toMatch(
      /more than one level/,
    );
    expect(
      getFeatureUsageJsonFieldError(mapped("attributes.customer-id")),
    ).toMatch(/letters, numbers and underscores/);
  });

  it("requires the JSON column, not the field, to exist", () => {
    expect(
      getFeatureUsageRequiredColumns({
        userIdTypes: ["user_id"],
        columnMapping: { userIdColumns: { user_id: "attributes.customerId" } },
      }),
    ).toEqual(["timestamp", "feature_key", "attributes"]);
  });

  it("checks only the JSON column's name for quoting", () => {
    expect(
      findFeatureUsageColumnsNeedingQuotes(
        mapped("attributes.customerId"),
        "lower",
      ),
    ).toEqual([]);
  });

  it("reads plain identifier columns as they are", () => {
    expect(
      getFeatureUsageIdentifierExpression(
        mapped("uid"),
        "user_id",
        bigQueryDialect,
        "e",
      ),
    ).toBe("e.uid");
  });

  it.each([
    [
      "adobe",
      adobeExperiencePlatformQueryServiceDialect,
      "get_json_object(e.attributes, '$.customerId')",
    ],
    [
      "athena",
      athenaDialect,
      "json_extract_scalar(e.attributes, '$.customerId')",
    ],
    ["bigquery", bigQueryDialect, "JSON_VALUE(e.attributes, '$.customerId')"],
    ["databricks", databricksDialect, "e.attributes:customerId"],
    ["mssql", mssqlDialect, "JSON_VALUE(e.attributes, '$.customerId')"],
    ["mysql", mysqlDialect, "JSON_EXTRACT(e.attributes, '$.customerId')"],
    [
      "postgres",
      postgresDialect,
      "JSON_EXTRACT_PATH_TEXT(e.attributes::json, 'customerId')",
    ],
    [
      "presto",
      prestoDialect,
      "json_extract_scalar(e.attributes, '$.customerId')",
    ],
    [
      "redshift",
      redshiftDialect,
      "JSON_EXTRACT_PATH_TEXT(e.attributes, 'customerId', TRUE)",
    ],
    [
      "snowflake",
      snowflakeDialect,
      "PARSE_JSON(e.attributes):customerId::string",
    ],
    [
      "vertica",
      verticaDialect,
      "MAPLOOKUP(MapJSONExtractor(e.attributes), 'customerId')",
    ],
  ])("extracts a JSON field on %s", (_name, dialect, expected) => {
    expect(
      getFeatureUsageIdentifierExpression(
        mapped("attributes.customerId"),
        "user_id",
        dialect,
        "e",
      ),
    ).toBe(expected);
  });

  it("extracts a JSON field on clickhouse from JSON or text columns", () => {
    const sql = getFeatureUsageIdentifierExpression(
      mapped("attributes.customerId"),
      "user_id",
      clickHouseDialect,
      "e",
    );
    expect(sql).toContain("e.attributes.customerId::Nullable(String)");
    expect(sql).toContain("JSONExtractString(e.attributes, 'customerId')");
  });
});
