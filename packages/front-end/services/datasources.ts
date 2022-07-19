import {
  DataSourceInterfaceWithParams,
  DataSourceParams,
  DataSourceSettings,
  ExposureQuery,
  SchemaFormat,
  SchemaInterface,
} from "back-end/types/datasource";
import { MetricType } from "back-end/types/metric";

function safeTableName(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^-a-zA-Z0-9_]+/g, "");
}

const GA4Schema: SchemaInterface = {
  experimentDimensions: [
    "country",
    "source",
    "medium",
    "device",
    "browser",
    "os",
  ],
  getExperimentSQL: (tablePrefix, userId) => {
    const userCol = userId === "user_id" ? "user_id" : "user_pseudo_id";

    return `SELECT
  ${userCol} as ${userId},
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
  AND ${userCol} is not null
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["anonymous_id", "user_id"],
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
  getExperimentSQL: (tablePrefix, userId) => {
    const userCol = userId === "user_id" ? "user_id" : "domain_userid";

    return `SELECT
  ${userCol} as ${userId},
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
  AND ${userCol} is not null
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["anonymous_id", "user_id"],
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
  getExperimentSQL: (tablePrefix, userId) => {
    return `SELECT
  ${userId} as ${userId},
  timestamp as timestamp,
  experiment_id as experiment_id,
  variation_id as variation_id
FROM
  ${tablePrefix}viewed_experiment`;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["user_id"],
  getMetricSQL: (name, type, tablePrefix) => {
    return `SELECT
  user_id as user_id,
  timestamp as timestamp${
    type === "revenue"
      ? ",\n  revenue as value"
      : type === "binomial"
      ? ""
      : `,\n  value as value`
  }
FROM
  ${tablePrefix}${safeTableName(name)}`;
  },
};

const AmplitudeSchema: SchemaInterface = {
  experimentDimensions: ["country", "device", "os", "paying"],
  getExperimentSQL: (tablePrefix, userId) => {
    const userCol = userId === "user_id" ? "user_id" : "$amplitude_id";

    return `SELECT
  ${userCol} as ${userId},
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
  AND ${userCol} is not null
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["anonymous_id", "user_id"],
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
  getExperimentSQL: (tablePrefix, userId) => {
    return `SELECT
  ${userId},
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
  ${tablePrefix}experiment_viewed
WHERE
  ${userId} is not null`;
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
  userIdTypes: ["anonymous_id", "user_id"],
  getMetricSQL: (name, type, tablePrefix) => {
    return `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp${type === "binomial" ? "" : ",\n  value as value"}
FROM
  ${tablePrefix}${safeTableName(name)}`;
  },
};

const RudderstackSchema: SchemaInterface = {
  experimentDimensions: ["device", "browser"],
  getExperimentSQL: (tablePrefix, userId) => {
    return `SELECT
  ${userId},
  received_at as timestamp,
  experiment_id,
  variation_id,
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
  ${tablePrefix}experiment_viewed
WHERE
  ${userId} is not null`;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["anonymous_id"],
  getMetricSQL: (name, type, tablePrefix) => {
    return `SELECT
  anonymous_id,
  received_at as timestamp${type === "binomial" ? "" : ",\n  value as value"}
FROM
  ${tablePrefix}${safeTableName(name)}`;
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
  if (type === "segment") {
    return SegmentSchema;
  }
  if (type === "rudderstack") {
    return RudderstackSchema;
  }

  return CustomSchema;
}

function getTablePrefix(params: DataSourceParams) {
  // Postgres / Redshift
  if ("defaultSchema" in params && params.defaultSchema) {
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
) {
  const schema = getSchemaObject(type);
  const userIdTypes = schema.userIdTypes;
  return {
    userIdTypes: userIdTypes.map((type) => {
      return {
        userIdType: type,
        description:
          type === "user_id"
            ? "Logged-in user id"
            : type === "anonymous_id"
            ? "Anonymous visitor id"
            : "",
      };
    }),
    queries: {
      exposure: userIdTypes.map((id) => ({
        id,
        userIdType: id,
        dimensions: schema.experimentDimensions,
        name:
          id === "user_id"
            ? "Logged-in Users"
            : id === "anonymous_id"
            ? "Anonymous Visitors"
            : id,
        description: "",
        query: schema.getExperimentSQL(getTablePrefix(params), id),
      })),
      identityJoins: schema.getIdentitySQL(getTablePrefix(params)),
    },
  };
}

export function getExposureQuery(
  settings?: DataSourceSettings,
  exposureQueryId?: string,
  userIdType?: string
): ExposureQuery | null {
  const queries = settings?.queries?.exposure || [];

  if (!exposureQueryId) {
    exposureQueryId = userIdType === "user" ? "user_id" : "anonymous_id";
  }
  return queries.find((q) => q.id === exposureQueryId) ?? null;
}

export function getInitialMetricQuery(
  datasource: DataSourceInterfaceWithParams,
  type: MetricType,
  name: string
): [string[], string] {
  const schema = getSchemaObject(datasource.settings?.schemaFormat);

  return [
    schema.userIdTypes,
    schema.getMetricSQL(name, type, getTablePrefix(datasource.params)),
  ];
}
