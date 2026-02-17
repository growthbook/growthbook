import {
  DataSourceParams,
  DataSourceType,
  SchemaFormat,
  SchemaOption,
} from "shared/types/datasource";
import { ReactElement } from "react";
import { BsDatabase } from "react-icons/bs";
import { GrBarChart } from "react-icons/gr";
import {
  SiAmazonredshift,
  SiClickhouse,
  SiDatabricks,
  SiGoogleanalytics,
  SiGooglebigquery,
  SiMixpanel,
  SiMysql,
  SiPostgresql,
  SiPresto,
  SiSnowflake,
} from "react-icons/si";
import { DocSection } from "@/components/DocLink";

export type eventSchema = {
  value: SchemaFormat;
  label: string;
  types?: DataSourceType[];
  options?: SchemaOption[];
  logo?: string;
  helpLink?: string;
  popular?: boolean;
  beta?: boolean;
};

export const eventSchemas: eventSchema[] = [
  {
    value: "ga4",
    label: "Google Analytics v4",
    types: ["bigquery"],
    logo: "/images/3rd-party-logos/ga4.png",
    popular: true,
    helpLink: "https://support.google.com/analytics/answer/9358801?hl=en",
  },
  {
    value: "segment",
    label: "Segment",
    types: [
      "bigquery",
      "snowflake",
      "athena",
      "redshift",
      "postgres",
      "vertica",
      "databricks",
      "athena",
    ],
    logo: "/images/3rd-party-logos/segment.png",
    popular: true,
    helpLink: "https://segment.com/docs/connections/storage/warehouses/",
    options: [
      {
        name: "exposureTableName",
        label: "Experiment exposure table name",
        defaultValue: "experiment_viewed",
        type: "text",
      },
    ],
  },
  {
    value: "rudderstack",
    label: "RudderStack",
    types: [
      "bigquery",
      "snowflake",
      "athena",
      "redshift",
      "postgres",
      "vertica",
      "databricks",
      "athena",
      "clickhouse",
      "mssql",
    ],
    logo: "/images/3rd-party-logos/rudderstack.png",
    popular: true,
    helpLink: "https://docs.growthbook.io/guide/rudderstack",
    options: [
      {
        name: "exposureTableName",
        label: "Experiment exposure table name",
        defaultValue: "experiment_viewed",
        type: "text",
      },
    ],
  },
  {
    value: "snowplow",
    label: "Snowplow",
    types: [
      "redshift",
      "bigquery",
      "postgres",
      "vertica",
      "athena",
      "snowflake",
      "databricks",
    ],
    logo: "/images/3rd-party-logos/snowplow.png",
    popular: true,
    helpLink:
      "https://docs.snowplowanalytics.com/docs/pipeline-components-and-applications/loaders-storage-targets/",
  },
  {
    value: "amplitude",
    label: "Amplitude",
    types: [
      "snowflake",
      "bigquery",
      "redshift",
      "athena",
      "databricks",
      "presto",
    ],
    logo: "/images/3rd-party-logos/amplitude.png",
    popular: true,
    helpLink:
      "https://amplitude.com/docs/data/destination-catalog#data-warehousedata-lake",
    options: [
      {
        name: "eventType",
        label: "Experiment event type",
        defaultValue: "Experiment Viewed",
        type: "text",
      },
      {
        name: "projectId",
        label: "Project ID",
        defaultValue: "",
        type: "text",
      },
    ],
  },
  {
    value: "firebase",
    label: "Firebase",
    types: ["bigquery"],
    logo: "/images/3rd-party-logos/firebase.png",
    popular: false,
    helpLink: "https://firebase.google.com/docs/projects/bigquery-export",
  },
  {
    value: "fullstory",
    label: "FullStory",
    types: [
      "bigquery",
      "snowflake",
      "redshift",
      "presto",
      "athena",
      "databricks",
    ],
    logo: "/images/3rd-party-logos/fullstory.png",
    beta: true,
    popular: true,
    helpLink:
      "https://help.fullstory.com/hc/en-us/articles/6295300682903-Data-Destinations",
    // options: [
    //   {
    //     name: "eventName",
    //     label: "Experiment exposure table name",
    //     defaultValue: "experiment_viewed",
    //     type: "text",
    //   },
    // ],
  },
  {
    value: "freshpaint",
    label: "Freshpaint",
    types: [
      "bigquery",
      "postgres",
      "vertica",
      "redshift",
      "snowflake",
      "athena",
      "databricks",
    ],
    logo: "/images/3rd-party-logos/freshpaint.png",
    popular: false,
    helpLink:
      "https://documentation.freshpaint.io/data-management/destinations/warehouses",
    options: [
      {
        name: "exposureTableName",
        label: "Experiment exposure event name",
        defaultValue: "experiment_viewed",
        type: "text",
      },
    ],
  },
  {
    value: "matomo",
    label: "Matomo",
    types: ["mysql"],
    logo: "/images/3rd-party-logos/matomo.png",
    popular: false,
    helpLink: "https://docs.growthbook.io/guide/matomo",
    options: [
      {
        name: "tablePrefix",
        label: "Table prefix",
        defaultValue: "matomo",
        type: "text",
      },
      {
        name: "siteId",
        label: "Site ID",
        defaultValue: 1,
        type: "number",
      },
      {
        name: "actionPrefix",
        label: "Action Value Prefix",
        defaultValue: "v",
        type: "text",
        helpText: "The prefix to use when setting the event action",
      },
      {
        name: "categoryName",
        label: "Category Name",
        defaultValue: "ExperimentViewed",
        type: "text",
        helpText: "The category name set when the experiment is viewed",
      },
    ],
  },
  {
    value: "heap",
    label: "Heap",
    types: [
      "bigquery",
      "redshift",
      "snowflake",
      "presto",
      "athena",
      "databricks",
    ],
    logo: "/images/3rd-party-logos/heap.png",
    popular: false,
    helpLink: "https://help.heap.io/category/integrations/data-warehouses/",
    options: [
      {
        name: "exposureTableName",
        label: "Experiment exposure event name",
        defaultValue: "experiment_viewed",
        type: "text",
      },
    ],
  },
  {
    value: "jitsu",
    label: "Jitsu",
    types: [
      "bigquery",
      "snowflake",
      "athena",
      "redshift",
      "postgres",
      "vertica",
      "clickhouse",
      "mysql",
      "databricks",
    ],
    logo: "/images/3rd-party-logos/jitsu.png",
    popular: false,
    helpLink: "https://docs.jitsu.com/category/warehouses",
    options: [
      {
        name: "exposureTableName",
        label: "Experiment event name",
        defaultValue: "experiment_viewed",
        type: "text",
      },
    ],
  },
  {
    value: "mparticle",
    label: "mParticle",
    types: [
      "bigquery",
      "snowflake",
      "presto",
      "athena",
      "redshift",
      "databricks",
    ],
    logo: "/images/3rd-party-logos/mparticle.png",
    popular: false,
    helpLink:
      "https://docs.mparticle.com/integrations/?category=Business%20Intelligence",
  },
  {
    value: "mixpanel",
    label: "Mixpanel",
    types: ["mixpanel"],
    logo: "/images/3rd-party-logos/mixpanel.png",
    popular: true,
  },
  {
    value: "keen",
    label: "Keen IO",
    types: ["presto", "athena", "databricks"],
    logo: "/images/3rd-party-logos/keen-io.png",
    popular: false,
    helpLink: "https://keen.io/docs/streams/extended-functionality/amazon-s3/",
  },
  {
    value: "clevertap",
    label: "CleverTap",
    types: ["bigquery", "presto", "athena", "databricks"],
    logo: "/images/3rd-party-logos/clevertap.png",
    popular: false,
    helpLink: "https://docs.clevertap.com/docs/export",
  },
];

