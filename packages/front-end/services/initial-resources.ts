import {
  ColumnInterface,
  CreateColumnProps,
  CreateFactFilterProps,
  CreateFactTableProps,
  FactTableInterface,
} from "shared/types/fact-table";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  MetricDefaults,
  OrganizationSettings,
  SDKAttributeSchema,
} from "shared/types/organization";
import {
  buildManagedWarehouseEventsFactTableSql,
  getManagedWarehouseEventsFactTableColumns,
  getManagedWarehouseUserIdTypes,
} from "shared/util";
import {
  CreateStandardFactMetricProps,
  getDefaultFactMetricProps,
} from "@/services/metrics";
import { ApiCallType } from "@/services/auth";
import {
  getTablePrefix,
  LANGFUSE_TABLES,
  langfuseProjectClause,
  PHOENIX_SESSION_ID_EXPR,
  PHOENIX_TABLES,
  PHOENIX_USER_ID_EXPR,
  phoenixProjectClause,
  phoenixTraceJoins,
} from "@/services/datasources";

function generateColumns(
  cols: Record<string, Partial<ColumnInterface>>,
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

export interface InitialDatasourceResources {
  factTables: {
    factTable: Omit<
      CreateFactTableProps,
      "organization" | "datasource" | "tags" | "projects" | "owner"
    >;
    filters: CreateFactFilterProps[];
    metrics: Partial<
      Pick<
        CreateStandardFactMetricProps,
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

function getBuiltInWarehouseResources(
  attributeSchema: SDKAttributeSchema | undefined,
): InitialDatasourceResources {
  // JSON-columns model: standard fields + `attributes`/`properties` JSON columns,
  // with identifiers exposed as top-level aliases in the fact-table SELECT.
  const columns = generateColumns(
    Object.fromEntries(
      getManagedWarehouseEventsFactTableColumns(attributeSchema).map((c) => [
        c.column,
        {
          datatype: c.datatype,
          ...(c.alwaysInlineFilter ? { alwaysInlineFilter: true } : {}),
          ...(c.jsonFields ? { jsonFields: c.jsonFields } : {}),
        },
      ]),
    ),
  );

  return {
    factTables: [
      // Events
      {
        factTable: {
          // Give it a known id so we can reference it easily
          id: MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
          name: "Events",
          description: "",
          sql: buildManagedWarehouseEventsFactTableSql(attributeSchema),
          // Mark the fact table as Official and block editing/deleting in the UI
          managedBy: "api",
          columns,
          userIdTypes: getManagedWarehouseUserIdTypes(attributeSchema),
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
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["Page View"],
                },
              ],
            },
          },
          {
            name: "Sessions per User",
            metricType: "mean",
            numerator: {
              factTableId: "",
              column: "$$count",
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["Session Start"],
                },
              ],
            },
          },
          {
            name: "Pages per Session",
            metricType: "ratio",
            numerator: {
              factTableId: "",
              column: "$$count",
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["Page View"],
                },
              ],
            },
            denominator: {
              factTableId: "",
              column: "$$count",
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["Session Start"],
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function getSegmentResources(
  datasource: DataSourceInterfaceWithParams,
): InitialDatasourceResources {
  const params = datasource.params;
  const tablePrefix = getTablePrefix(params);

  return {
    factTables: [
      {
        factTable: {
          name: "Segment Tracks",
          description: "",
          sql: `SELECT
  received_at as timestamp,
  user_id,
  anonymous_id,
  event,
  context_campaign_source as source,
  context_campaign_medium as medium
FROM ${tablePrefix}tracks
WHERE
  received_at >= '{{date startDateISO "yyyy-MM-dd"}}' 
  AND received_at <= '{{date endDateISO "yyyy-MM-dd"}}'
`.trim(),
          eventName: "",
          userIdTypes: ["user_id", "anonymous_id"],
          columns: generateColumns({
            timestamp: { datatype: "date" },
            user_id: { datatype: "string" },
            anonymous_id: { datatype: "string" },
            event: { datatype: "string", alwaysInlineFilter: true },
            source: { datatype: "string" },
            medium: { datatype: "string" },
          }),
        },
        filters: [],
        metrics: [],
      },
      {
        factTable: {
          name: "Segment Page Views",
          description: "",
          sql: `SELECT
  received_at as timestamp,
  user_id,
  anonymous_id,
  path,
  title,
  url,
  referrer,
  search,
  context_campaign_source as source,
  context_campaign_medium as medium
FROM ${tablePrefix}pages
WHERE
  received_at >= '{{date startDateISO "yyyy-MM-dd"}}' 
  AND received_at <= '{{date endDateISO "yyyy-MM-dd"}}'
`.trim(),
          eventName: "",
          userIdTypes: ["user_id", "anonymous_id"],
          columns: generateColumns({
            timestamp: { datatype: "date" },
            user_id: { datatype: "string" },
            anonymous_id: { datatype: "string" },
            path: { datatype: "string", alwaysInlineFilter: true },
            title: { datatype: "string" },
            url: { datatype: "string" },
            referrer: { datatype: "string" },
            search: { datatype: "string" },
            source: { datatype: "string" },
            medium: { datatype: "string" },
          }),
        },
        filters: [],
        metrics: [
          {
            name: "Page Views per User",
            metricType: "mean",
            numerator: {
              factTableId: "",
              column: "$$count",
            },
          },
        ],
      },
    ],
  };
}

function getRudderstackResources(
  datasource: DataSourceInterfaceWithParams,
): InitialDatasourceResources {
  const params = datasource.params;
  const tablePrefix = getTablePrefix(params);

  return {
    factTables: [
      {
        factTable: {
          name: "Rudderstack Tracks",
          description: "",
          sql: `SELECT
  received_at as timestamp,
  anonymous_id,
  event,
  context_campaign_source as source,
  context_campaign_medium as medium
FROM ${tablePrefix}tracks
WHERE
  received_at >= '{{date startDateISO "yyyy-MM-dd"}}' 
  AND received_at <= '{{date endDateISO "yyyy-MM-dd"}}'
`.trim(),
          eventName: "",
          userIdTypes: ["user_id", "anonymous_id"],
          columns: generateColumns({
            timestamp: { datatype: "date" },
            anonymous_id: { datatype: "string" },
            event: { datatype: "string", alwaysInlineFilter: true },
            source: { datatype: "string" },
            medium: { datatype: "string" },
          }),
        },
        filters: [],
        metrics: [],
      },
      {
        factTable: {
          name: "Segment Page Views",
          description: "",
          sql: `SELECT
  received_at as timestamp
  anonymous_id,
  path,
  title,
  url,
  referrer,
  search,
  context_campaign_source as source,
  context_campaign_medium as medium
FROM ${tablePrefix}pages
WHERE
  received_at >= '{{date startDateISO "yyyy-MM-dd"}}' 
  AND received_at <= '{{date endDateISO "yyyy-MM-dd"}}'
`.trim(),
          eventName: "",
          userIdTypes: ["user_id", "anonymous_id"],
          columns: generateColumns({
            timestamp: { datatype: "date" },
            anonymous_id: { datatype: "string" },
            path: { datatype: "string", alwaysInlineFilter: true },
            title: { datatype: "string" },
            url: { datatype: "string" },
            referrer: { datatype: "string" },
            search: { datatype: "string" },
            source: { datatype: "string" },
            medium: { datatype: "string" },
          }),
        },
        filters: [],
        metrics: [
          {
            name: "Page Views per User",
            metricType: "mean",
            numerator: {
              factTableId: "",
              column: "$$count",
            },
          },
        ],
      },
    ],
  };
}

function getAmplitudeResources(
  datasource: DataSourceInterfaceWithParams,
): InitialDatasourceResources {
  const tablePrefix = getTablePrefix(datasource.params);
  const projectId = datasource.settings.schemaOptions?.projectId || `*`;

  const anonymous_attr = datasource.settings.userIdTypes?.find((t) =>
    ["anonymous_id", "amplitude_id"].includes(t.userIdType),
  )?.userIdType;

  return {
    factTables: [
      {
        factTable: {
          name: "Amplitude Events",
          description: "",
          sql: `
SELECT
  amplitude_id as ${anonymous_attr || "amplitude_id"},
  user_id,
  event_time as timestamp,
  event_type,
  device_family as device,
  os_name as os,
  country,
  paying
FROM
  ${tablePrefix}EVENTS_${projectId}
WHERE
  event_time >= '{{date startDateISO "yyyy-MM-dd"}}'
  AND event_time <= '{{date endDateISO "yyyy-MM-dd"}}'`.trim(),
          eventName: "",
          userIdTypes: ["user_id", ...(anonymous_attr ? [anonymous_attr] : [])],
          columns: generateColumns({
            user_id: { datatype: "string" },
            [anonymous_attr || "amplitude_id"]: { datatype: "string" },
            timestamp: { datatype: "date" },
            event_type: { datatype: "string", alwaysInlineFilter: true },
            device: { datatype: "string" },
            os: { datatype: "string" },
            country: { datatype: "string" },
            paying: { datatype: "boolean" },
          }),
        },
        filters: [],
        metrics: [],
      },
    ],
  };
}

function getGA4Resources(
  datasource: DataSourceInterfaceWithParams,
): InitialDatasourceResources {
  if (datasource.type !== "bigquery") {
    return { factTables: [] };
  }

  const params = datasource.params;
  const datasourceUserIdTypes = datasource.settings.userIdTypes || ["user_id"];

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
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["page_view"],
                },
              ],
            },
          },
          {
            name: "Sessions per User",
            metricType: "mean",
            numerator: {
              factTableId: "",
              column: "$$count",
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["session_start"],
                },
              ],
            },
          },
          {
            name: "Pages per Session",
            metricType: "ratio",
            numerator: {
              factTableId: "",
              column: "$$count",
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["page_view"],
                },
              ],
            },
            denominator: {
              factTableId: "",
              column: "$$count",
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["session_start"],
                },
              ],
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
              rowFilters: [
                {
                  operator: "saved_filter",
                  values: ["Engaged Session"],
                },
              ],
            },
          },
          {
            name: "Total Time on Site",
            description: "Total time spent on site per user",
            metricType: "mean",
            numerator: {
              factTableId: "",
              column: "engagement_time",
            },
          },
          {
            name: "Session Duration",
            description: "Total time spent per session",
            metricType: "ratio",
            numerator: {
              factTableId: "",
              column: "engagement_time",
            },
            denominator: {
              factTableId: "",
              column: "$$count",
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["session_start"],
                },
              ],
            },
          },
          {
            name: "Submitted Form",
            metricType: "proportion",
            numerator: {
              factTableId: "",
              column: "$$distinctUsers",
              rowFilters: [
                {
                  column: "event_name",
                  operator: "=",
                  values: ["form_submit"],
                },
              ],
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
}

const LLM_TRACE_USER_ID_TYPES = ["user_id", "session_id", "trace_id"];

// The five starter metrics every LLM trace source gets. Eval-score averages are
// deliberately not included: score names are user-defined, so the score tables
// mark that column as an inline filter instead.
function getLlmCallMetrics(
  callsFilter: string,
  errorsFilter: string,
): InitialDatasourceResources["factTables"][number]["metrics"] {
  const callsOnly = [
    { operator: "saved_filter" as const, values: [callsFilter] },
  ];
  return [
    {
      name: "LLM calls per user",
      metricType: "mean",
      numerator: { factTableId: "", column: "$$count", rowFilters: callsOnly },
    },
    {
      name: "LLM cost per user",
      metricType: "mean",
      numerator: {
        factTableId: "",
        column: "total_cost",
        rowFilters: callsOnly,
      },
    },
    {
      name: "LLM error rate",
      metricType: "ratio",
      numerator: {
        factTableId: "",
        column: "$$count",
        rowFilters: [
          { operator: "saved_filter", values: [callsFilter] },
          { operator: "saved_filter", values: [errorsFilter] },
        ],
      },
      denominator: {
        factTableId: "",
        column: "$$count",
        rowFilters: callsOnly,
      },
    },
    {
      name: "p95 LLM latency",
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.95, ignoreZeros: false },
      numerator: {
        factTableId: "",
        column: "latency_ms",
        rowFilters: callsOnly,
      },
    },
    {
      name: "Tokens per LLM call",
      metricType: "ratio",
      numerator: {
        factTableId: "",
        column: "total_tokens",
        rowFilters: callsOnly,
      },
      denominator: {
        factTableId: "",
        column: "$$count",
        rowFilters: callsOnly,
      },
    },
  ];
}

