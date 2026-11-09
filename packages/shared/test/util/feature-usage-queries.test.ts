import {
  findFeatureUsageColumnsNeedingQuotes,
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
