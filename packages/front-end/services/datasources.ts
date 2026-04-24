import {
  DataSourceInterfaceWithParams,
  DataSourceParams,
  DataSourceSettings,
  ExposureQuery,
  SchemaFormat,
  SchemaInterface,
} from "shared/types/datasource";
import { MetricType } from "shared/types/metric";

function camelToUnderscore(orig: string) {
  return orig
    .replace(/\s+/g, "_")
    .replace(/([A-Z]+)([A-Z][a-z])/, "$1_$2")
    .replace(/([a-z\d])([A-Z])/, "$1_$2")
    .replace("-", "_")
    .toLowerCase();
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
  ((_TABLE_SUFFIX BETWEEN '{{date startDateISO "yyyyMMdd"}}' AND '{{date endDateISO "yyyyMMdd"}}') OR
   (_TABLE_SUFFIX BETWEEN 'intraday_{{date startDateISO "yyyyMMdd"}}' AND 'intraday_{{date endDateISO "yyyyMMdd"}}'))
  AND event_name = 'experiment_viewed'
  AND experiment_id_param.key = 'experiment_id'
  AND variation_id_param.key = 'variation_id'
  AND ${userCol} is not null
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["anonymous_id", "user_id"],
  getMetricSQL: (type, tablePrefix) => {
    const joinValueParams = type === "count" || type === "duration";

    return `SELECT
  user_id,
  user_pseudo_id as anonymous_id,
  TIMESTAMP_MICROS(event_timestamp) as timestamp${
    type === "revenue"
      ? ",\n  event_value_in_usd as value"
      : type === "binomial"
        ? ""
        : `,\n  value_param.value.${
            type === "count" ? "int" : "float"
          }_value as value`
  }
FROM
  ${tablePrefix}\`events_*\`${
    joinValueParams ? `,\n  UNNEST(event_params) AS value_param` : ""
  }
WHERE
  event_name = '{{eventName}}'${
    joinValueParams ? `\n  AND value_param.key = 'value'` : ""
  }
  AND ((_TABLE_SUFFIX BETWEEN '{{date startDateISO "yyyyMMdd"}}' AND '{{date endDateISO "yyyyMMdd"}}') OR
       (_TABLE_SUFFIX BETWEEN 'intraday_{{date startDateISO "yyyyMMdd"}}' AND 'intraday_{{date endDateISO "yyyyMMdd"}}'))
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
  getExperimentSQL: (tablePrefix, userId, options) => {
    const actionName = options?.actionName || "Experiment Viewed";
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
  se_action = '${actionName}'
  AND ${userCol} is not null
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["anonymous_id", "user_id"],
  getMetricSQL: (type, tablePrefix) => {
    return `SELECT
  user_id,
  domain_userid as anonymous_id,
  collector_tstamp as timestamp${
    type === "revenue"
      ? ",\n  tr_total as value"
      : type === "binomial"
        ? ""
        : type === "count"
          ? ",\n  1 as value"
          : `,\n  se_value as value`
  }
FROM
  ${tablePrefix}events
WHERE
  ${
    type === "revenue"
      ? "event_name = 'transaction'"
      : `se_action = '{{eventName}}'`
  }
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
  getMetricSQL: (type, tablePrefix) => {
    return `SELECT
  user_id as user_id,
  timestamp as timestamp${
    type === "revenue"
      ? ",\n  revenue as value"
      : type === "binomial"
        ? ""
        : `,\n  {{valueColumn}} as value`
  }
FROM
  ${tablePrefix}{{snakecase eventName}}`;
  },
};

const AmplitudeSchema: SchemaInterface = {
  experimentDimensions: ["country", "device", "os", "paying"],
  getExperimentSQL: (tablePrefix, userId, options) => {
    const userCol = userId === "user_id" ? "user_id" : "amplitude_id";
    const eventType = options?.eventType || "Experiment Viewed";
    const projectId = options?.projectId || "AMPLITUDE_PROJECT_ID";

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
  ${tablePrefix}EVENTS_${projectId}
WHERE
  event_type = '${eventType}'
  AND ${userCol} is not null
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["anonymous_id", "user_id"],
  getMetricSQL: (type, tablePrefix) => {
    return `SELECT
  user_id,
  amplitude_id as anonymous_id,
  event_time as timestamp${
    type === "revenue"
      ? ",\n  event_properties:revenue as value"
      : type === "binomial"
        ? ""
        : type === "count"
          ? ",\n  1 as value"
          : `,\n  event_properties:value as value`
  }
FROM
  ${tablePrefix}EVENTS_AMPLITUDE_PROJECT_ID
WHERE
  event_type = '{{eventName}}'
    `;
  },
};

const SegmentSchema: SchemaInterface = {
  experimentDimensions: ["source", "medium", "device", "browser"],
  getExperimentSQL: (tablePrefix, userId, options) => {
    const exposureTableName =
      camelToUnderscore(options?.exposureTableName || "") ||
      "experiment_viewed";
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
  ${tablePrefix}${exposureTableName}
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
  getMetricSQL: (type, tablePrefix) => {
    return `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp${
    type === "binomial" ? "" : ",\n  {{valueColumn}} as value"
  }
FROM
  ${tablePrefix}{{snakecase eventName}}`;
  },
};

const RudderstackSchema: SchemaInterface = {
  experimentDimensions: ["device", "browser"],
  getExperimentSQL: (tablePrefix, userId, options) => {
    const exposureTableName =
      camelToUnderscore(options?.exposureTableName || "") ||
      "experiment_viewed";
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
  ${tablePrefix}${exposureTableName}
WHERE
  ${userId} is not null`;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["anonymous_id"],
  getMetricSQL: (type, tablePrefix) => {
    return `SELECT
  anonymous_id,
  received_at as timestamp${
    type === "binomial" ? "" : ",\n  {{valueColumn}} as value"
  }
FROM
  ${tablePrefix}{{snakecase eventName}}`;
  },
};

const MatomoSchema: SchemaInterface = {
  experimentDimensions: ["device", "OS", "country"],
  getExperimentSQL: (tablePrefix, userId, options) => {
    const tPrefix = options?.tablePrefix || tablePrefix;
    const actionPrefix = "" + options?.actionPrefix || "v";
    const variationPrefixLength = actionPrefix.length;
    const siteId = options?.siteId || "1";
    const categoryName = options?.categoryName || "ExperimentViewed";
    const userStr =
      userId === "user_id"
        ? `visit.user_id`
        : `conv(hex(events.idvisitor), 16, 16)`;
    return `SELECT
  ${userStr} as ${userId},
  events.server_time as timestamp,
  experiment.name as experiment_id,
  SUBSTRING(variation.name, ${variationPrefixLength + 1}) as variation_id,
  visit.config_device_model as device,
  visit.config_os as OS,
  visit.location_country as country
FROM ${tPrefix}_log_link_visit_action events
INNER JOIN ${tPrefix}_log_action experiment
  ON(events.idaction_event_action = experiment.idaction AND experiment.\`type\` = 11)
INNER JOIN ${tPrefix}_log_action variation
  ON(events.idaction_name = variation.idaction AND variation.\`type\` = 12)
INNER JOIN ${tPrefix}_log_visit visit
  ON (events.idvisit = visit.idvisit)
WHERE events.idaction_event_category = (SELECT idaction FROM ${tPrefix}_log_action mla1 WHERE mla1.name = "${categoryName}" AND mla1.type = 10)
   AND SUBSTRING(variation.name, ${variationPrefixLength + 1}) != ""
   AND ${userStr} is not null
   AND events.idsite = ${siteId}`;
  },
  getIdentitySQL: (tablePrefix, options) => {
    const tPrefix = options?.tablePrefix || tablePrefix;
    return [
      {
        ids: ["user_id", "anonymous_id"],
        query: `SELECT
  user_id,
  conv(hex(idvisitor), 16, 16) as anonymous_id
FROM
  ${tPrefix}_log_visit`,
      },
    ];
  },
  userIdTypes: ["anonymous_id", "user_id"],
  getMetricSQL: (type, tablePrefix) => {
    return `SELECT
  conv(hex(events.idvisitor), 16, 16) as anonymous_id,
  server_time as timestamp${
    type === "binomial" ? "" : ",\n  {{valueColumn}} as value"
  }
FROM
  ${tablePrefix}_log_link_visit_action`;
  },
};

const FreshpaintSchema: SchemaInterface = {
  experimentDimensions: ["source", "medium", "campaign", "os", "browser"],
  getExperimentSQL: (tablePrefix, userId, options) => {
    const exposureTableName =
      camelToUnderscore(options?.exposureTableName || "") ||
      "experiment_viewed";
    return `SELECT
  ${userId},
  time as timestamp,
  experiment_id,
  variation_id,
  utm_source as source,
  utm_medium as medium,
  utm_campaign as campaign,
  operating_system as os,
  browser
FROM
  ${tablePrefix}${exposureTableName}
WHERE
  ${userId} is not null`;
  },
  getIdentitySQL: (tablePrefix) => {
    return [
      {
        ids: ["user_id", "device_id"],
        query: `SELECT
  user_id,
  anonymous_id as device_id
FROM
  ${tablePrefix}identifies`,
      },
    ];
  },
  userIdTypes: ["device_id", "user_id"],
  getMetricSQL: (type, tablePrefix) => {
    return `SELECT
  user_id,
  device_id,
  sent_at as timestamp${
    type === "binomial" ? "" : ",\n  {{valueColumn}} as value"
  }
FROM
  ${tablePrefix}{{snakecase eventName}}`;
  },
};

const HeapSchema: SchemaInterface = {
  experimentDimensions: [
    "source",
    "medium",
    "campaign",
    "platform",
    "os",
    "country",
    "browser",
  ],
  getExperimentSQL: (tablePrefix, userId, options) => {
    const exposureTableName =
      camelToUnderscore(options?.exposureTableName || "") ||
      "experiment_viewed";
    return `SELECT
  ${userId},
  time as timestamp,
  experiment_id,
  variation_id,
  platform as os,
  device_type as platform,
  country
  utm_source as source,
  utm_medium as medium,
  utm_campaign as campaign,
  browser
FROM
  ${tablePrefix}${exposureTableName}
WHERE
  ${userId} is not null`;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["user_id"],
  getMetricSQL: (type, tablePrefix) => {
    return `SELECT
  user_id,
  sent_at as timestamp${
    type === "binomial" ? "" : ",\n  {{valueColumn}} as value"
  }
FROM
  ${tablePrefix}{{snakecase eventName}}`;
  },
};

const FullStorySchema: SchemaInterface = {
  experimentDimensions: ["source"],
  getExperimentSQL: (tablePrefix, userId) => {
    // const exposureTableName =
    //   camelToUnderscore(options?.exposureTableName || "") || "experiment_viewed";
    return `
-- Modify the below query to match your exported data
SELECT
  ${userId},
  TIMESTAMP_MICROS(event_time) as timestamp,
  experiment_id_param.value.string_value AS experiment_id,
  variation_id_param.value.int_value AS variation_id,
  source_type as source
FROM
  ${tablePrefix}\`events_ *\`,
  UNNEST(event_properties) AS exp_event_properties,
  UNNEST(exp_event_properties.event_properties) AS experiment_id_param
  UNNEST(exp_event_properties.event_properties) AS variation_id_param
WHERE
  _TABLE_SUFFIX BETWEEN '{{date startDateISO "yyyyMMdd"}}' AND '{{date endDateISO "yyyyMMdd"}}'
  AND event_type = 'custom'
  AND exp_event_properties.event_name = 'experiment_viewed'
  AND experiment_id_param.key = 'experiment_id'
  AND variation_id_param.key = 'variation_id'
  AND ${userId} is not null
  `;
  },
  getIdentitySQL: () => {
    return [];
  },
  userIdTypes: ["device_id"],
  getMetricSQL: (type, tablePrefix) => {
    return `SELECT
  device_id,
  TIMESTAMP_MICROS(event_time) as timestamp${
    type === "binomial" ? "" : ",\n  {{valueColumn}} as value"
  }
  FROM
    ${tablePrefix}{{snakecase eventName}}`;
  },
};

function getSchemaObject(type?: SchemaFormat) {
  if (type === "ga4" || type === "firebase") {
    return GA4Schema;
  }
  if (type === "snowplow") {
    return SnowplowSchema;
  }
  if (type === "amplitude") {
    return AmplitudeSchema;
  }
  if (type === "segment" || type === "jitsu") {
    return SegmentSchema;
  }
  if (type === "matomo") {
    return MatomoSchema;
  }
  if (type === "freshpaint") {
    return FreshpaintSchema;
  }
  if (type === "heap") {
    return HeapSchema;
  }
  if (type === "rudderstack") {
    return RudderstackSchema;
  }
  if (type === "fullstory") {
    return FullStorySchema;
  }

  return CustomSchema;
}

export function getTablePrefix(params: DataSourceParams) {
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
  else if ("catalog" in params && "schema" in params) {
    return `${params.catalog ? params.catalog + "." : ""}${
      params.schema || "public"
    }.`;
  }
  // Athena
  else if ("catalog" in params && "database" in params) {
    return `${params.catalog}.${params.database}.`;
  }

  return "";
}

export function getInitialSettings(
  type: SchemaFormat,
  params: DataSourceParams,
  options?: Record<string, string | number>,
) {
  const schema = getSchemaObject(type);
  const userIdTypes = schema.userIdTypes;
  return {
    schemaFormat: type,
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
        query: schema.getExperimentSQL(getTablePrefix(params), id, options),
      })),
      identityJoins: schema.getIdentitySQL(getTablePrefix(params), options),
    },
  };
}

export function getExposureQuery(
  settings?: DataSourceSettings,
  exposureQueryId?: string,
  userIdType?: string,
): ExposureQuery | null {
  const queries = settings?.queries?.exposure || [];

  if (!exposureQueryId) {
    return (
      queries.find((q) => q.userIdType === (userIdType ?? "anonymous_id")) ??
      null
    );
  }
  return queries.find((q) => q.id === exposureQueryId) ?? null;
}

export function getInitialMetricQuery(
  datasource: DataSourceInterfaceWithParams,
  type: MetricType,
): [string[], string] {
  const schema = getSchemaObject(datasource.settings?.schemaFormat);

  return [
    schema.userIdTypes,
    schema.getMetricSQL(type, getTablePrefix(datasource.params)),
  ];
}

export function validateSQL(sql: string, requiredColumns: string[]): void {
  if (!sql) throw new Error("SQL cannot be empty");

  if (!sql.match(/SELECT\s[\s\S]*\sFROM\s[\S\s]+/i)) {
    throw new Error("Invalid SQL. Expecting `SELECT ... FROM ...`");
  }

  if (sql.match(/;(\s|\n)*$/)) {
    throw new Error(
      "Don't end your SQL statements with semicolons since it will break our generated queries",
    );
  }

  const missingCols = requiredColumns.filter(
    (col) => !sql.toLowerCase().includes(col.toLowerCase()),
  );

  if (missingCols.length > 0) {
    throw new Error(
      `Missing the following required columns: ${missingCols
        .map((col) => '"' + col + '"')
        .join(", ")}`,
    );
  }
}
