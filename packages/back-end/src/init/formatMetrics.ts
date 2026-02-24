import { setFormatMetricsReporter, setPolyglotFormatter } from "shared/sql";
import { metrics } from "back-end/src/util/metrics";

function getPolyglotDialect(
  mod: Awaited<typeof import("@polyglot-sql/sdk")>,
  dialect: string,
) {
  switch (dialect) {
    case "mysql":
      return mod.Dialect.MySQL;
    case "bigquery":
      return mod.Dialect.BigQuery;
    case "snowflake":
      return mod.Dialect.Snowflake;
    case "redshift":
      return mod.Dialect.Redshift;
    case "presto":
      return mod.Dialect.Presto;
    case "trino":
      return mod.Dialect.Trino;
    case "clickhouse":
      return mod.Dialect.ClickHouse;
    case "databricks":
      return mod.Dialect.Databricks;
    case "athena":
      return mod.Dialect.Athena;
    case "tsql":
      return mod.Dialect.TSQL;
    case "sqlite":
      return mod.Dialect.SQLite;
    case "sql":
      return mod.Dialect.PostgreSQL;
    default:
      return mod.Dialect.PostgreSQL;
  }
}

export function initFormatMetrics(): void {
  void import("@polyglot-sql/sdk")
    .then((mod) => {
      setPolyglotFormatter((sql, dialect) => {
        try {
          const pgDialect = getPolyglotDialect(mod, dialect);
          const result = mod.format(sql, pgDialect);
          if (result?.success && result?.sql?.length) return result.sql[0];
        } catch {
          /* fall through */
        }
        return null;
      });
    })
    .catch(() => {
      /* Polyglot unavailable; format() will use sql-formatter */
    });
  const polyglotSuccess = metrics.getCounter("format.polyglot.success");
  const polyglotFailure = metrics.getCounter("format.polyglot.failure");
  const polyglotTime = metrics.getHistogram("format.polyglot.time");
  const sqlformatSuccess = metrics.getCounter("format.sqlformat.success");
  const sqlformatFailure = metrics.getCounter("format.sqlformat.failure");
  const sqlformatTime = metrics.getHistogram("format.sqlformat.time");

  setFormatMetricsReporter((event) => {
    if (event.engine === "polyglot") {
      if (event.success) {
        polyglotSuccess.increment();
      } else {
        polyglotFailure.increment();
      }
      polyglotTime.record(event.timeMs);
    } else {
      if (event.success) {
        sqlformatSuccess.increment();
      } else {
        sqlformatFailure.increment();
      }
      sqlformatTime.record(event.timeMs);
    }
  });
}
