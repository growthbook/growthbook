import {
  DataSourceInterface,
  DataSourceSettings,
  SchemaFormat,
  SchemaInterface,
} from "back-end/types/datasource";
import { MetricType } from "back-end/types/metric";

const GA4Schema: SchemaInterface = {
  experimentDimensions: [
    "country",
    "source",
    "medium",
    "device",
    "browser",
    "os",
  ],
  getExperimentSQL: (tablePrefix) => {
    return `SELECT
  user_id,
  user_pseudo_id as anonymous_id,
  TIMESTAMP_MICROS(event_timestamp) as timestamp,
  (
    SELECT p.value.string_value 
    FROM UNNEST(event_params) as p 
    WHERE p.key = 'experiment_id' LIMIT 1
  ) as experiment_id,
  (
    SELECT p.value.string_value 
    FROM UNNEST(event_params) as p 
    WHERE p.key = 'variation_id' LIMIT 1
  ) as variation_id,
  geo.country as country,
  traffic_source.source as source,
  traffic_source.medium as medium,
  device.category as device,
  device.web_info.browser as browser,
  device.operating_system as os
FROM
  ${tablePrefix}\`events_*\`
WHERE
  event_name = 'viewed_experiment'  
  AND _TABLE_SUFFIX BETWEEN '{{startYear}}{{startMonth}}{{startDay}}' AND '{{endYear}}{{endMonth}}{{endDay}}'
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  metricUserIdType: "both",
  getMetricSQL: (name, type, tablePrefix) => {
    return `SELECT
  user_id,
  user_pseudo_id as anonymous_id,
  TIMESTAMP_MICROS(event_timestamp) as timestamp${
    type === "revenue"
      ? ",\n  event_value_in_usd as value"
      : type === "binomial"
      ? ""
      : `,
  (
    SELECT p.value.${type === "count" ? "int" : "float"}_value
    FROM UNNEST(event_params) as p
    WHERE p.key = 'value'
  )`
  }
FROM
  ${tablePrefix}\`events_*\`
WHERE
  event_name = '${name}'  
  AND _TABLE_SUFFIX BETWEEN '{{startYear}}{{startMonth}}{{startDay}}' AND '{{endYear}}{{endMonth}}{{endDay}}'
    `;
  },
};

const SnowplowSchema: SchemaInterface = {
  experimentDimensions: [
    "country",
    "source",
    "medium",
    "device",
    "browser",
    "os",
  ],
  getExperimentSQL: (tablePrefix) => {
    return `SELECT
  user_id,
  domain_userid as anonymous_id,
  collector_tstamp as timestamp,
  se_label as experiment_id,
  se_property as variation_id,
  dvce_type as device,
  os_name as os,
  geo_country as country,
  mkt_source as source,
  mkt_medium as medium,
  br_family as browser
FROM
  ${tablePrefix}events
WHERE
  se_action = 'Experiment Viewed'
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  metricUserIdType: "both",
  getMetricSQL: (name, type, tablePrefix) => {
    return `SELECT
  user_id,
  domain_userid as anonymous_id,
  collector_tstamp as timestamp${
    type === "revenue"
      ? ",\n  tr_total as value"
      : type === "binomial"
      ? ""
      : `,\n  se_value as value`
  }
FROM
  ${tablePrefix}events
WHERE
  ${type === "revenue" ? "event_name = 'transaction'" : `se_action = '${name}'`}
    `;
  },
};

const SegmentSchema: SchemaInterface = {
  experimentDimensions: ["country"],
  getExperimentSQL: (tablePrefix) => {
    return `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp,
  experiment_id,
  variation_id,
  context_location_country as country
FROM
  ${tablePrefix}experiment_viewed`;
  },
  getIdentitySQL: (tablePrefix) => {
    return [
      {
        ids: ["user_id", "anonymous_id"],
        query: `SELECT
  user_id,
  anonymous_id
FROM
  ${tablePrefix}identifies`,
      },
    ];
  },
  metricUserIdType: "both",
  getMetricSQL: (name, type, tablePrefix) => {
    return `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp${type === "binomial" ? "" : ",\n  value as value"}
FROM
  ${tablePrefix}${name.toLowerCase().replace(/\s*/g, "_")}`;
  },
};

function getSchemaObject(type?: SchemaFormat) {
  if (type === "ga4") {
    return GA4Schema;
  }
  if (type === "snowplow") {
    return SnowplowSchema;
  }

  return SegmentSchema;
}

export function getInitialSettings(
  type: SchemaFormat,
  tablePrefix: string = ""
): Partial<DataSourceSettings> {
  const schema = getSchemaObject(type);

  return {
    experimentDimensions: schema.experimentDimensions,
    queries: {
      experimentsQuery: schema.getExperimentSQL(tablePrefix),
      identityJoins: schema.getIdentitySQL(tablePrefix),
    },
  };
}

export function getInitialMetricQuery(
  datasource: DataSourceInterface,
  type: MetricType,
  name: string
): ["user" | "anonymous" | "both", string] {
  const schema = getSchemaObject(datasource.settings?.schemaFormat);

  return [
    schema.metricUserIdType,
    schema.getMetricSQL(name, type, datasource.settings?.tablePrefix || ""),
  ];
}

export function getExperimentQuery(
  settings: DataSourceSettings,
  schema?: string
): string {
  if (settings?.queries?.experimentsQuery) {
    return settings.queries.experimentsQuery;
  }

  return `SELECT
  ${
    settings?.experiments?.userIdColumn ||
    settings?.default?.userIdColumn ||
    "user_id"
  } as user_id,
  ${
    settings?.experiments?.anonymousIdColumn ||
    settings?.default?.anonymousIdColumn ||
    "anonymous_id"
  } as anonymous_id,
  ${
    settings?.experiments?.timestampColumn ||
    settings?.default?.timestampColumn ||
    "received_at"
  } as timestamp,
  ${
    settings?.experiments?.experimentIdColumn || "experiment_id"
  } as experiment_id,
  ${settings?.experiments?.variationColumn || "variation_id"} as variation_id
FROM 
  ${schema && !settings?.experiments?.table?.match(/\./) ? schema + "." : ""}${
    settings?.experiments?.table || "experiment_viewed"
  }`;
}
