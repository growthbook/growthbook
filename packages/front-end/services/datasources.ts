import {
  DataSourceInterfaceWithParams,
  DataSourceParams,
  DataSourceSettings,
  ExposureQuery,
  SchemaFormat,
  SchemaInterface,
  UserIdType,
} from "back-end/types/datasource";
import {
  ColumnInterface,
  CreateColumnProps,
  CreateFactFilterProps,
  CreateFactMetricProps,
  CreateFactTableProps,
  FactTableInterface,
} from "back-end/types/fact-table";
import { MetricType } from "back-end/types/metric";
import {
  MetricDefaults,
  OrganizationSettings,
} from "back-end/types/organization";
import { BigQueryConnectionParams } from "back-end/types/integrations/bigquery";
import { getDefaultFactMetricProps } from "@/services/metrics";
import { ApiCallType } from "@/services/auth";

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
  options?: Record<string, string | number>
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
  type: MetricType
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
      "Don't end your SQL statements with semicolons since it will break our generated queries"
    );
  }

  const missingCols = requiredColumns.filter(
    (col) => !sql.toLowerCase().includes(col.toLowerCase())
  );

  if (missingCols.length > 0) {
    throw new Error(
      `Missing the following required columns: ${missingCols
        .map((col) => '"' + col + '"')
        .join(", ")}`
    );
  }
}

function generateColumns(
  cols: Record<string, Partial<ColumnInterface>>
): CreateColumnProps[] {
  return Object.entries(cols).map(([name, data]) => ({
    column: name,
    datatype: "string",
    description: "",
    numberFormat: "",
    alwaysInlineFilter: false,
    name: name,
    ...data,
  }));
}

interface InitialDatasourceResources {
  factTables: {
    factTable: Omit<
      CreateFactTableProps,
      "organization" | "datasource" | "tags" | "projects" | "owner"
    >;
    filters: CreateFactFilterProps[];
    metrics: Partial<
      Pick<
        CreateFactMetricProps,
        | "name"
        | "description"
        | "numerator"
        | "denominator"
        | "metricType"
        | "quantileSettings"
        | "windowSettings"
      >
    >[];
  }[];
}

const getClickHouseInitialDatasourceResources = (): InitialDatasourceResources => {
  return {
    factTables: [
      {
        factTable: {
          name: "Clickhouse Events",
          description: "",
          sql: `SELECT
  timestamp,
  user_id,
  device_id as anonymous_id,
  user_attributes_json,
  event_name,
  geo_country,
  geo_city,
  geo_lat,
  geo_lon,
  ua_device_type,
  ua_browser,
  ua_os,
  utm_source,
  utm_medium,
  utm_campaign,
  url_path,
  session_id
FROM events`,
          columns: generateColumns({
            timestamp: { datatype: "date" },
            user_id: { datatype: "string" },
            user_attributes_json: { datatype: "string" },
            event_name: { datatype: "string", alwaysInlineFilter: true },
            geo_country: { datatype: "string" },
            geo_city: { datatype: "string" },
            geo_lat: { datatype: "number" },
            geo_lon: { datatype: "number" },
            ua_device_type: { datatype: "string" },
            ua_browser: { datatype: "string" },
            ua_os: { datatype: "string" },
            utm_source: { datatype: "string" },
            utm_medium: { datatype: "string" },
            utm_campaign: { datatype: "string" },
            url_path: { datatype: "string" },
            session_id: { datatype: "string" },
          }),
          userIdTypes: ["user_id", "anonymous_id"],
          eventName: "",
        },
        filters: [],
        metrics: [
          {
            name: "Page Views per User",
            metricType: "mean",
            numerator: {
              factTableId: "",
              column: "$$count",
              filters: [],
              inlineFilters: {
                event_name: ["page_view"],
              },
            },
          },
          {
            name: "Pages per Session",
            metricType: "ratio",
            numerator: {
              factTableId: "",
              column: "$$count",
              filters: [],
              inlineFilters: {
                event_name: ["page_view"],
              },
            },
            denominator: {
              factTableId: "",
              column: "$$count",
              filters: [],
              inlineFilters: {
                event_name: ["session_start"],
              },
            },
          },
        ],
      },
    ],
  };
};

