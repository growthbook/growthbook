import {
  DataSourceParams,
  DataSourceType,
  SchemaFormat,
  SchemaOption,
} from "back-end/types/datasource";
import { ReactElement } from "react";

export type eventSchema = {
  value: SchemaFormat;
  label: string;
  types?: DataSourceType[];
  options?: SchemaOption[];
  logo?: string;
  intro?: ReactElement;
  popular?: boolean;
};

export const eventSchemas: eventSchema[] = [
  {
    value: "segment",
    label: "Segment",
    types: [
      "bigquery",
      "snowflake",
      "athena",
      "redshift",
      "postgres",
      "databricks",
      "athena",
    ],
    logo: "/images/3rd-party-logos/segment.png",
    popular: true,
    intro: (
      <>
        Connect to your data warehouse where your Segment data is stored.
        GrowthBook is not a destination for your Segment data, instead, we query
        data from your data warehouse. Segment supports many data warehouses as
        a destination.
      </>
    ),
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
      "databricks",
      "athena",
      "clickhouse",
      "mssql",
    ],
    logo: "/images/3rd-party-logos/rudderstack.png",
    popular: true,
    intro: (
      <>
        Connect to your data warehouse where your Rudderstack data is stored.
        Rudderstack supports many data warehouses as a destination, you can read
        a{" "}
        <a
          target="_blank"
          href="https://docs.growthbook.io/guide/rudderstack"
          rel="noreferrer"
        >
          step by step guide here
        </a>
        .
      </>
    ),
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
    value: "mixpanel",
    label: "Mixpanel",
    types: ["mixpanel"],
    logo: "/images/3rd-party-logos/mixpanel.png",
    popular: true,
    intro: (
      <>
        Connect to your Mixpanel instance below. You can find a step by step
        guide{" "}
        <a
          target="_blank"
          href="https://docs.growthbook.io/guide/mixpanel"
          rel="noreferrer"
        >
          here
        </a>
        .
      </>
    ),
  },
  {
    value: "snowplow",
    label: "Snowplow",
    types: [
      "redshift",
      "bigquery",
      "postgres",
      "athena",
      "snowflake",
      "databricks",
    ],
    logo: "/images/3rd-party-logos/snowplow.png",
    popular: true,
    intro: (
      <>
        Snowplow works with many data warehouses. Connect to your data warehouse
        you use with Snowplow below. (read more about{" "}
        <a
          target="_blank"
          href="https://docs.snowplowanalytics.com/docs/pipeline-components-and-applications/loaders-storage-targets/"
          rel="noreferrer"
        >
          Snowplows data destinations
        </a>
        )
      </>
    ),
  },
  {
    value: "amplitude",
    label: "Amplitude",
    types: ["snowflake", "bigquery", "redshift", "athena", "databricks"],
    logo: "/images/3rd-party-logos/amplitude.png",
    popular: true,
    intro: (
      <div>
        Unfortunately, Amplitude does not let us directly query your data. To
        get around this limitation, you first must export Amplitude data to the
        data warehouse of your choice. You can read more about it{" "}
        <a
          target="_blank"
          href="https://help.amplitude.com/hc/en-us/sections/203209607-Export-your-Amplitude-data"
          rel="noreferrer"
        >
          on Amplitudes help pages
        </a>
      </div>
    ),
    options: [
      {
        name: "eventType",
        label: "Experiment event type",
        defaultValue: "Experiment Viewed",
        type: "text",
      },
    ],
  },
  {
    value: "ga4",
    label: "Google Analytics v4",
    types: ["bigquery"],
    logo: "/images/3rd-party-logos/ga4.png",
    popular: true,
    intro: (
      <>
        Google Analytics v4 is a new version of Google Analytics that makes it
        easy to export events to a BigQuery data warehouse on Google Cloud
        Platform (GCP). Using BigQuery with your GA4 data makes it easy to use
        with GrowthBook. You can{" "}
        <a
          target="_blank"
          href="https://support.google.com/analytics/answer/9358801?hl=en"
          rel="noreferrer"
        >
          read more about it here
        </a>
        .
      </>
    ),
  },
  {
    value: "firebase",
    label: "Firebase",
    types: ["bigquery"],
    logo: "/images/3rd-party-logos/firebase.png",
    popular: false,
    intro: (
      <>
        You can export Firebase data to BigQuery, and then use that with
        GrowthBook. You can read about how to export{" "}
        <a
          target="_blank"
          href="https://firebase.google.com/docs/projects/bigquery-export"
          rel="noreferrer"
        >
          your data to BigQuery here
        </a>
        , or read about how to set up{" "}
        <a
          target="_blank"
          href="https://docs.growthbook.io/guide/bigquery"
          rel="noreferrer"
        >
          BigQuery to work with GrowthBook
        </a>
        .
      </>
    ),
  },
  {
    value: "gaua",
    label: "Google Analytics UA",
    types: ["google_analytics"],
    logo: "/images/3rd-party-logos/gaua.png",
    popular: false,
    intro: (
      <>
        Keep in mind that there are some limitations with using GA UA as data
        source; namely it only supports running one experiment at a time. Using
        GA4 (or any other supported event tracking) as a data source provides
        more flexibility and has no limits.{" "}
        <a
          target="_blank"
          href="https://docs.growthbook.io/guide/GA-universal-analytics"
          rel="noreferrer"
        >
          Read more about it here
        </a>
        .
      </>
    ),
  },
  {
    value: "freshpaint",
    label: "Freshpaint",
    types: [
      "bigquery",
      "postgres",
      "redshift",
      "snowflake",
      "athena",
      "databricks",
    ],
    logo: "/images/3rd-party-logos/freshpaint.png",
    popular: false,
    intro: (
      <>
        Freshpaint supports{" "}
        <a
          target="_blank"
          href="https://documentation.freshpaint.io/data-management/destinations/warehouses"
          rel="noreferrer"
        >
          numerous data warehouse destinations
        </a>
        . Once you have one set up, GrowthBook can use it for experiment
        analytics.
      </>
    ),
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
    intro: (
      <>
        GrowthBook connect to the MySQL/MariaDB database you&apos;re using with
        Matomo. You can read about{" "}
        <a
          target="_blank"
          href="https://docs.growthbook.io/guide/matomo"
          rel="noreferrer"
        >
          setting up GrowthBook with Matomo here
        </a>
        .
      </>
    ),
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
    types: ["bigquery", "redshift", "snowflake", "athena", "databricks"],
    logo: "/images/3rd-party-logos/heap.png",
    popular: false,
    intro: (
      <>
        GrowthBook cannot directly query data stored in Heap Analytics, but
        fortunately Heap Analytics allows you to easily export data to a number
        of data warehouses, which you can use with GrowthBook. You can{" "}
        <a
          target="_blank"
          href="https://help.heap.io/category/integrations/data-warehouses/"
          rel="noreferrer"
        >
          read about their data export here
        </a>
        .
      </>
    ),
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
      "clickhouse",
      "mysql",
      "databricks",
    ],
    logo: "/images/3rd-party-logos/jitsu.png",
    popular: false,
    intro: (
      <>
        GrowthBook integrates with the destination data warehouse you create
        within Jitsu. You can read about setting up a{" "}
        <a
          target="_blank"
          href="https://jitsu.com/docs/destinations-configuration"
          rel="noreferrer"
        >
          warehouse destination here
        </a>
        .
      </>
    ),
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
    types: ["bigquery", "snowflake", "athena", "redshift", "databricks"],
    logo: "/images/3rd-party-logos/mparticle.png",
    popular: false,
    intro: (
      <>
        GrowthBook integrates with the destination data warehouse you create
        within mParticle. You can read about setting up a{" "}
        <a
          target="_blank"
          href="https://docs.mparticle.com/integrations/?category=Raw%20Data%20Export"
          rel="noreferrer"
        >
          warehouse destination here
        </a>
        . Please contact us for help setting up the initial queries.
      </>
    ),
  },
  {
    value: "keen",
    label: "Keen IO",
    types: ["athena", "databricks"],
    logo: "/images/3rd-party-logos/keen-io.png",
    popular: false,
    intro: (
      <>
        GrowthBook integrates with the S3 destination warehouse you create
        within Keen. You can read about setting up a{" "}
        <a
          target="_blank"
          href="https://keen.io/docs/streams/extended-functionality/amazon-s3/"
          rel="noreferrer"
        >
          warehouse destination here
        </a>
        . Please contact us for help setting up the initial queries.
      </>
    ),
  },
  {
    value: "clevertap",
    label: "CleverTap",
    types: ["bigquery", "athena", "databricks"],
    logo: "/images/3rd-party-logos/clevertap.png",
    popular: false,
    intro: (
      <>
        GrowthBook works with the raw event data you can export from CleverTap.
        CleverTap has built in support to export to S3 (athena) and BigQuery.
        You can{" "}
        <a
          target="_blank"
          href="https://docs.clevertap.com/docs/export"
          rel="noreferrer"
        >
          read about this here
        </a>
        . Please contact us for help setting up the initial queries.
      </>
    ),
  },
];