function getLangfuseResources(
  datasource: DataSourceInterfaceWithParams,
): InitialDatasourceResources {
  const tablePrefix = getTablePrefix(datasource.params);
  const projectId = datasource.settings.schemaOptions?.projectId;
  const projectClause = (alias: string) =>
    langfuseProjectClause(alias, projectId);

  // Observations and scores carry no user/session id in Langfuse v3, so join
  // back to the (deduped) traces table for them.
  const tracesSubquery = `(
    SELECT id, project_id, user_id, session_id, name
    FROM ${tablePrefix}${LANGFUSE_TABLES.traces} FINAL
    WHERE is_deleted = 0${projectClause("")}
  ) t`;

  const dateClause = (
    col: string,
  ) => `${col} >= toDateTime('{{startDate}}', 'UTC')
  AND ${col} <= toDateTime('{{endDate}}', 'UTC')`;

  return {
    factTables: [
      {
        factTable: {
          name: "Langfuse Traces",
          description: "One row per Langfuse trace (an LLM request)",
          sql: `SELECT
  t.id AS trace_id,
  t.user_id AS user_id,
  t.session_id AS session_id,
  t.timestamp AS timestamp,
  t.name AS trace_name,
  t.release AS release,
  t.version AS version,
  length(t.tags) AS tag_count
FROM ${tablePrefix}${LANGFUSE_TABLES.traces} t FINAL
WHERE
  t.is_deleted = 0
  AND ${dateClause("t.timestamp")}${projectClause("t.")}`,
          eventName: "",
          userIdTypes: LLM_TRACE_USER_ID_TYPES,
          columns: generateColumns({
            trace_id: { datatype: "string" },
            user_id: { datatype: "string" },
            session_id: { datatype: "string" },
            timestamp: { datatype: "date" },
            trace_name: { datatype: "string", alwaysInlineFilter: true },
            release: { datatype: "string" },
            version: { datatype: "string" },
            tag_count: { datatype: "number" },
          }),
        },
        filters: [],
        metrics: [
          {
            name: "Traces per user",
            metricType: "mean",
            numerator: { factTableId: "", column: "$$count" },
          },
        ],
      },
      {
        factTable: {
          name: "Langfuse Observations",
          description:
            "One row per Langfuse observation (generation, span, or event) with latency, token, and cost details",
          sql: `SELECT
  o.id AS observation_id,
  o.trace_id AS trace_id,
  t.user_id AS user_id,
  t.session_id AS session_id,
  o.start_time AS timestamp,
  o.type AS observation_type,
  o.name AS observation_name,
  t.name AS trace_name,
  o.provided_model_name AS model,
  o.level AS level,
  dateDiff('millisecond', o.start_time, o.end_time) AS latency_ms,
  dateDiff('millisecond', o.start_time, o.completion_start_time) AS time_to_first_token_ms,
  o.usage_details['input'] AS input_tokens,
  o.usage_details['output'] AS output_tokens,
  o.usage_details['total'] AS total_tokens,
  toFloat64(o.total_cost) AS total_cost,
  o.prompt_name AS prompt_name,
  o.prompt_version AS prompt_version
FROM ${tablePrefix}${LANGFUSE_TABLES.observations} o FINAL
JOIN ${tracesSubquery} ON t.id = o.trace_id AND t.project_id = o.project_id
WHERE
  o.is_deleted = 0
  AND ${dateClause("o.start_time")}${projectClause("o.")}`,
          eventName: "",
          userIdTypes: LLM_TRACE_USER_ID_TYPES,
          columns: generateColumns({
            observation_id: { datatype: "string" },
            trace_id: { datatype: "string" },
            user_id: { datatype: "string" },
            session_id: { datatype: "string" },
            timestamp: { datatype: "date" },
            observation_type: { datatype: "string" },
            observation_name: { datatype: "string", alwaysInlineFilter: true },
            trace_name: { datatype: "string" },
            model: { datatype: "string", alwaysInlineFilter: true },
            level: { datatype: "string" },
            latency_ms: {
              datatype: "number",
              numberFormat: "time:milliseconds",
            },
            time_to_first_token_ms: {
              datatype: "number",
              numberFormat: "time:milliseconds",
            },
            input_tokens: { datatype: "number" },
            output_tokens: { datatype: "number" },
            total_tokens: { datatype: "number" },
            total_cost: { datatype: "number", numberFormat: "currency" },
            prompt_name: { datatype: "string" },
            prompt_version: { datatype: "number" },
          }),
        },
        filters: [
          {
            name: "LLM Generations",
            description: "Observations that are model calls",
            value: `observation_type = 'GENERATION'`,
          },
          {
            name: "Errors",
            description: "Observations logged at the ERROR level",
            value: `level = 'ERROR'`,
          },
        ],
        metrics: getLlmCallMetrics("LLM Generations", "Errors"),
      },
      {
        factTable: {
          name: "Langfuse Scores",
          description:
            "One row per Langfuse score (evaluations, annotations, and user feedback)",
          sql: `SELECT
  s.id AS score_id,
  s.trace_id AS trace_id,
  s.observation_id AS observation_id,
  t.user_id AS user_id,
  t.session_id AS session_id,
  s.timestamp AS timestamp,
  s.name AS score_name,
  s.value AS score_value,
  s.string_value AS score_string_value,
  s.data_type AS score_data_type,
  s.source AS score_source,
  t.name AS trace_name
FROM ${tablePrefix}${LANGFUSE_TABLES.scores} s FINAL
JOIN ${tracesSubquery} ON t.id = s.trace_id AND t.project_id = s.project_id
WHERE
  s.is_deleted = 0
  AND ${dateClause("s.timestamp")}${projectClause("s.")}`,
          eventName: "",
          userIdTypes: LLM_TRACE_USER_ID_TYPES,
          columns: generateColumns({
            score_id: { datatype: "string" },
            trace_id: { datatype: "string" },
            observation_id: { datatype: "string" },
            user_id: { datatype: "string" },
            session_id: { datatype: "string" },
            timestamp: { datatype: "date" },
            score_name: { datatype: "string", alwaysInlineFilter: true },
            score_value: { datatype: "number" },
            score_string_value: { datatype: "string" },
            score_data_type: { datatype: "string" },
            score_source: { datatype: "string" },
            trace_name: { datatype: "string" },
          }),
        },
        filters: [],
        metrics: [],
      },
    ],
  };
}

