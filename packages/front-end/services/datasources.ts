import { DataSourceSettings } from "back-end/types/datasource";

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
  ${settings?.experiments?.variationColumn || "variation_id"} as variation_id,
  '' as url,
  '' as user_agent
FROM 
  ${schema && !settings?.experiments?.table?.match(/\./) ? schema + "." : ""}${
    settings?.experiments?.table || "experiment_viewed"
  }`;
}
export function getUsersQuery(
  settings: DataSourceSettings,
  schema?: string
): string {
  if (settings?.queries?.usersQuery) {
    return settings.queries.usersQuery;
  }

  return `SELECT
  ${
    settings?.identifies?.userIdColumn ||
    settings?.default?.userIdColumn ||
    "user_id"
  } as user_id,
  ${
    settings?.identifies?.anonymousIdColumn ||
    settings?.default?.anonymousIdColumn ||
    "anonymous_id"
  } as anonymous_id
FROM 
  ${schema && !settings?.identifies?.table?.match(/\./) ? schema + "." : ""}${
    settings?.identifies?.table || "identifies"
  }`;
}

export function getPageviewsQuery(
  settings: DataSourceSettings,
  schema?: string
): string {
  if (settings?.queries?.pageviewsQuery) {
    return settings.queries.pageviewsQuery;
  }

  return `SELECT
  ${
    settings?.pageviews?.userIdColumn ||
    settings?.default?.userIdColumn ||
    "user_id"
  } as user_id,
  ${
    settings?.pageviews?.anonymousIdColumn ||
    settings?.default?.anonymousIdColumn ||
    "anonymous_id"
  } as anonymous_id,
  ${
    settings?.pageviews?.timestampColumn ||
    settings?.default?.timestampColumn ||
    "received_at"
  } as timestamp,
  ${settings?.pageviews?.urlColumn || "path"} as url,
  '' as user_agent
FROM 
  ${schema && !settings?.pageviews?.table?.match(/\./) ? schema + "." : ""}${
    settings?.pageviews?.table || "pages"
  }`;
}
