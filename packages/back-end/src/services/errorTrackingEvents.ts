import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import {
  esc,
  chErrorDisplayTitleExpr,
  clickhouseTimestampToIso,
} from "back-end/src/services/errorTrackingIssues";

export function parseTimestampMsQuery(
  raw: string | undefined,
): number | undefined {
  if (!raw) return undefined;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

export function parseMaybeJson(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Resolve the user-visible error title for one event. Prefer `properties.message`, then the first
 * stack line (often repeats `Error.message`), then stored `title`.
 */
export function resolveErrorEventDisplayTitle(
  properties: Record<string, unknown>,
  rowTitle: string,
): string {
  const fromMessage = properties.message;
  if (typeof fromMessage === "string" && fromMessage.trim()) {
    return fromMessage.trim();
  }

  const stack = properties.stack;
  if (typeof stack === "string" && stack.trim()) {
    const head =
      stack.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
    const trimmed = head.trim();
    if (trimmed && !/^at\s+/i.test(trimmed)) {
      const withoutName = trimmed.replace(/^[A-Za-z0-9_$]+\s*:\s*/, "").trim();
      if (withoutName.length > 0) return withoutName;
    }
  }

  const fromTitle = properties.title;
  if (typeof fromTitle === "string" && fromTitle.trim()) {
    return fromTitle.trim();
  }

  return rowTitle.trim();
}

export type EventSummary = {
  eventId: string;
  timestamp: string;
  title: string;
  errorType: string;
  transaction: string;
  release: string;
  environment: string;
  user: string;
  device: string;
  os: string;
  url: string;
  runtime: string;
};

type EventListRow = {
  event_uuid: unknown;
  timestamp: unknown;
  title: unknown;
  error_type: unknown;
  transaction_name: unknown;
  release_version: unknown;
  environment: unknown;
  user_id: unknown;
  device_id: unknown;
  ua_device_type: unknown;
  ua_os: unknown;
  url: unknown;
  runtime_name: unknown;
};

export function buildEventSummary(row: EventListRow): EventSummary {
  return {
    eventId: String(row.event_uuid || ""),
    timestamp: clickhouseTimestampToIso(row.timestamp),
    title: String(row.title || ""),
    errorType: String(row.error_type || ""),
    transaction: String(row.transaction_name || ""),
    release: String(row.release_version || ""),
    environment: String(row.environment || ""),
    user: String(row.user_id || row.device_id || ""),
    device: String(row.ua_device_type || ""),
    os: String(row.ua_os || ""),
    url: String(row.url || ""),
    runtime: String(row.runtime_name || ""),
  };
}

/** Grouped, paginated event rows for one issue, plus the total matching count. */
export async function queryIssueEvents({
  integration,
  clientKey,
  fingerprint,
  q,
  limit,
  offset,
  fromMs,
  toMs,
  order,
}: {
  integration: SqlIntegration;
  clientKey: string;
  fingerprint: string;
  q?: string;
  limit: number;
  offset: number;
  fromMs?: number;
  toMs?: number;
  order?: "asc" | "desc";
}): Promise<{ rows: EventListRow[]; total: number }> {
  const searchClause = q
    ? `AND ((${chErrorDisplayTitleExpr()}) ILIKE '%${esc(
        integration,
        q,
      )}%' OR event_uuid = '${esc(integration, q)}')`
    : "";

  const dialect = integration.getSqlDialect();
  const timeClause =
    fromMs != null && toMs != null && fromMs < toMs
      ? `AND timestamp >= ${dialect.toTimestamp(new Date(fromMs))} AND timestamp < ${dialect.toTimestamp(new Date(toMs))}`
      : "";

  const whereClause = `
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
${searchClause}
${timeClause}
`;

  const orderAscending = order === "asc";
  const sql = `
SELECT
  event_uuid,
  timestamp,
  ${chErrorDisplayTitleExpr()} AS title,
  error_type,
  transaction_name,
  release_version,
  environment,
  user_id,
  device_id,
  ua_device_type,
  ua_os,
  url,
  runtime_name
FROM errors
${whereClause}
ORDER BY timestamp ${orderAscending ? "ASC" : "DESC"}, event_uuid ${orderAscending ? "ASC" : "DESC"}
LIMIT ${limit} OFFSET ${offset}
`;
  const countSql = `
SELECT count() AS total
FROM errors
${whereClause}
`;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    integration.runQuery(sql, undefined, {
      queryType: "errorTrackingEventList",
    }),
    integration.runQuery(countSql, undefined, {
      queryType: "errorTrackingEventList",
    }),
  ]);

  return {
    rows: rows as EventListRow[],
    total: Number(countRows[0]?.total || 0),
  };
}

type EventDetailRow = {
  event_uuid: unknown;
  timestamp: unknown;
  title: unknown;
  issue_fingerprint: unknown;
  properties: unknown;
  attributes: unknown;
  environment: unknown;
  release_version: unknown;
  user_id: unknown;
  device_id: unknown;
  url: unknown;
  transaction_name: unknown;
  error_type: unknown;
  runtime_name: unknown;
  ua_device_type: unknown;
  ua_os: unknown;
  ua_browser: unknown;
  sdk_version: unknown;
  sdk_language: unknown;
};

