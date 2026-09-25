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
  getFactTableSQL: (tablePrefix) => {
    return `SELECT
  user_id,
  user_pseudo_id as anonymous_id,
  TIMESTAMP_MICROS(event_timestamp) as timestamp,
  event_name,
  geo.country as country,
  traffic_source.source as source,
  traffic_source.medium as medium,
  device.category as device,
  device.web_info.browser as browser,
  device.operating_system as os
FROM
  ${tablePrefix}\`events_*\`
WHERE (
  (_TABLE_SUFFIX BETWEEN '{{date startDateISO "yyyyMMdd"}}' AND '{{date endDateISO "yyyyMMdd"}}') OR
  (_TABLE_SUFFIX BETWEEN 'intraday_{{date startDateISO "yyyyMMdd"}}' AND 'intraday_{{date endDateISO "yyyyMMdd"}}')
)
  `;
  },
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
  getFactTableSQL: (tablePrefix) => {
    return `SELECT
  user_id,
  domain_userid as anonymous_id,
  collector_tstamp as timestamp,
  se_action,
  se_label,
  se_property,
  dvce_type as device,
  os_name as os,
  geo_country as country,
  mkt_source as source,
  mkt_medium as medium,
  br_family as browser
FROM
  ${tablePrefix}events
  `;
  },
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
  getFactTableSQL: (tablePrefix, userIdTypes) => {
    return `SELECT
  ${userIdTypes.map((ut) => `${ut},`).join("\n  ")}
  event_name,
  timestamp
FROM
  ${tablePrefix}events`;
  },
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
  getFactTableSQL: (tablePrefix, _userIdTypes, options) => {
    const projectId = options?.projectId || "AMPLITUDE_PROJECT_ID";

    return `SELECT
  user_id,
  amplitude_id as anonymous_id,
  event_time as timestamp,
  event_type,
  device_family as device,
  os_name as os,
  country,
  paying
FROM
  ${tablePrefix}EVENTS_${projectId}
  `;
  },
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
    WHEN context_user_agent LIKE '% Edg%' THEN 'Edge'
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
  getFactTableSQL: (tablePrefix) => {
    return `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp,
  event,
  context_campaign_source as source,
  context_campaign_medium as medium,
  (CASE
    WHEN context_user_agent LIKE '%Mobile%' THEN 'Mobile'
    ELSE 'Tablet/Desktop' END
  ) as device,
  (CASE
    WHEN context_user_agent LIKE '% Firefox%' THEN 'Firefox'
    WHEN context_user_agent LIKE '% OPR%' THEN 'Opera'
    WHEN context_user_agent LIKE '% Edg%' THEN 'Edge'
    WHEN context_user_agent LIKE '% Chrome%' THEN 'Chrome'
    WHEN context_user_agent LIKE '% Safari%' THEN 'Safari'
    ELSE 'Other' END
  ) as browser
FROM
  ${tablePrefix}tracks
  `;
  },
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
    WHEN context_user_agent LIKE '% Edg%' THEN 'Edge'
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
  getFactTableSQL: (tablePrefix, userIdTypes) => {
    return `SELECT
  ${userIdTypes.map((ut) => `${ut} as ${ut},`).join("\n  ")}
  received_at as timestamp,
  event,
  (CASE
    WHEN context_user_agent LIKE '%Mobile%' THEN 'Mobile'
    ELSE 'Tablet/Desktop' END
  ) as device,
  (CASE
    WHEN context_user_agent LIKE '% Firefox%' THEN 'Firefox'
    WHEN context_user_agent LIKE '% OPR%' THEN 'Opera'
    WHEN context_user_agent LIKE '% Edg%' THEN 'Edge'
    WHEN context_user_agent LIKE '% Chrome%' THEN 'Chrome'
    WHEN context_user_agent LIKE '% Safari%' THEN 'Safari'
    ELSE 'Other' END
  ) as browser
FROM
  ${tablePrefix}tracks
  `;
  },
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
  getFactTableSQL: (tablePrefix, _userIdTypes, options) => {
    const tPrefix = options?.tablePrefix || tablePrefix;
    const siteId = options?.siteId || "1";
    return `SELECT
  conv(hex(idvisitor), 16, 16) as anonymous_id,
  server_time as timestamp,
  visit.config_device_model as device,
  visit.config_os as OS,
  visit.location_country as country
FROM
  ${tPrefix}_log_link_visit_action events
INNER JOIN ${tPrefix}_log_visit visit
  ON (events.idvisit = visit.idvisit)
WHERE
  events.idsite = ${siteId}
  `;
  },
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
  getFactTableSQL: (tablePrefix, userIdTypes) => {
    return `SELECT
  ${userIdTypes.map((ut) => `${ut} as ${ut},`).join("\n  ")}
  sent_at as timestamp,
  utm_source as source,
  utm_medium as medium,
  utm_campaign as campaign,
  operating_system as os,
  browser
FROM
  ${tablePrefix}events`;
  },
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
  country,
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
  getFactTableSQL: (tablePrefix) => {
    return `SELECT
  user_id,
  sent_at as timestamp,
  utm_source as source,
  utm_medium as medium,
  utm_campaign as campaign,
  operating_system as os,
  browser
FROM
  ${tablePrefix}events`;
  },
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
  ${tablePrefix}\`events_*\`,
  UNNEST(event_properties) AS exp_event_properties,
  UNNEST(exp_event_properties.event_properties) AS experiment_id_param,
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
  getFactTableSQL: (tablePrefix) => {
    return `SELECT
  device_id,
  TIMESTAMP_MICROS(event_time) as timestamp,
  event_type,
  source_type as source
