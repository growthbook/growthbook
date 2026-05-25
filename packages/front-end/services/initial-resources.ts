import {
  ColumnInterface,
  CreateColumnProps,
  CreateFactFilterProps,
  CreateFactMetricProps,
  CreateFactTableProps,
  FactTableInterface,
} from "shared/types/fact-table";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import {
  DataSourceInterfaceWithParams,
  MaterializedColumn,
} from "shared/types/datasource";
import { buildManagedWarehouseFactTableSQL } from "shared/util";
import {
  MetricDefaults,
  OrganizationSettings,
} from "shared/types/organization";
import { getDefaultFactMetricProps } from "@/services/metrics";
import { ApiCallType } from "@/services/auth";
import { getTablePrefix } from "@/services/datasources";

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

/**
 * Pull the materialized columns from a managed-warehouse datasource so the
 * initial fact table can list user-attribute columns (e.g. `tier`) and alias
 * their physical `matcol__*` names back to the logical identifier.
 *
 * Falls back to the legacy `materializedColumns` field for pre-migration orgs
 * that haven't run an attribute-driven sync yet — without this, auto-seeded
 * fact tables for those orgs would silently omit any key attributes they had
 * configured under the old Key Attributes UI until the first sync.
 *
 * Returns `null` when the datasource has no snapshot under either field
 * (would only happen for a malformed managed-warehouse row); the caller
 * falls back to the minimal built-in column set.
 */
function getManagedWarehouseMaterializedColumns(
  datasource: DataSourceInterfaceWithParams,
): MaterializedColumn[] | null {
  if (datasource.type !== "growthbook_clickhouse") return null;
  const settings = datasource.settings as {
    syncedMaterializedColumns?: MaterializedColumn[];
    materializedColumns?: MaterializedColumn[];
  };
  const cols =
    settings?.syncedMaterializedColumns ?? settings?.materializedColumns;
  return cols ?? null;
}

function getBuiltInWarehouseResources(
  datasource: DataSourceInterfaceWithParams,
): InitialDatasourceResources {
  const materializedColumns =
    getManagedWarehouseMaterializedColumns(datasource) ?? [];

  // Base columns the events table always exposes (independent of attribute
  // schema). The user-attribute columns + ingestor-enriched columns layer
  // on top from `materializedColumns`.
  const baseColumns: Record<string, Partial<ColumnInterface>> = {
    timestamp: { datatype: "date" },
    properties: { datatype: "json" },
    attributes: { datatype: "json" },
    event_name: { datatype: "string", alwaysInlineFilter: true },
    client_key: { datatype: "string" },
    environment: { datatype: "string" },
    sdk_language: { datatype: "string" },
    sdk_version: { datatype: "string" },
    event_uuid: { datatype: "string" },
    ip: { datatype: "string" },
  };
  const materializedFactColumns: Record<
    string,
    Partial<ColumnInterface>
  > = Object.fromEntries(
    materializedColumns.map((c) => [
      c.columnName,
      {
        datatype: c.arrayElementType ? "other" : c.datatype,
      },
    ]),
  );

  const sql = buildManagedWarehouseFactTableSQL(materializedColumns);
  const userIdTypes = materializedColumns
    .filter((c) => c.type === "identifier")
    .map((c) => c.columnName);

  return {
    factTables: [
      // Events
      {
        factTable: {
          // Give it a known id so we can reference it easily
          id: MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
          name: "Events",
          description: "",
          sql,
          // Mark the fact table as Official and block editing/deleting in the UI
          managedBy: "api",
          columns: generateColumns({
            ...baseColumns,
            ...materializedFactColumns,
          }),
          // userIdTypes mirrors the materialized identifier columns — and
          // stays empty when there are none, matching the datasource's
          // derived `userIdTypes` so the two never disagree on assignment
          // units for an org without identifier attributes configured yet.
          userIdTypes,
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

export function getInitialDatasourceResources({
  datasource,
}: {
  datasource: DataSourceInterfaceWithParams;
}): InitialDatasourceResources {
  if (datasource.type === "growthbook_clickhouse") {
    return getBuiltInWarehouseResources(datasource);
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
