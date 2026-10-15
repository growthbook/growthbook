import type { SqlDialect } from "shared/types/sql";
import {
  baseDialect,
  bigQueryDialect,
  snowflakeDialect,
  databricksDialect,
  redshiftDialect,
  verticaDialect,
  mysqlDialect,
  mssqlDialect,
  clickHouseDialect,
  athenaDialect,
  prestoDialect,
  postgresDialect,
  adobeExperiencePlatformQueryServiceDialect,
} from "shared/dialects";

const windowSpec = "PARTITION BY u ORDER BY ts";

describe("SqlDialect.lagLead", () => {
  const standard: [string, Pick<SqlDialect, "lagLead">][] = [
    ["base", baseDialect],
    ["postgres", postgresDialect],
    ["bigquery", bigQueryDialect],
    ["snowflake", snowflakeDialect],
    ["databricks", databricksDialect],
    ["redshift", redshiftDialect],
    ["vertica", verticaDialect],
    ["mysql", mysqlDialect],
    ["mssql", mssqlDialect],
    ["athena", athenaDialect],
    ["presto", prestoDialect],
    ["adobe", adobeExperiencePlatformQueryServiceDialect],
  ];

  it.each(standard)("%s emits standard LAG/LEAD", (_, dialect) => {
    expect(dialect.lagLead("LAG", "step", 1, windowSpec)).toBe(
      "LAG(step, 1) OVER (PARTITION BY u ORDER BY ts)",
    );
    expect(dialect.lagLead("LEAD", "step", 3, windowSpec)).toBe(
      "LEAD(step, 3) OVER (PARTITION BY u ORDER BY ts)",
    );
  });

  // ClickHouse resolves uppercase LAG/LEAD only from 25.10, and returns ''
  // rather than NULL past the boundary for a non-nullable String.
  it("clickhouse emits lagInFrame/leadInFrame over the whole partition", () => {
    expect(clickHouseDialect.lagLead("LAG", "step", 1, windowSpec)).toBe(
      "lagInFrame(toNullable(step), 1) OVER (PARTITION BY u ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)",
    );
    expect(clickHouseDialect.lagLead("LEAD", "step", 2, windowSpec)).toBe(
      "leadInFrame(toNullable(step), 2) OVER (PARTITION BY u ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)",
    );
  });
});