function getPhoenixResources(
  datasource: DataSourceInterfaceWithParams,
): InitialDatasourceResources {
  const tablePrefix = getTablePrefix(datasource.params);
  const projectName = datasource.settings.schemaOptions?.projectName;
  const projectClause = phoenixProjectClause("p.", projectName);
  const traceJoins = phoenixTraceJoins(tablePrefix);
  const dateClause = (col: string) =>
    `${col} >= '{{startDate}}'\n  AND ${col} <= '{{endDate}}'`;

  return {
    factTables: [
      {
        factTable: {
          name: "Phoenix Traces",
          description: "One row per Phoenix trace (an LLM request)",
          sql: `SELECT
  t.trace_id AS trace_id,
  ${PHOENIX_USER_ID_EXPR} AS user_id,
  ${PHOENIX_SESSION_ID_EXPR} AS session_id,
  t.start_time AS timestamp,
  root.name AS trace_name,
  root.status_code AS status_code,
  EXTRACT(EPOCH FROM (t.end_time - t.start_time)) * 1000 AS latency_ms,
  root.cumulative_llm_token_count_prompt AS input_tokens,
  root.cumulative_llm_token_count_completion AS output_tokens
FROM ${tablePrefix}${PHOENIX_TABLES.traces} t
${traceJoins}
WHERE
  ${dateClause("t.start_time")}${projectClause}`,
          eventName: "",
          userIdTypes: LLM_TRACE_USER_ID_TYPES,
          columns: generateColumns({
            trace_id: { datatype: "string" },
            user_id: { datatype: "string" },
            session_id: { datatype: "string" },
            timestamp: { datatype: "date" },
            trace_name: { datatype: "string", alwaysInlineFilter: true },
            status_code: { datatype: "string" },
            latency_ms: {
              datatype: "number",
              numberFormat: "time:milliseconds",
            },
            input_tokens: { datatype: "number" },
            output_tokens: { datatype: "number" },
          }),
        },
        filters: [
          {
            name: "Errors",
            description: "Traces whose root span ended with an error status",
            value: `status_code = 'ERROR'`,
          },
        ],
        metrics: [
          {
            name: "Traces per user",
            metricType: "mean",
            numerator: { factTableId: "", column: "$$count" },
          },
        ],
      },
      {
        factTable: {
          name: "Phoenix Spans",
          description:
            "One row per Phoenix span with latency, token, and cost details",
          sql: `SELECT
  s.span_id AS span_id,
  t.trace_id AS trace_id,
  ${PHOENIX_USER_ID_EXPR} AS user_id,
  ${PHOENIX_SESSION_ID_EXPR} AS session_id,
  s.start_time AS timestamp,
  s.name AS span_name,
  s.span_kind AS span_kind,
  root.name AS trace_name,
  s.status_code AS status_code,
  s.attributes->'llm'->>'model_name' AS model,
  EXTRACT(EPOCH FROM (s.end_time - s.start_time)) * 1000 AS latency_ms,
  s.llm_token_count_prompt AS input_tokens,
  s.llm_token_count_completion AS output_tokens,
  COALESCE(s.llm_token_count_prompt, 0) + COALESCE(s.llm_token_count_completion, 0) AS total_tokens,
  c.total_cost AS total_cost
FROM ${tablePrefix}${PHOENIX_TABLES.spans} s
JOIN ${tablePrefix}${PHOENIX_TABLES.traces} t ON t.id = s.trace_rowid
${traceJoins}
LEFT JOIN ${tablePrefix}${PHOENIX_TABLES.spanCosts} c ON c.span_rowid = s.id
WHERE
  ${dateClause("s.start_time")}${projectClause}`,
          eventName: "",
          userIdTypes: LLM_TRACE_USER_ID_TYPES,
          columns: generateColumns({
            span_id: { datatype: "string" },
            trace_id: { datatype: "string" },
            user_id: { datatype: "string" },
            session_id: { datatype: "string" },
            timestamp: { datatype: "date" },
            span_name: { datatype: "string", alwaysInlineFilter: true },
            span_kind: { datatype: "string" },
            trace_name: { datatype: "string" },
            status_code: { datatype: "string" },
            model: { datatype: "string", alwaysInlineFilter: true },
            latency_ms: {
              datatype: "number",
              numberFormat: "time:milliseconds",
            },
            input_tokens: { datatype: "number" },
            output_tokens: { datatype: "number" },
            total_tokens: { datatype: "number" },
            total_cost: { datatype: "number", numberFormat: "currency" },
          }),
        },
        filters: [
          {
            name: "LLM Spans",
            description: "Spans that are model calls",
            value: `span_kind = 'LLM'`,
          },
          {
            name: "Errors",
            description: "Spans that ended with an error status",
            value: `status_code = 'ERROR'`,
          },
        ],
        metrics: getLlmCallMetrics("LLM Spans", "Errors"),
      },
      {
        factTable: {
          name: "Phoenix Annotations",
          description:
            "One row per Phoenix span annotation (LLM evals, code checks, and human feedback)",
          sql: `SELECT
  a.id AS annotation_id,
  s.span_id AS span_id,
  t.trace_id AS trace_id,
  ${PHOENIX_USER_ID_EXPR} AS user_id,
  ${PHOENIX_SESSION_ID_EXPR} AS session_id,
  a.created_at AS timestamp,
  a.name AS annotation_name,
  a.label AS annotation_label,
  a.score AS annotation_score,
  a.annotator_kind AS annotator_kind,
  s.name AS span_name,
  root.name AS trace_name
FROM ${tablePrefix}${PHOENIX_TABLES.spanAnnotations} a
JOIN ${tablePrefix}${PHOENIX_TABLES.spans} s ON s.id = a.span_rowid
JOIN ${tablePrefix}${PHOENIX_TABLES.traces} t ON t.id = s.trace_rowid
${traceJoins}
WHERE
  ${dateClause("a.created_at")}${projectClause}`,
          eventName: "",
          userIdTypes: LLM_TRACE_USER_ID_TYPES,
          columns: generateColumns({
            annotation_id: { datatype: "string" },
            span_id: { datatype: "string" },
            trace_id: { datatype: "string" },
            user_id: { datatype: "string" },
            session_id: { datatype: "string" },
            timestamp: { datatype: "date" },
            annotation_name: { datatype: "string", alwaysInlineFilter: true },
            annotation_label: { datatype: "string" },
            annotation_score: { datatype: "number" },
            annotator_kind: { datatype: "string" },
            span_name: { datatype: "string" },
            trace_name: { datatype: "string" },
          }),
        },
        filters: [
          {
            name: "LLM Evals",
            description: "Annotations produced by an LLM judge",
            value: `annotator_kind = 'LLM'`,
          },
        ],
        metrics: [],
      },
    ],
  };
}

