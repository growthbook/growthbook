import type { SqlDialect } from "shared/types/sql";
import { baseDialect } from "back-end/src/integrations/dialects/base";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { snowflakeDialect } from "back-end/src/integrations/dialects/snowflake";
import { databricksDialect } from "back-end/src/integrations/dialects/databricks";
import { redshiftDialect } from "back-end/src/integrations/dialects/redshift";
import { verticaDialect } from "back-end/src/integrations/dialects/vertica";
import { mysqlDialect } from "back-end/src/integrations/dialects/mysql";
import { mssqlDialect } from "back-end/src/integrations/dialects/mssql";
import { clickHouseDialect } from "back-end/src/integrations/dialects/clickhouse";
import { athenaDialect } from "back-end/src/integrations/dialects/athena";
import { prestoDialect } from "back-end/src/integrations/dialects/presto";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";

describe("SqlDialect.arrayElement", () => {
  const cases: [string, Pick<SqlDialect, "arrayElement">, string, string][] = [
    ["base (native, 1-based)", baseDialect, "w[1]", "w[3]"],
    ["postgres (native, 1-based)", postgresDialect, "w[1]", "w[3]"],
    ["clickhouse (native, 1-based)", clickHouseDialect, "w[1]", "w[3]"],
    ["athena (native, 1-based)", athenaDialect, "w[1]", "w[3]"],
    ["presto (native, 1-based)", prestoDialect, "w[1]", "w[3]"],
    [
      "bigquery (0-based, safe offset)",
      bigQueryDialect,
      "w[SAFE_OFFSET(0)]",
      "w[SAFE_OFFSET(2)]",
    ],
    ["databricks (0-based)", databricksDialect, "w[0]", "w[2]"],
    ["vertica (0-based native)", verticaDialect, "w[0]", "w[2]"],
    [
      "snowflake (0-based variant, cast)",
      snowflakeDialect,
      "CAST(w[0] AS DOUBLE)",
      "CAST(w[2] AS DOUBLE)",
    ],
    [
      "redshift (0-based SUPER, cast)",
      redshiftDialect,
      "w[0]::float",
      "w[2]::float",
    ],
    [
      "mysql (json array)",
      mysqlDialect,
      "CAST(JSON_EXTRACT(w, '$[0]') AS DOUBLE)",
      "CAST(JSON_EXTRACT(w, '$[2]') AS DOUBLE)",
    ],
    [
      "mssql (json array)",
      mssqlDialect,
      "CAST(JSON_VALUE(w, '$[0]') as FLOAT)",
      "CAST(JSON_VALUE(w, '$[2]') as FLOAT)",
    ],
  ];

  it.each(cases)("%s", (_name, dialect, atIndex0, atIndex2) => {
    expect(dialect.arrayElement("w", 0)).toBe(atIndex0);
    expect(dialect.arrayElement("w", 2)).toBe(atIndex2);
  });
});
