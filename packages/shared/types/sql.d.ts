export type TemplateVariables = {
  eventName?: string;
  valueColumn?: string;
};

export type PhaseSQLVar = {
  index?: string;
};

export type SQLVars = {
  startDate: Date;
  endDate?: Date;
  experimentId?: string;
  phase?: PhaseSQLVar;
  customFields?: Record<string, unknown>;
  templateVariables?: TemplateVariables;
};

// SQL formatter dialect type - string values matching Polyglot/sql-formatter
// We need "" for google analytics and mixpanel
export type FormatDialect =
  | "redshift"
  | "snowflake"
  | "mysql"
  | "bigquery"
  | "postgresql"
  | "tsql"
  | "clickhouse"
  | "athena"
  | "presto"
  | "databricks"
  | "trino"
  | "spark"
  | "sql"
  | "sqlite"
  | "generic"
  | "";

export type DateTruncGranularity = "hour" | "day" | "week" | "month" | "year";

export interface SqlHelpers {
  escapeStringLiteral: (s: string) => string;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  evalBoolean: (col: string, value: boolean) => string;
  dateTrunc: (
    column: string,
    granularity: "hour" | "day" | "week" | "month" | "year",
  ) => string;
  percentileApprox: (column: string, percentile: number) => string;
  toTimestamp: (date: Date) => string;
  castToFloat: (column: string) => string;
  formatDialect: FormatDialect;
}
