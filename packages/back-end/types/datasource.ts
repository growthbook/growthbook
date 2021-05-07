import { AthenaConnectionParams } from "./integrations/athena";
import { BigQueryConnectionParams } from "./integrations/bigquery";
import { GoogleAnalyticsParams } from "./integrations/googleanalytics";
import { MixpanelConnectionParams } from "./integrations/mixpanel";
import { PostgresConnectionParams } from "./integrations/postgres";
import { SnowflakeConnectionParams } from "./integrations/snowflake";

export type DataSourceType =
  | "redshift"
  | "athena"
  | "google_analytics"
  | "snowflake"
  | "postgres"
  | "bigquery"
  | "mixpanel";

export type DataSourceParams =
  | PostgresConnectionParams
  | AthenaConnectionParams
  | GoogleAnalyticsParams
  | SnowflakeConnectionParams
  | BigQueryConnectionParams
  | MixpanelConnectionParams;

export type QueryLanguage = "sql" | "javascript" | "json" | "none";

export interface DataSourceProperties {
  type: "manual" | "database" | "api";
  queryLanguage: QueryLanguage;
  includeInConfig: boolean;
  readonlyFields: string[];
  metricCaps: boolean;
}

type WithParams<B, P> = Omit<B, "params"> & { params: P };

export type DataSourceSettings = {
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
    variationFormat: "index" | "key";
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
  dateCreated: Date;
  dateUpdated: Date;
  params: string;
  settings: DataSourceSettings;
}

interface RedshiftDataSource extends DataSourceBase {
  type: "redshift";
}

interface AthenaDataSource extends DataSourceBase {
  type: "athena";
}
interface GoogleAnalyticsDataSource extends DataSourceBase {
  type: "google_analytics";
}

interface SnowflakeDataSource extends DataSourceBase {
  type: "snowflake";
}
interface PostgresDataSource extends DataSourceBase {
  type: "postgres";
}

interface BigQueryDataSource extends DataSourceBase {
  type: "bigquery";
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
export type BigQueryDataSourceWithParams = WithParams<
  BigQueryDataSource,
  BigQueryConnectionParams
>;
export type MixpanelDataSourceWithParams = WithParams<
  MixpanelDataSource,
  MixpanelConnectionParams
>;

export type DataSourceInterface =
  | RedshiftDataSource
  | AthenaDataSource
  | GoogleAnalyticsDataSource
  | SnowflakeDataSource
  | PostgresDataSource
  | BigQueryDataSource
  | MixpanelDataSource;

export type DataSourceInterfaceWithParams =
  | RedshiftDataSourceWithParams
  | AthenaDataSourceWithParams
  | GoogleAnalyticsDataSourceWithParams
  | SnowflakeDataSourceWithParams
  | PostgresDataSourceWithParams
  | BigQueryDataSourceWithParams
  | MixpanelDataSourceWithParams;