/** One event row by uuid (or the latest matching `eventSearch`), or undefined if not found. */
export async function queryEventDetailRow({
  integration,
  clientKey,
  eventUuid,
  fingerprint,
  eventSearch,
}: {
  integration: SqlIntegration;
  clientKey: string;
  eventUuid: string;
  fingerprint?: string;
  eventSearch?: string;
}): Promise<EventDetailRow | undefined> {
  const uuidFilter = eventSearch
    ? `event_uuid = '${esc(integration, eventSearch)}'`
    : `event_uuid = '${esc(integration, eventUuid)}'`;
  const fpClause = fingerprint
    ? `AND issue_fingerprint = '${esc(integration, fingerprint)}'`
    : "";

  const sql = `
SELECT
  event_uuid,
  timestamp,
  ${chErrorDisplayTitleExpr()} AS title,
  issue_fingerprint,
  properties,
  attributes,
  environment,
  release_version,
  user_id,
  device_id,
  url,
  transaction_name,
  error_type,
  runtime_name,
  ua_device_type,
  ua_os,
  ua_browser,
  sdk_version,
  sdk_language
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND ${uuidFilter}
${fpClause}
ORDER BY timestamp DESC
LIMIT 1
`;
  const { rows } = await integration.runQuery(sql, undefined, {
    queryType: "errorTrackingEventDetail",
  });
  return rows[0] as EventDetailRow | undefined;
}

type RelatedRow = Record<string, unknown> & { lastSeen?: unknown };

async function queryRelated({
  integration,
  table,
  selectCols,
  groupCols,
  userId,
}: {
  integration: SqlIntegration;
  table: "feature_usage" | "experiment_views";
  selectCols: string;
  groupCols: string;
  userId: string;
}): Promise<RelatedRow[]> {
  const sql = `
SELECT
  ${selectCols},
  count() AS ${table === "feature_usage" ? "evaluations" : "views"},
  max(timestamp) AS lastSeen
FROM ${table}
WHERE user_id = '${esc(integration, userId)}'
AND timestamp > now() - INTERVAL 7 DAY
GROUP BY ${groupCols}
ORDER BY lastSeen DESC
LIMIT 40
`;
  const { rows } = await integration.runQuery(sql, undefined, {
    queryType: "errorTrackingEventDetail",
  });
  return rows.map((r) => ({
    ...r,
    lastSeen: clickhouseTimestampToIso((r as RelatedRow).lastSeen),
  }));
}

export function queryRelatedFeatureUsage({
  integration,
  userId,
}: {
  integration: SqlIntegration;
  userId: string;
}): Promise<RelatedRow[]> {
  return queryRelated({
    integration,
    table: "feature_usage",
    selectCols: "feature, value",
    groupCols: "feature, value",
    userId,
  });
}

export function queryRelatedExperimentViews({
  integration,
  userId,
}: {
  integration: SqlIntegration;
  userId: string;
}): Promise<RelatedRow[]> {
  return queryRelated({
    integration,
    table: "experiment_views",
    selectCols: "experiment_id, variation_id",
    groupCols: "experiment_id, variation_id",
    userId,
  });
}

export type EventDetail = {
  event_uuid: string;
  timestamp: string;
  title: string;
  issue_fingerprint: string;
  properties: Record<string, unknown>;
  attributes: Record<string, unknown>;
  environment: string;
  release_version: string;
  user_id: string;
  device_id: string;
  url: string;
  transaction_name: string;
  error_type: string;
  runtime_name: string;
  ua_device_type: string;
  ua_os: string;
  ua_browser: string;
  sdk_version: string;
  sdk_language: string;
};

export function buildEventDetail(row: EventDetailRow): {
  detail: EventDetail;
  properties: Record<string, unknown>;
  userId: string;
  release: string;
} {
  const properties = parseMaybeJson(row.properties);
  const displayTitle = resolveErrorEventDisplayTitle(
    properties,
    String(row.title || ""),
  );
  properties.title = displayTitle;
  if (typeof properties.message !== "string" || !properties.message.trim()) {
    properties.message = displayTitle;
  }
  const attributes = parseMaybeJson(row.attributes);
  const userId = String(row.user_id || row.device_id || "");
  const release = String(row.release_version || properties.release || "");

  return {
    properties,
    userId,
    release,
    detail: {
      event_uuid: String(row.event_uuid || ""),
      timestamp: clickhouseTimestampToIso(row.timestamp),
      title: displayTitle,
      issue_fingerprint: String(row.issue_fingerprint || ""),
      properties,
      attributes,
      environment: String(row.environment || ""),
      release_version: release,
      user_id: String(row.user_id || ""),
      device_id: String(row.device_id || ""),
      url: String(row.url || ""),
      transaction_name: String(row.transaction_name || ""),
      error_type: String(row.error_type || ""),
      runtime_name: String(row.runtime_name || ""),
      ua_device_type: String(row.ua_device_type || ""),
      ua_os: String(row.ua_os || ""),
      ua_browser: String(row.ua_browser || ""),
      sdk_version: String(row.sdk_version || ""),
      sdk_language: String(row.sdk_language || ""),
    },
  };
}