export function getInitialDatasourceResources({
  datasource,
  attributeSchema,
}: {
  datasource: DataSourceInterfaceWithParams;
  attributeSchema?: SDKAttributeSchema;
}): InitialDatasourceResources {
  if (datasource.type === "growthbook_clickhouse") {
    return getBuiltInWarehouseResources(attributeSchema);
  }

  switch (datasource.settings?.schemaFormat) {
    case "ga4":
      return getGA4Resources(datasource);
    case "segment":
      return getSegmentResources(datasource);
    case "rudderstack":
      return getRudderstackResources(datasource);
    case "amplitude":
      return getAmplitudeResources(datasource);
    case "langfuse":
      return getLangfuseResources(datasource);
    case "phoenix":
      return getPhoenixResources(datasource);
    case undefined:
    case "custom":
    case "mixpanel":
    case "snowplow":
    case "jitsu":
    case "freshpaint":
    case "fullstory":
    case "matomo":
    case "heap":
    case "mparticle":
    case "firebase":
    case "keen":
    case "clevertap":
    case "eventForwarder":
      break;
    // TODO: add more
  }

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
        },
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
            },
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
          if (metric.numerator?.rowFilters?.length) {
            metric.numerator.rowFilters = metric.numerator.rowFilters.map(
              (rf) => {
                if (
                  rf.operator === "saved_filter" &&
                  rf.values &&
                  rf.values[0]
                ) {
                  const filterId = filterMap[rf.values[0]];
                  if (!filterId) {
                    throw new Error("Required filters not created");
                  }
                  return {
                    ...rf,
                    values: filterId ? [filterId] : [],
                  };
                }
                return rf;
              },
            );
          }
          if (metric.denominator?.rowFilters?.length) {
            metric.denominator.rowFilters = metric.denominator.rowFilters.map(
              (rf) => {
                if (
                  rf.operator === "saved_filter" &&
                  rf.values &&
                  rf.values[0]
                ) {
                  const filterId = filterMap[rf.values[0]];
                  if (!filterId) {
                    throw new Error("Required filters not created");
                  }
                  return {
                    ...rf,
                    values: filterId ? [filterId] : [],
                  };
                }
                return rf;
              },
            );
          }

          // Inject factTableId into numerator and denominator
          if (metric.numerator) {
            metric.numerator.factTableId = factTableId;
          }
          if (metric.denominator) {
            metric.denominator.factTableId = factTableId;
          }

          const metricBody = getDefaultFactMetricProps({
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