FROM
  ${tablePrefix}\`events_*\`
WHERE
  _TABLE_SUFFIX BETWEEN '{{date startDateISO "yyyyMMdd"}}' AND '{{date endDateISO "yyyyMMdd"}}'
`;
  },
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

function sqlStringLiteral(value: string | number): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// GrowthBook assignments are stamped on LLM traces as tags shaped
// `gb:<experimentKey>:<variationKey>` (emitted by the SDK `tracing` plugin).
// The exposure queries below parse that tag positionally on ":".
export const TRACING_TAG_PREFIX = "gb";

// Langfuse v3 self-hosted ClickHouse tables. Kept in one place because
// Langfuse v4 collapses these into a single `events` table.
export const LANGFUSE_TABLES = {
  traces: "traces",
  observations: "observations",
  scores: "scores",
} as const;

export const PHOENIX_TABLES = {
  projects: "projects",
  traces: "traces",
  spans: "spans",
  projectSessions: "project_sessions",
  spanCosts: "span_costs",
  spanAnnotations: "span_annotations",
} as const;

// Langfuse tables hold every project in the instance. Scope by project id when
// one is configured; otherwise include everything, which is what a
// single-project self-host wants.
export function langfuseProjectClause(
  alias: string,
  projectId?: string | number,
): string {
  return projectId
    ? `\n  AND ${alias}project_id = ${sqlStringLiteral(projectId)}`
    : "";
}

export function phoenixProjectClause(
  alias: string,
  projectName?: string | number,
): string {
  return projectName
    ? `\n  AND ${alias}name = ${sqlStringLiteral(projectName)}`
    : "";
}

const LANGFUSE_ID_COLUMNS: Record<string, string> = {
  user_id: "t.user_id",
  session_id: "t.session_id",
  trace_id: "t.id",
};

const LangfuseSchema: SchemaInterface = {
  experimentDimensions: ["trace_name", "release", "version"],
  userIdTypes: ["user_id", "session_id", "trace_id"],
  getExperimentSQL: (tablePrefix, userId, options) => {
    const idCol = LANGFUSE_ID_COLUMNS[userId] || LANGFUSE_ID_COLUMNS.user_id;
    // No FINAL here: duplicate trace versions yield identical exposure rows,
    // which GrowthBook's per-unit dedupe already collapses.
    return `SELECT
  ${idCol} AS ${userId},
  t.timestamp AS timestamp,
  splitByChar(':', tag)[2] AS experiment_id,
  splitByChar(':', tag)[3] AS variation_id,
  t.name AS trace_name,
  t.release AS release,
  t.version AS version
FROM ${tablePrefix}${LANGFUSE_TABLES.traces} AS t
ARRAY JOIN t.tags AS tag
WHERE
  startsWith(tag, '${TRACING_TAG_PREFIX}:')
  AND length(splitByChar(':', tag)) = 3
  AND t.is_deleted = 0
  AND ${idCol} IS NOT NULL${langfuseProjectClause("t.", options?.projectId)}
  AND t.timestamp >= toDateTime('{{startDate}}', 'UTC')
  AND t.timestamp <= toDateTime('{{endDate}}', 'UTC')`;
  },
  getIdentitySQL: (tablePrefix, options) => [
    {
      ids: ["user_id", "session_id"],
      query: `SELECT DISTINCT
  user_id,
  session_id
FROM ${tablePrefix}${LANGFUSE_TABLES.traces}
WHERE
  is_deleted = 0
  AND user_id IS NOT NULL
  AND session_id IS NOT NULL${langfuseProjectClause("", options?.projectId)}`,
    },
  ],
  // Legacy templates; fact tables for this schema come from initial-resources.ts
  getMetricSQL: () => "",
  getFactTableSQL: () => "",
};

// Phoenix stores OTel attributes as nested JSONB (`user.id` -> attributes->'user'->>'id').
// Context-propagated attributes land on every span inside the scope, so the
// root span is the reliable place to read trace-level values.
export const PHOENIX_USER_ID_EXPR = "root.attributes->'user'->>'id'";
export const PHOENIX_SESSION_ID_EXPR =
  "COALESCE(ps.session_id, root.attributes->'session'->>'id')";

// `tag.tags` arrives as a JSON array from the Python SDK but as a JSON-encoded
// string from the JS SDK, so normalise both (and a bare scalar) to an array.
const PHOENIX_ROOT_TAGS_EXPR = `CASE jsonb_typeof(root.attributes->'tag'->'tags')
      WHEN 'array' THEN root.attributes->'tag'->'tags'
      WHEN 'string' THEN CASE
        WHEN left(root.attributes->'tag'->>'tags', 1) = '['
          THEN (root.attributes->'tag'->>'tags')::jsonb
        ELSE jsonb_build_array(root.attributes->'tag'->>'tags')
      END
      ELSE '[]'::jsonb
    END`;

