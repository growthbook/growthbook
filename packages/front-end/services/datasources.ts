import {
  DataSourceSettings,
  DataSourceType,
  SchemaFormat,
} from "back-end/types/datasource";

export function getInitialSettings(
  datasource: DataSourceType,
  type: SchemaFormat,
  tablePrefix: string = ""
): Partial<DataSourceSettings> {
  if (type === "ga4" && datasource === "bigquery") {
    return {
      queries: {
        experimentsQuery: `SELECT
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
    WHERE p.key = 'experiment_id' LIMIT 1
  ) as variation_id,
  geo.country as country,
  traffic_source.source as source,
  traffic_source.medium as medium,
  device.category as device,
  device.web_info.browser as browser,
  device.operating_system as os
FROM
  \`${tablePrefix}events_*\`
WHERE
  event_name = 'viewed_experiment'  
  AND _TABLE_SUFFIX BETWEEN '{{startYear}}{{startMonth}}{{startDay}}' AND '{{endYear}}{{endMonth}}{{endDay}}'
  `,
        identityJoins: [],
      },
      experimentDimensions: [
        "country",
        "source",
        "medium",
        "device",
        "browser",
        "os",
      ],
    };
  }

  // Default to Segment
  return {
    queries: {
      experimentsQuery: `SELECT
user_id,
anonymous_id,
received_at as timestamp,
experiment_id,
variation_id,
context_location_country as country
FROM
${tablePrefix}experiment_viewed`,
      identityJoins: [
        {
          ids: ["user_id", "anonymous_id"],
          query: `SELECT
user_id,
anonymous_id
FROM
${tablePrefix}identifies`,
        },
      ],
    },
    experimentDimensions: ["country"],
  };
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
