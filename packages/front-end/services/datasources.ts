import {
  DataSourceInterfaceWithParams,
  DataSourceParams,
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
  experiment_id_param.value.string_value AS experiment_id,
  variation_id_param.value.int_value AS variation_id,
  geo.country as country,
  traffic_source.source as source,
  traffic_source.medium as medium,
  device.category as device,
  device.web_info.browser as browser,
  device.operating_system as os
FROM
  ${tablePrefix}\`events_*\`,
  UNNEST(event_params) AS experiment_id_param,
  UNNEST(event_params) AS variation_id_param
WHERE
  _TABLE_SUFFIX BETWEEN '{{startYear}}{{startMonth}}{{startDay}}' AND '{{endYear}}{{endMonth}}{{endDay}}'
  AND event_name = 'viewed_experiment'  
  AND experiment_id_param.key = 'experiment_id'
  AND variation_id_param.key = 'variation_id'
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  metricUserIdType: "either",
  getMetricSQL: (name, type, tablePrefix) => {
    return `SELECT
  user_id,
  user_pseudo_id as anonymous_id,
  TIMESTAMP_MICROS(event_timestamp) as timestamp${
    type === "revenue"
      ? ",\n  event_value_in_usd as value"
      : type === "binomial"
      ? ""
      : `,\n  value_param.value.${type === "count" ? "int" : "float"}_value`
  }
FROM
  ${tablePrefix}\`events_*\`${
      type === "count" || type === "duration"
        ? `,
  UNNEST(event_params) AS value_param`
        : ""
    }
WHERE
  event_name = '${name}'  
  AND value_param.key = 'value'
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
  metricUserIdType: "either",
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

const CustomSchema: SchemaInterface = {
  experimentDimensions: [],
  getExperimentSQL: (tablePrefix) => {
    return `SELECT
  user_id as user_id,
  anonymous_id as anonymous_id,
  timestamp as timestamp,
  experiment_id as experiment_id,
  variation_id as variation_id
FROM
  ${tablePrefix}viewed_experiment`;
  },
  getIdentitySQL: () => {
    return [];
  },
  metricUserIdType: "either",
  getMetricSQL: (name, type, tablePrefix) => {
    return `SELECT
  user_id,
  anonymous_id as anonymous_id,
  timestamp as timestamp${
    type === "revenue"
      ? ",\n  revenue as value"
      : type === "binomial"
      ? ""
      : `,\n  value as value`
  }
FROM
  ${tablePrefix}${name.toLowerCase().replace(/\s*/g, "_")}`;
  },
};

const AmplitudeSchema: SchemaInterface = {
  experimentDimensions: ["country", "device", "os", "paying"],
  getExperimentSQL: (tablePrefix) => {
    return `SELECT
  user_id,
  $amplitude_id as anonymous_id,
  event_time as timestamp,
  event_properties:experiment_id as experiment_id,
  event_properties:variation_id as variation_id,
  device_family as device,
  os_name as os,
  country,
  paying
FROM
  ${tablePrefix}$events
WHERE
  event_type = 'Experiment Viewed'
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  metricUserIdType: "either",
  getMetricSQL: (name, type, tablePrefix) => {
    return `SELECT
  user_id,
  $amplitude_id as anonymous_id,
  event_time as timestamp${
    type === "revenue"
      ? ",\n  event_properties:revenue as value"
      : type === "binomial"
      ? ""
      : `,\n  event_properties:value as value`
  }
FROM
  ${tablePrefix}$events
WHERE
  event_type = '${name}'
    `;
  },
};

const SegmentSchema: SchemaInterface = {
  experimentDimensions: ["source", "medium", "device", "browser"],
  getExperimentSQL: (tablePrefix) => {
    return `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp,
  experiment_id,
  variation_id,
  context_campaign_source as source,
  context_campaign_medium as medium,
  (CASE
    WHEN context_user_agent LIKE '%Mobile%' THEN 'Mobile'
    ELSE 'Tablet/Desktop' END
  ) as device,
  (CASE 
    WHEN context_user_agent LIKE '% Firefox%' THEN 'Firefox'
    WHEN context_user_agent LIKE '% OPR%' THEN 'Opera'
    WHEN context_user_agent LIKE '% Edg%' THEN ' Edge' 
    WHEN context_user_agent LIKE '% Chrome%' THEN 'Chrome'
    WHEN context_user_agent LIKE '% Safari%' THEN 'Safari'
    ELSE 'Other' END
  ) as browser
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
  metricUserIdType: "either",
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
  if (type === "amplitude") {
    return AmplitudeSchema;
  }
  if (type === "segment" || type === "rudderstack") {
    return SegmentSchema;
  }

  return CustomSchema;
}

function getTablePrefix(params: DataSourceParams) {
  // Postgres / Redshift
  if ("defaultSchema" in params) {
    return params.defaultSchema + ".";
  }
  // BigQuery
  else if ("defaultProject" in params) {
    return (
      "`" +
      (params.defaultProject || "my_project") +
      "`.`" +
      (params.defaultDataset || "my_dataset") +
      "`."
    );
  }
  // Snowflake
  else if ("warehouse" in params) {
    return (
      (params.database || "MY_DB") + "." + (params.schema || "PUBLIC") + "."
    );
  }
  // PrestoDB
  else if ("catalog" in params) {
    return `${params.catalog ? params.catalog + "." : ""}${
      params.schema || "public"
    }.`;
  }

  return "";
}

export function getInitialSettings(
  type: SchemaFormat,
  params: DataSourceParams
): Partial<DataSourceSettings> {
  const schema = getSchemaObject(type);
  return {
    experimentDimensions: schema.experimentDimensions,
    queries: {
      experimentsQuery: schema.getExperimentSQL(getTablePrefix(params)),
      identityJoins: schema.getIdentitySQL(getTablePrefix(params)),
    },
  };
}

export function getInitialMetricQuery(
  datasource: DataSourceInterfaceWithParams,
  type: MetricType,
  name: string
): ["user" | "anonymous" | "either", string] {
  const schema = getSchemaObject(datasource.settings?.schemaFormat);

  return [
    schema.metricUserIdType,
    schema.getMetricSQL(name, type, getTablePrefix(datasource.params)),
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
