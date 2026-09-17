import { format } from "shared/sql";
import type { EventLogRecordsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import type { EventLogTableConfig } from "./event-log-summary-query";

/**
 * Column sets shared across SELECT branches. The events table has all columns
 * natively; experiment_views and feature_usage need synthetic/NULL-filled cols.
 */
function eventsColumns(table: string): string {
  return `${table}.event_uuid, ${table}.timestamp, ${table}.event_name, ${table}.user_id,
    ${table}.device_id, ${table}.environment, ${table}.properties, ${table}.attributes,
    ${table}.url, ${table}.geo_country, ${table}.ua_browser, ${table}.ua_os,
    ${table}.ua_device_type, ${table}.sdk_language, ${table}.sdk_version`;
}

function experimentViewsColumns(table: string, dialect: SqlDialect): string {
  return `${table}.event_uuid, ${table}.timestamp,
    ${dialect.castToString("'Experiment Viewed'")} AS event_name, ${table}.user_id,
    ${table}.device_id, ${table}.environment, ${table}.properties, ${table}.attributes,
    ${table}.url, ${table}.geo_country, ${table}.ua_browser, ${table}.ua_os,
    ${table}.ua_device_type, ${table}.sdk_language, ${table}.sdk_version`;
}

function featureUsageColumns(table: string, dialect: SqlDialect): string {
  // feature_usage lacks most columns — NULL-fill them. Cast NULLs to string
  // for type alignment across UNION branches.
  const nullStr = `${dialect.castToString("NULL")}`;
  return `CONCAT('feature-usage-',
      ${dialect.castToString(`CONCAT(${table}.timestamp, '-', ${table}.client_key, '-', ${table}.environment, '-', ${table}.feature)`)}) AS event_uuid,
    ${table}.timestamp,
    ${dialect.castToString("'Feature Evaluated'")} AS event_name,
    ${nullStr} AS user_id, ${nullStr} AS device_id,
    ${table}.environment,
    ${nullStr} AS properties, ${nullStr} AS attributes,
    ${nullStr} AS url, ${nullStr} AS geo_country,
    ${nullStr} AS ua_browser, ${nullStr} AS ua_os,
    ${nullStr} AS ua_device_type, ${nullStr} AS sdk_language, ${nullStr} AS sdk_version`;
}

/**
 * Dialect-agnostic records query. Routes to specific tables when event name
 * is known to avoid unnecessary UNION ALL scans.
 */
export function getEventLogRecordsQuery(
  dialect: SqlDialect,
  params: EventLogRecordsQueryParams,
  tableConfig: EventLogTableConfig,
): string {
  const escapedKeys = params.clientKeys
    .map((k) => `'${dialect.escapeStringLiteral(k)}'`)
    .join(", ");

  const limit = Math.max(1, Math.min(100, Math.floor(params.limit)));
  const offset = Math.max(0, Math.floor(params.offset));

  const extraConditions: string[] = [];
  if (params.userId) {
    extraConditions.push(
      `user_id = '${dialect.escapeStringLiteral(params.userId)}'`,
    );
  }
  if (params.environment) {
    extraConditions.push(
      `environment = '${dialect.escapeStringLiteral(params.environment)}'`,
    );
  }
  if (params.browser) {
    extraConditions.push(
      `ua_browser = '${dialect.escapeStringLiteral(params.browser)}'`,
    );
  }
  if (params.os) {
    extraConditions.push(`ua_os = '${dialect.escapeStringLiteral(params.os)}'`);
  }
  if (params.country) {
    extraConditions.push(
      `geo_country = '${dialect.escapeStringLiteral(params.country)}'`,
    );
  }
  if (params.sdk) {
    extraConditions.push(
      `sdk_language = '${dialect.escapeStringLiteral(params.sdk)}'`,
    );
  }

  const extraWhere = extraConditions.length
    ? ` AND ${extraConditions.join(" AND ")}`
    : "";

  // feature_usage only supports environment filtering
  const hasUnsupportedFeatureUsageFilter = Boolean(
    params.userId ||
      params.browser ||
      params.os ||
      params.country ||
      params.sdk,
  );
  const featureUsageExtraWhere = params.environment
    ? ` AND environment = '${dialect.escapeStringLiteral(params.environment)}'`
    : "";

  const baseWhere = `client_key IN (${escapedKeys})
    AND timestamp >= ${dialect.toTimestamp(params.dateFrom)}
    AND timestamp < ${dialect.toTimestamp(params.dateTo)}${extraWhere}`;

  const featureUsageWhere = `client_key IN (${escapedKeys})
    AND timestamp >= ${dialect.toTimestamp(params.dateFrom)}
    AND timestamp < ${dialect.toTimestamp(params.dateTo)}${featureUsageExtraWhere}`;

  const tail = `ORDER BY timestamp DESC
    LIMIT ${limit} OFFSET ${offset}`;

  let sql: string;

  if (params.eventName === "Experiment Viewed") {
    sql = `SELECT ${experimentViewsColumns("t", dialect)}
      FROM ${tableConfig.experimentViewsTable} t
      WHERE ${baseWhere}
      ${tail}`;
  } else if (params.eventName === "Feature Evaluated") {
    if (hasUnsupportedFeatureUsageFilter) {
      // Return no rows — the caller checks for an empty result
      sql = `SELECT ${featureUsageColumns("t", dialect)}
        FROM ${tableConfig.featureUsageTable} t
        WHERE 1 = 0`;
    } else {
      sql = `SELECT ${featureUsageColumns("t", dialect)}
        FROM ${tableConfig.featureUsageTable} t
        WHERE ${featureUsageWhere}
        ${tail}`;
    }
  } else if (params.eventName) {
    sql = `SELECT ${eventsColumns("t")}
      FROM ${tableConfig.eventsTable} t
      WHERE ${baseWhere}
        AND event_name = '${dialect.escapeStringLiteral(params.eventName)}'
      ${tail}`;
  } else {
    const featureUsageUnion = hasUnsupportedFeatureUsageFilter
      ? ""
      : `
        UNION ALL
        SELECT ${featureUsageColumns("t", dialect)} FROM ${tableConfig.featureUsageTable} t
        WHERE ${featureUsageWhere}`;
    sql = `SELECT * FROM (
        SELECT ${eventsColumns("t")} FROM ${tableConfig.eventsTable} t
        WHERE ${baseWhere}
        UNION ALL
        SELECT ${experimentViewsColumns("t", dialect)} FROM ${tableConfig.experimentViewsTable} t
        WHERE ${baseWhere}${featureUsageUnion}
      )
      ${tail}`;
  }

  return format(sql, dialect.formatDialect);
}