const getBigQueryWithGa4InitialDatasourceResources = ({
  params,
  userIdTypes: datasourceUserIdTypes,
}: {
  params: BigQueryConnectionParams;
  userIdTypes: UserIdType[];
}): InitialDatasourceResources => {
  // Sanity check
  if (!params.defaultDataset?.startsWith("analytics_")) {
    return { factTables: [] };
  }

  const userIdTypes: string[] = [];
  if (datasourceUserIdTypes.some((t) => t.userIdType === "user_id")) {
    userIdTypes.push("user_id");
  }
  if (datasourceUserIdTypes.some((t) => t.userIdType === "anonymous_id")) {
    userIdTypes.push("anonymous_id");
  }

  return {
    factTables: [
      {
        factTable: {
          name: "GA4 Events",
          description: "",
          sql: `
SELECT
  TIMESTAMP_MICROS(event_timestamp) as timestamp,
  user_id,
  user_pseudo_id as anonymous_id,
  event_name,
  geo.country,
  device.category as device_category,
  traffic_source.source,
  traffic_source.medium,
  traffic_source.name as campaign,
  REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), r'http[s]?:\\/\\/?[^\\/\\s]+\\/([^?]*)') as page_path,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged') as session_engaged,
  event_value_in_usd,
  CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS string) as session_id,
  (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec')/1000 as engagement_time
FROM
  \`${params.defaultProject || "my_project"}\`.\`${
            params.defaultDataset || "my_dataset"
          }\`.\`events_*\`
WHERE
  ((_TABLE_SUFFIX BETWEEN '{{date startDateISO "yyyyMMdd"}}' AND '{{date endDateISO "yyyyMMdd"}}') OR
  (_TABLE_SUFFIX BETWEEN 'intraday_{{date startDateISO "yyyyMMdd"}}' AND 'intraday_{{date endDateISO "yyyyMMdd"}}'))
            `.trim(),
          eventName: "",
          userIdTypes,
          columns: generateColumns({
            timestamp: { datatype: "date" },
            user_id: { datatype: "string" },
            anonymous_id: { datatype: "string" },
            event_name: { datatype: "string", alwaysInlineFilter: true },
            country: { datatype: "string" },
            device_category: { datatype: "string" },
            source: { datatype: "string" },
            medium: { datatype: "string" },
            campaign: { datatype: "string" },
            page_path: { datatype: "string" },
            session_engaged: { datatype: "string" },
            event_value_in_usd: {
              datatype: "number",
              numberFormat: "currency",
            },
            session_id: { datatype: "string" },
            engagement_time: {
              datatype: "number",
              numberFormat: "time:seconds",
            },
          }),
        },
        filters: [
          {
            name: "Engaged Session",
            description: "Events fired once a session is considered 'engaged'",
            value: `session_engaged = '1'`,
          },
          {
            name: "Desktop",
            description: "Events fired on desktop devices",
            value: `device_category = 'desktop'`,
          },
          {
            name: "Mobile / Tablet",
            description: "Events fired on mobile or tablet devices",
            value: `device_category IN ('mobile', 'tablet')`,
          },
        ],
        metrics: [
          {
            name: "Page Views per User",
            metricType: "mean",
            numerator: {
              factTableId: "",
              column: "$$count",
              filters: [],
              inlineFilters: {
                event_name: ["page_view"],
              },
            },
          },
          {
            name: "Sessions per User",
            metricType: "mean",
            numerator: {
              factTableId: "",
              column: "$$count",
              filters: [],
              inlineFilters: {
                event_name: ["session_start"],
              },
            },
          },
          {
            name: "Pages per Session",
            metricType: "ratio",
            numerator: {
              factTableId: "",
              column: "$$count",
              filters: [],
              inlineFilters: {
                event_name: ["page_view"],
              },
            },
            denominator: {
              factTableId: "",
              column: "$$count",
              filters: [],
              inlineFilters: {
                event_name: ["session_start"],
              },
            },
          },
          {
            name: "Engaged Users",
            metricType: "proportion",
            description:
              "The percent of users who have at least 1 engaged session",
            numerator: {
              factTableId: "",
              column: "$$distinctUsers",
              filters: ["Engaged Session"],
            },
          },
          {
            name: "Total Time on Site",
            description: "Total time spent on site per user",
            metricType: "mean",
            numerator: {
              factTableId: "",
              column: "engagement_time",
              filters: [],
            },
          },
          {
            name: "Session Duration",
            description: "Total time spent per session",
            metricType: "ratio",
            numerator: {
              factTableId: "",
              column: "engagement_time",
              filters: [],
            },
            denominator: {
              factTableId: "",
              column: "$$count",
              filters: [],
              inlineFilters: {
                event_name: ["session_start"],
              },
            },
          },
          {
            name: "Submitted Form",
            metricType: "proportion",
            numerator: {
              factTableId: "",
              column: "$$distinctUsers",
              filters: [],
              inlineFilters: {
                event_name: ["form_submit"],
              },
            },
          },
        ],
      },
      {
        factTable: {
          name: "GA4 Page Views",
          description: "",
          sql: `
SELECT
  TIMESTAMP_MICROS(event_timestamp) as timestamp,
  user_id,
  user_pseudo_id as anonymous_id,
  geo.country,
  device.category as device_category,
  traffic_source.source,
  traffic_source.medium,
  traffic_source.name as campaign,
  REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), r'http[s]?:\\/\\/?[^\\/\\s]+\\/([^?]*)') as page_path,
  CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS string) as session_id
FROM
  \`${params.defaultProject || "my_project"}\`.\`${
            params.defaultDataset || "my_dataset"
          }\`.\`events_*\`
WHERE
  ((_TABLE_SUFFIX BETWEEN '{{date startDateISO "yyyyMMdd"}}' AND '{{date endDateISO "yyyyMMdd"}}') OR
  (_TABLE_SUFFIX BETWEEN 'intraday_{{date startDateISO "yyyyMMdd"}}' AND 'intraday_{{date endDateISO "yyyyMMdd"}}'))
            `.trim(),
          eventName: "",
          userIdTypes,
          columns: generateColumns({
            timestamp: { datatype: "date" },
            user_id: { datatype: "string" },
            anonymous_id: { datatype: "string" },
            country: { datatype: "string" },
            device_category: { datatype: "string" },
            source: { datatype: "string" },
            medium: { datatype: "string" },
            campaign: { datatype: "string" },
            page_path: { datatype: "string", alwaysInlineFilter: true },
            session_id: { datatype: "string" },
          }),
        },
        filters: [
          {
            name: "Desktop",
            description: "Events fired on desktop devices",
            value: `device_category = 'desktop'`,
          },
          {
            name: "Mobile / Tablet",
            description: "Events fired on mobile or tablet devices",
            value: `device_category IN ('mobile', 'tablet')`,
          },
        ],
        metrics: [],
      },
    ],
  };
};