export const dataSourceConnections: {
  type: DataSourceType;
  display: string;
  icon: ReactElement;
  docs: DocSection;
  default: Partial<DataSourceParams>;
}[] = [
  {
    type: "bigquery",
    display: "BigQuery",
    icon: <SiGooglebigquery />,
    docs: "bigquery",
    default: {
      privateKey: "",
      clientEmail: "",
      projectId: "",
    },
  },
  {
    type: "snowflake",
    display: "Snowflake",
    icon: <SiSnowflake />,
    docs: "snowflake",
    default: {
      account: "",
      username: "",
      password: "",
    },
  },
  {
    type: "databricks",
    display: "Databricks",
    icon: <SiDatabricks />,
    docs: "databricks",
    default: {
      host: "",
      port: 443,
      path: "",
      token: "",
    },
  },
  {
    type: "redshift",
    display: "Redshift",
    icon: <SiAmazonredshift />,
    docs: "redshift",
    default: {
      host: "",
      port: 5439,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "google_analytics",
    display: "Google Analytics",
    icon: <SiGoogleanalytics />,
    docs: "google_analytics",
    default: {
      viewId: "",
      customDimension: "1",
      refreshToken: "",
    },
  },
  {
    type: "athena",
    display: "AWS Athena",
    icon: <GrBarChart />,
    docs: "athena",
    default: {
      bucketUri: "s3://",
      region: "us-east-1",
      database: "",
      catalog: "AwsDataCatalog",
      accessKeyId: "",
      secretAccessKey: "",
      workGroup: "primary",
    },
  },
  {
    type: "presto",
    display: "Presto / Trino",
    icon: <SiPresto />,
    docs: "presto",
    default: {
      engine: "presto",
      host: "",
      port: 8080,
      username: "",
      password: "",
      catalog: "",
      schema: "",
    },
  },
  {
    type: "clickhouse",
    display: "ClickHouse",
    icon: <SiClickhouse />,
    docs: "clickhouse",
    default: {
      url: "",
      port: 8123,
      username: "",
      password: "",
      database: "",
    },
  },
  {
    type: "postgres",
    display: "Postgres",
    icon: <SiPostgresql />,
    docs: "postgres",
    default: {
      host: "",
      port: 5432,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "mysql",
    display: "MySQL / MariaDB",
    icon: <SiMysql />,
    docs: "mysql",
    default: {
      host: "",
      port: 3306,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "vertica",
    display: "Vertica",
    icon: <BsDatabase />,
    docs: "vertica",
    default: {
      host: "",
      port: 5433,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "mssql",
    display: "MS SQL Server",
    icon: <BsDatabase />,
    docs: "mssql",
    default: {
      server: "",
      port: 1433,
      database: "",
      user: "",
      password: "",
      requestTimeout: 120,
      options: {
        trustServerCertificate: true,
        encrypt: true,
      },
    },
  },
  {
    type: "mixpanel",
    display: "Mixpanel",
    icon: <SiMixpanel />,
    docs: "mixpanel",
    default: {
      username: "",
      secret: "",
      projectId: "",
    },
  },
];