export function phoenixTraceJoins(tablePrefix: string): string {
  return `JOIN ${tablePrefix}${PHOENIX_TABLES.projects} p ON p.id = t.project_rowid
JOIN ${tablePrefix}${PHOENIX_TABLES.spans} root
  ON root.trace_rowid = t.id AND root.parent_id IS NULL
LEFT JOIN ${tablePrefix}${PHOENIX_TABLES.projectSessions} ps
  ON ps.id = t.project_session_rowid`;
}

const PHOENIX_ID_COLUMNS: Record<string, string> = {
  user_id: PHOENIX_USER_ID_EXPR,
  session_id: PHOENIX_SESSION_ID_EXPR,
  trace_id: "t.trace_id",
};

const PhoenixSchema: SchemaInterface = {
  experimentDimensions: ["trace_name"],
  userIdTypes: ["user_id", "session_id", "trace_id"],
  getExperimentSQL: (tablePrefix, userId, options) => {
    const idCol = PHOENIX_ID_COLUMNS[userId] || PHOENIX_ID_COLUMNS.user_id;
    return `SELECT
  ${idCol} AS ${userId},
  t.start_time AS timestamp,
  split_part(gb_tags.tag, ':', 2) AS experiment_id,
  split_part(gb_tags.tag, ':', 3) AS variation_id,
  root.name AS trace_name
FROM ${tablePrefix}${PHOENIX_TABLES.traces} t
${phoenixTraceJoins(tablePrefix)}
CROSS JOIN LATERAL jsonb_array_elements_text(
    ${PHOENIX_ROOT_TAGS_EXPR}
  ) AS gb_tags(tag)
WHERE
  gb_tags.tag LIKE '${TRACING_TAG_PREFIX}:%'
  AND split_part(gb_tags.tag, ':', 3) <> ''
  AND ${idCol} IS NOT NULL${phoenixProjectClause("p.", options?.projectName)}
  AND t.start_time >= '{{startDate}}'
  AND t.start_time <= '{{endDate}}'`;
  },
  getIdentitySQL: (tablePrefix, options) => [
    {
      ids: ["user_id", "session_id"],
      query: `SELECT DISTINCT
  ${PHOENIX_USER_ID_EXPR} AS user_id,
  ${PHOENIX_SESSION_ID_EXPR} AS session_id
FROM ${tablePrefix}${PHOENIX_TABLES.traces} t
${phoenixTraceJoins(tablePrefix)}
WHERE
  ${PHOENIX_USER_ID_EXPR} IS NOT NULL
  AND ${PHOENIX_SESSION_ID_EXPR} IS NOT NULL${phoenixProjectClause("p.", options?.projectName)}`,
    },
  ],
  getMetricSQL: () => "",
  getFactTableSQL: () => "",
};

function getSchemaObject(type?: SchemaFormat) {
  if (type === "ga4" || type === "firebase") {
    return GA4Schema;
  }
  if (type === "langfuse") {
    return LangfuseSchema;
  }
  if (type === "phoenix") {
    return PhoenixSchema;
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
  if (type === "eventForwarder") {
    return CustomSchema;
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

const USER_ID_TYPE_META: Record<
  string,
  { description: string; exposureName: string }
> = {
  user_id: {
    description: "Logged-in user id",
    exposureName: "Logged-in Users",
  },
  anonymous_id: {
    description: "Anonymous visitor id",
    exposureName: "Anonymous Visitors",
  },
  session_id: { description: "Session id", exposureName: "Sessions" },
  trace_id: {
    description: "Trace id (one per LLM request)",
    exposureName: "Traces",
  },
};

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
        description: USER_ID_TYPE_META[type]?.description ?? "",
      };
    }),
    queries: {
      exposure: userIdTypes.map((id) => ({
        id,
        userIdType: id,
        dimensions: schema.experimentDimensions,
        name: USER_ID_TYPE_META[id]?.exposureName ?? id,
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

export function getInitialFactTableQuery(
  datasource: DataSourceInterfaceWithParams,
): { userIdTypes: string[]; sql: string } {
  const schema = getSchemaObject(datasource.settings?.schemaFormat);

  const userIdTypes = datasource.settings?.userIdTypes?.map(
    (ut) => ut.userIdType,
  ) || ["user_id"];

  return {
    userIdTypes,
    sql: schema.getFactTableSQL(
      getTablePrefix(datasource.params),
      userIdTypes,
      datasource.settings?.schemaOptions,
    ),
  };
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

  // Allow `SELECT *` queries, but otherwise look for all required columns in the query
  if (missingCols.length > 0 && !sql.match(/SELECT\s+\*/i)) {
    throw new Error(
      `Missing the following required columns: ${missingCols
        .map((col) => '"' + col + '"')
        .join(", ")}`,
    );
  }
}