export function getInitialDatasourceResources({
  datasource,
}: {
  datasource: DataSourceInterfaceWithParams;
}): InitialDatasourceResources {
  if (
    datasource.type === "bigquery" &&
    datasource.settings?.schemaFormat === "ga4"
  )
    return getBigQueryWithGa4InitialDatasourceResources({
      params: datasource.params,
      userIdTypes: datasource.settings?.userIdTypes || [],
    });

  if (datasource.type === "growthbook_clickhouse")
    return getClickHouseInitialDatasourceResources();

  return {
    factTables: [],
  };
}

export async function createInitialResources({
  onProgress,
  apiCall,
  datasource,
  metricDefaults,
  settings,
  resources,
}: {
  onProgress?: (progress: number) => void;
  // eslint-disable-next-line
  apiCall: ApiCallType<any>;
  metricDefaults: MetricDefaults;
  settings: OrganizationSettings;
  datasource: DataSourceInterfaceWithParams;
  resources: InitialDatasourceResources;
}) {
  // Count total resources that need to be created
  let totalResources = 0;
  totalResources += resources.factTables.length;
  resources.factTables.forEach((factTable) => {
    totalResources += factTable.filters.length;
    totalResources += factTable.metrics.length;
  });

  let success = 0;
  let errors = 0;

  const updateProgress = () => {
    if (onProgress && totalResources > 0) {
      onProgress((success + errors) / totalResources);
    }
  };
  const delay = () => new Promise((resolve) => setTimeout(resolve, 350));

  for (const { factTable, filters, metrics } of resources.factTables) {
    try {
      const factTableBody: CreateFactTableProps = {
        ...factTable,
        owner: "",
        datasource: datasource.id,
        projects: datasource.projects || [],
        tags: [],
      };

      const res: { factTable: FactTableInterface } = await apiCall(
        "/fact-tables",
        {
          method: "POST",
          body: JSON.stringify(factTableBody),
        }
      );
      const factTableId = res.factTable.id;
      success++;
      updateProgress();
      await delay();

      // Create filters
      const filterMap: Record<string, string> = {};
      for (const filter of filters) {
        try {
          const filterBody: CreateFactFilterProps = filter;
          const res: { filterId: string } = await apiCall(
            `/fact-tables/${factTableId}/filter`,
            {
              method: "POST",
              body: JSON.stringify(filterBody),
            }
          );
          filterMap[filter.name] = res.filterId;
          success++;
        } catch (e) {
          console.error("Failed creating filter", filter.name, e);
          errors++;
        }
        updateProgress();
        await delay();
      }

      // Create metrics
      for (const metric of metrics) {
        try {
          // Replace filter names with filter ids
          if (metric.numerator?.filters?.length) {
            metric.numerator.filters = metric.numerator.filters.map(
              (name) => filterMap[name]
            );
            // If some filters are missing, skip this metric
            if (metric.numerator.filters.some((f) => !f)) {
              throw new Error("Required filters not created");
            }
          }
          if (metric.denominator?.filters?.length) {
            metric.denominator.filters = metric.denominator.filters.map(
              (name) => filterMap[name]
            );
            // If some filters are missing, skip this metric
            if (metric.denominator.filters.some((f) => !f)) {
              throw new Error("Required filters not created");
            }
          }

          // Inject factTableId into numerator and denominator
          if (metric.numerator) {
            metric.numerator.factTableId = factTableId;
          }
          if (metric.denominator) {
            metric.denominator.factTableId = factTableId;
          }

          const metricBody: CreateFactMetricProps = getDefaultFactMetricProps({
            metricDefaults,
            settings,
            datasources: [datasource],
            existing: metric,
          });
          await apiCall(`/fact-metrics`, {
            method: "POST",
            body: JSON.stringify(metricBody),
          });
          success++;
        } catch (e) {
          console.error("Failed creating metric", metric.name, e);
          errors++;
        }
        updateProgress();
        await delay();
      }
    } catch (e) {
      console.error("Failed creating factTable", factTable.name, e);
      errors += 1 + filters.length + metrics.length;
      updateProgress();
      await delay();
    }
  }

  return {
    success,
    errors,
  };
}
