import { DataSourceType } from "shared/types/datasource";

// Radix soft-avatar hues matched to the onboarding prototype's warehouse colors.
export type DataSourceAvatarColor =
  | "amber"
  | "blue"
  | "cyan"
  | "gray"
  | "indigo"
  | "orange"
  | "purple"
  | "red"
  | "sky"
  | "teal"
  | "violet";

export const DATA_SOURCE_TYPE_AVATAR: Record<
  DataSourceType,
  { abbr: string; color: DataSourceAvatarColor }
> = {
  bigquery: { abbr: "BQ", color: "blue" },
  snowflake: { abbr: "SF", color: "cyan" },
  databricks: { abbr: "DB", color: "orange" },
  redshift: { abbr: "RS", color: "violet" },
  athena: { abbr: "AT", color: "purple" },
  presto: { abbr: "PT", color: "indigo" },
  clickhouse: { abbr: "CH", color: "amber" },
  postgres: { abbr: "PG", color: "sky" },
  mysql: { abbr: "MY", color: "teal" },
  vertica: { abbr: "VE", color: "blue" },
  mssql: { abbr: "MS", color: "red" },
  adobe_experience_platform_query_service: { abbr: "AE", color: "red" },
  mixpanel: { abbr: "MP", color: "gray" },
  google_analytics: { abbr: "GA", color: "gray" },
  growthbook_clickhouse: { abbr: "GB", color: "violet" },
};
