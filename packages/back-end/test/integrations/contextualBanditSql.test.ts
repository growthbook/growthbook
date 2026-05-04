import {
  CbaqDialect,
  getContextualBanditCaseWhen,
  getContextualBanditDimensionSql,
} from "back-end/src/integrations/contextualBanditSql";

const ATTRS = [
  {
    name: "country",
    column: "country",
    datatype: "string" as const,
    topValues: ["US", "CA", "UK"],
  },
  {
    name: "device",
    column: "device",
    datatype: "string" as const,
    topValues: ["mobile", "desktop"],
  },
  {
    name: "ltv",
    column: "ltv_value",
    datatype: "number" as const,
  },
];

const BASE_INPUT = {
  cbaqSql:
    "SELECT user_id, variation_id AS variation, m.value AS metric, country, device, ltv_value FROM cb_assignments JOIN metric m USING (user_id)",
  metricValueColumn: "metric_value",
  variationColumn: "variation",
  attributes: ATTRS,
};

describe("getContextualBanditCaseWhen", () => {
  it("returns 'other' for string attrs with empty topValues", () => {
    expect(
      getContextualBanditCaseWhen(
        { name: "x", column: "x", datatype: "string", topValues: [] },
        "postgres",
      ),
    ).toBe("'other'");
  });
  it("emits IN list for string attrs with topValues", () => {
    const sql = getContextualBanditCaseWhen(
      {
        name: "country",
        column: "country",
        datatype: "string",
        topValues: ["US", "CA"],
      },
      "postgres",
    );
    expect(sql).toContain("country IN ('US', 'CA')");
    expect(sql).toContain("ELSE 'other'");
  });
  it("returns the raw column for numeric attrs (bucketing handled in ctx_label)", () => {
    expect(
      getContextualBanditCaseWhen(
        { name: "ltv", column: "ltv_value", datatype: "number" },
        "postgres",
      ),
    ).toBe("ltv_value");
  });
  it("escapes single quotes in topValues", () => {
    const sql = getContextualBanditCaseWhen(
      {
        name: "label",
        column: "label",
        datatype: "string",
        topValues: ["O'Hare"],
      },
      "postgres",
    );
    expect(sql).toContain("'O''Hare'");
  });
});

describe("getContextualBanditDimensionSql — structural shape", () => {
  it.each<CbaqDialect>([
    "postgres",
    "redshift",
    "snowflake",
    "bigquery",
    "databricks",
  ])("emits the WITH raw / ctx_label / labeled chain (%s)", (dialect) => {
    const sql = getContextualBanditDimensionSql({
      ...BASE_INPUT,
      dialect,
    });
    expect(sql).toMatch(/^WITH /);
    expect(sql).toContain("raw AS");
    expect(sql).toContain("ctx_label AS");
    expect(sql).toContain("labeled AS");
    expect(sql).toMatch(/GROUP BY context_id, variation/);
  });

  it("uses CONCAT for BigQuery", () => {
    const sql = getContextualBanditDimensionSql({
      ...BASE_INPUT,
      dialect: "bigquery",
    });
    expect(sql).toContain("CONCAT(");
  });

  it("uses || for Postgres", () => {
    const sql = getContextualBanditDimensionSql({
      ...BASE_INPUT,
      dialect: "postgres",
    });
    expect(sql).toMatch(/\|\|/);
  });

  it("includes NTILE bucketing for numeric attrs", () => {
    const sql = getContextualBanditDimensionSql({
      ...BASE_INPUT,
      dialect: "postgres",
      numericBuckets: 4,
    });
    expect(sql).toContain("NTILE(4) OVER (ORDER BY raw_ltv_value)");
    expect(sql).toContain("'q'");
  });

  it("relabels infrequent strings as 'other'", () => {
    const sql = getContextualBanditDimensionSql({
      ...BASE_INPUT,
      dialect: "postgres",
    });
    expect(sql).toContain("ELSE 'other'");
  });

  it("excludes deleted attributes", () => {
    const sql = getContextualBanditDimensionSql({
      ...BASE_INPUT,
      dialect: "postgres",
      attributes: [
        ATTRS[0],
        { ...ATTRS[1], deleted: true },
        ATTRS[2],
      ],
    });
    expect(sql).not.toMatch(/label_device/);
    expect(sql).toContain("label_country");
    expect(sql).toContain("label_ltv_value");
  });
});