export const dataSourceConnections: {
  type: DataSourceType;
  display: string;
  default: Partial<DataSourceParams>;
}[] = [
  {
    type: "redshift",
    display: "Redshift",
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
    default: {
      viewId: "",
      customDimension: "1",
      refreshToken: "",
    },
  },
  {
    type: "athena",
    display: "AWS Athena",
    default: {
      bucketUri: "s3://",
      region: "us-east-1",
      database: "",
      accessKeyId: "",
      secretAccessKey: "",
      workGroup: "primary",
    },
  },
  {
    type: "presto",
    display: "PrestoDB or Trino",
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
    type: "databricks",
    display: "Databricks",
    default: {
      host: "",
      port: 443,
      path: "",
      token: "",
    },
  },
  {
    type: "snowflake",
    display: "Snowflake",
    default: {
      account: "",
      username: "",
      password: "",
    },
  },
  {
    type: "postgres",
    display: "Postgres",
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
    display: "MySQL or MariaDB",
    default: {
      host: "",
      port: 3306,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "mssql",
    display: "MS SQL or SQL Server",
    default: {
      server: "",
      port: 1433,
      database: "",
      user: "",
      password: "",
      options: {
        trustServerCertificate: true,
        encrypt: true,
      },
    },
  },
  {
    type: "bigquery",
    display: "BigQuery",
    default: {
      privateKey: "",
      clientEmail: "",
      projectId: "",
    },
  },
  {
    type: "clickhouse",
    display: "ClickHouse",
    default: {
      url: "",
      port: 8123,
      username: "",
      password: "",
      database: "",
    },
  },
  {
    type: "mixpanel",
    display: "Mixpanel",
    default: {
      username: "",
      secret: "",
      projectId: "",
    },
  },
];
