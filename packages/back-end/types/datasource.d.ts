import { AthenaConnectionParams } from "./integrations/athena";
import { BigQueryConnectionParams } from "./integrations/bigquery";
import { ClickHouseConnectionParams } from "./integrations/clickhouse";
import { GoogleAnalyticsParams } from "./integrations/googleanalytics";
import { MixpanelConnectionParams } from "./integrations/mixpanel";
import { MysqlConnectionParams } from "./integrations/mysql";
import { PostgresConnectionParams } from "./integrations/postgres";
import { PrestoConnectionParams } from "./integrations/presto";
import { SnowflakeConnectionParams } from "./integrations/snowflake";
import { DatabricksConnectionParams } from "./integrations/databricks";
import { MetricType } from "./metric";
import { MssqlConnectionParams } from "./integrations/mssql";

export type DataSourceType =
  | "redshift"
  | "athena"
  | "google_analytics"
  | "snowflake"
  | "postgres"
  | "mysql"
  | "mssql"
  | "bigquery"
  | "clickhouse"
  | "presto"
  | "databricks"
  | "mixpanel";

export type DataSourceParams =
  | PostgresConnectionParams
  | MysqlConnectionParams
  | MssqlConnectionParams
  | AthenaConnectionParams
  | PrestoConnectionParams
  | DatabricksConnectionParams
  | GoogleAnalyticsParams
  | SnowflakeConnectionParams
  | BigQueryConnectionParams
  | ClickHouseConnectionParams
  | MixpanelConnectionParams;

export type QueryLanguage = "sql" | "javascript" | "json" | "none";

export type SchemaFormat =
  | "segment"
  | "snowplow"
  | "jitsu"
  | "freshpaint"
  | "ga4"
  | "gaua"
  | "matomo"
  | "heap"
  | "rudderstack"
  | "amplitude"
  | "mparticle"
  | "mixpanel"
  | "firebase"
  | "keen"
  | "clevertap"
  | "custom";

export type SchemaOption = {
  name: string;
  type: string;
  label: string;
  defaultValue: string | number;
  helpText?: string;
};

export interface SchemaInterface {
  getExperimentSQL(
    tablePrefix: string,
    userId: string,
    options?: Record<string, string | number>
  ): string;
  getIdentitySQL(
    tablePrefix: string,
    options?: Record<string, string | number>
  ): IdentityJoinQuery[];
  experimentDimensions: string[];
  userIdTypes: string[];
  getMetricSQL(name: string, type: MetricType, tablePrefix: string): string;
}

export interface DataSourceProperties {
  queryLanguage: QueryLanguage;
  metricCaps?: boolean;
  segments?: boolean;
  experimentSegments?: boolean;
  exposureQueries?: boolean;
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
  decryptionError: boolean;
};

export type IdentityJoinQuery = {
  ids: string[];
  query: string;
};

export interface ExposureQuery {
  id: string;
  name: string;
  description?: string;
  userIdType: string;
  query: string;
  hasNameCol?: boolean;
  dimensions: string[];
}

export interface UserIdType {
  userIdType: string;
  description?: string;
}

export type DataSourceEvents = {
  experimentEvent?: string;
  experimentIdProperty?: string;
  variationIdProperty?: string;
  extraUserIdProperty?: string;
};

export type DataSourceSettings = {
  // @deprecated
  experimentDimensions?: string[];
  notebookRunQuery?: string;
  schemaFormat?: SchemaFormat;
  schemaOptions?: Record<string, string | number>;
  userIdTypes?: UserIdType[];
  queries?: {
    // @deprecated
    experimentsQuery?: string;
    exposure?: ExposureQuery[];
    identityJoins?: IdentityJoinQuery[];
    // @deprecated
    pageviewsQuery?: string;
  };
  events?: DataSourceEvents;
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
};

interface DataSourceBase {
  id: string;
  name: string;
  description: string;
  organization: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  params: string;
  projects?: string[];
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

interface DatabricksDataSource extends DataSourceBase {
  type: "databricks";
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

interface MssqlDataSource extends DataSourceBase {
  type: "mssql";
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
export type DatabricksDataSourceWithParams = WithParams<
  DatabricksDataSource,
  DatabricksConnectionParams
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
export type MssqlDataSourceWithParams = WithParams<
  MssqlDataSource,
  MssqlConnectionParams
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
  | DatabricksDataSource
  | GoogleAnalyticsDataSource
  | SnowflakeDataSource
  | PostgresDataSource
  | MysqlDataSource
  | MssqlDataSource
  | BigQueryDataSource
  | ClickHouseDataSource
  | MixpanelDataSource;

export type DataSourceInterfaceWithParams =
  | RedshiftDataSourceWithParams
  | AthenaDataSourceWithParams
  | PrestoDataSourceWithParams
  | DatabricksDataSourceWithParams
  | GoogleAnalyticsDataSourceWithParams
  | SnowflakeDataSourceWithParams
  | PostgresDataSourceWithParams
  | MysqlDataSourceWithParams
  | MssqlDataSourceWithParams
  | BigQueryDataSourceWithParams
  | ClickHouseDataSourceWithParams
  | MixpanelDataSourceWithParams;
