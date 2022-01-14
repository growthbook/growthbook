import { AthenaConnectionParams } from "./integrations/athena";
import { BigQueryConnectionParams } from "./integrations/bigquery";
import { ClickHouseConnectionParams } from "./integrations/clickhouse";
import { GoogleAnalyticsParams } from "./integrations/googleanalytics";
import { MixpanelConnectionParams } from "./integrations/mixpanel";
import { MysqlConnectionParams } from "./integrations/mysql";
import { PostgresConnectionParams } from "./integrations/postgres";
import { PrestoConnectionParams } from "./integrations/presto";
import { SnowflakeConnectionParams } from "./integrations/snowflake";

export type DataSourceType =
  | "redshift"
  | "athena"
  | "google_analytics"
  | "snowflake"
  | "postgres"
  | "mysql"
  | "bigquery"
  | "clickhouse"
  | "presto"
  | "mixpanel";

export type DataSourceParams =
  | PostgresConnectionParams
  | MysqlConnectionParams
  | AthenaConnectionParams
  | PrestoConnectionParams
  | GoogleAnalyticsParams
  | SnowflakeConnectionParams
  | BigQueryConnectionParams
  | ClickHouseConnectionParams
  | MixpanelConnectionParams;

export type QueryLanguage = "sql" | "javascript" | "json" | "none";

export interface DataSourceProperties {
  queryLanguage: QueryLanguage;
  metricCaps?: boolean;
  segments?: boolean;
  experimentSegments?: boolean;
  dimensions?: boolean;
  hasSettings?: boolean;
  activationDimension?: boolean;
  events?: boolean;
  userIds?: boolean;
  pastExperiments?: boolean;
  separateExperimentResultQueries?: boolean;
}

type WithParams<B, P> = Omit<B, "params"> & {
  params: P;
  properties?: DataSourceProperties;
};

export type DataSourceSettings = {
  experimentDimensions?: string[];
  notebookRunQuery?: string;
  queries?: {
    experimentsQuery?: string;
    pageviewsQuery?: string;
  };
  events?: {
    experimentEvent?: string;
    experimentIdProperty?: string;
    variationIdProperty?: string;
    pageviewEvent?: string;
    urlProperty?: string;
  };
  default?: {
    timestampColumn?: string;
    userIdColumn?: string;
    anonymousIdColumn?: string;
  };
  experiments?: {
    table?: string;
    timestampColumn?: string;
    userIdColumn?: string;
    anonymousIdColumn?: string;
    experimentIdColumn?: string;
    variationColumn?: string;
  };
  users?: {
    table?: string;
    userIdColumn?: string;
  };
  identifies?: {
    table?: string;
    anonymousIdColumn?: string;
    userIdColumn?: string;
  };
  pageviews?: {
    table?: string;
    urlColumn?: string;
    timestampColumn?: string;
    userIdColumn?: string;
    anonymousIdColumn?: string;
  };
};

interface DataSourceBase {
  id: string;
  name: string;
  organization: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  params: string;
  settings: DataSourceSettings;
}

interface RedshiftDataSource extends DataSourceBase {
  type: "redshift";
}

interface AthenaDataSource extends DataSourceBase {
  type: "athena";
}

interface PrestoDataSource extends DataSourceBase {
  type: "presto";
}

interface GoogleAnalyticsDataSource extends DataSourceBase {
  type: "google_analytics";
}

interface SnowflakeDataSource extends DataSourceBase {
  type: "snowflake";
}

interface MysqlDataSource extends DataSourceBase {
  type: "mysql";
}

interface PostgresDataSource extends DataSourceBase {
  type: "postgres";
}

interface BigQueryDataSource extends DataSourceBase {
  type: "bigquery";
}

interface ClickHouseDataSource extends DataSourceBase {
  type: "clickhouse";
}

interface MixpanelDataSource extends DataSourceBase {
  type: "mixpanel";
}

export type RedshiftDataSourceWithParams = WithParams<
  RedshiftDataSource,
  PostgresConnectionParams
>;
export type AthenaDataSourceWithParams = WithParams<
  AthenaDataSource,
  AthenaConnectionParams
>;
export type PrestoDataSourceWithParams = WithParams<
  PrestoDataSource,
  PrestoConnectionParams
>;
export type GoogleAnalyticsDataSourceWithParams = WithParams<
  GoogleAnalyticsDataSource,
  GoogleAnalyticsParams
>;
export type SnowflakeDataSourceWithParams = WithParams<
  SnowflakeDataSource,
  SnowflakeConnectionParams
>;
export type PostgresDataSourceWithParams = WithParams<
  PostgresDataSource,
  PostgresConnectionParams
>;
export type MysqlDataSourceWithParams = WithParams<
  MysqlDataSource,
  MysqlConnectionParams
>;
export type BigQueryDataSourceWithParams = WithParams<
  BigQueryDataSource,
  BigQueryConnectionParams
>;
export type ClickHouseDataSourceWithParams = WithParams<
  ClickHouseDataSource,
  ClickHouseConnectionParams
>;
export type MixpanelDataSourceWithParams = WithParams<
  MixpanelDataSource,
  MixpanelConnectionParams
>;

export type DataSourceInterface =
  | RedshiftDataSource
  | AthenaDataSource
  | PrestoDataSource
  | GoogleAnalyticsDataSource
  | SnowflakeDataSource
  | PostgresDataSource
  | MysqlDataSource
  | BigQueryDataSource
  | ClickHouseDataSource
  | MixpanelDataSource;

export type DataSourceInterfaceWithParams =
  | RedshiftDataSourceWithParams
  | AthenaDataSourceWithParams
  | PrestoDataSourceWithParams
  | GoogleAnalyticsDataSourceWithParams
  | SnowflakeDataSourceWithParams
  | PostgresDataSourceWithParams
  | MysqlDataSourceWithParams
  | BigQueryDataSourceWithParams
  | ClickHouseDataSourceWithParams
  | MixpanelDataSourceWithParams;
