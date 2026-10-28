import type { DataSourceType } from "shared/types/datasource";
import type { SqlDialect } from "shared/types/sql";
import { adobeExperiencePlatformQueryServiceDialect } from "./adobeExperiencePlatformQueryService";
import { athenaDialect } from "./athena";
import { bigQueryDialect } from "./bigquery";
import { clickHouseDialect } from "./clickhouse";
import { databricksDialect } from "./databricks";
import { mssqlDialect } from "./mssql";
import { mysqlDialect } from "./mysql";
import { postgresDialect } from "./postgres";
import { prestoDialect } from "./presto";
import { redshiftDialect } from "./redshift";
import { snowflakeDialect } from "./snowflake";
import { verticaDialect } from "./vertica";

export { baseDialect } from "./base";
export { quantileColumn } from "./clauses/quantile-column";
export {
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
};

// The one place a Data Source type picks its SQL dialect. Null for sources
// that aren't queried with SQL.
const dialectsByType: Record<DataSourceType, SqlDialect | null> = {
  adobe_experience_platform_query_service:
    adobeExperiencePlatformQueryServiceDialect,
  athena: athenaDialect,
  bigquery: bigQueryDialect,
  clickhouse: clickHouseDialect,
  databricks: databricksDialect,
  google_analytics: null,
  growthbook_clickhouse: clickHouseDialect,
  mixpanel: null,
  mssql: mssqlDialect,
  mysql: mysqlDialect,
  postgres: postgresDialect,
  presto: prestoDialect,
  redshift: redshiftDialect,
  snowflake: snowflakeDialect,
  vertica: verticaDialect,
};

export function getDataSourceSqlDialect(
  type: DataSourceType,
): SqlDialect | null {
  return dialectsByType[type] ?? null;
}
