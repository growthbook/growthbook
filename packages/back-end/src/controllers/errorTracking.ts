import { Response } from "express";
import { ManagedWarehousePendingError } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getGrowthbookDatasource } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getContextFromReq } from "back-end/src/services/organizations";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { generateId } from "back-end/src/util/uuid";
import {
  ErrorTrackingIssueModel,
  ErrorTrackingIssueDocument,
} from "back-end/src/models/ErrorTrackingIssueModel";
import { buildSymbolicatedStack } from "back-end/src/services/errorTrackingSymbolication";
import {
  fillIssueTrendSeries,
  getAllTimeIssueGraphQuery,
  TrendPoint,
  utcStartOfDay,
  utcStartOfHour,
  utcStartOfMinute,
} from "back-end/src/services/errorTrackingIssueGraph";

function esc(integration: SqlIntegration, value: string): string {
  return integration.getSqlDialect().escapeStringLiteral(value);
}

async function requireClickhouse(
  context: ReturnType<typeof getContextFromReq>,
) {
  const ds = await getGrowthbookDatasource(context);
  if (!ds) {
    throw new Error(
      "Managed warehouse is not configured for this organization.",
    );
  }
  const integration = getSourceIntegrationObject(context, ds, true);
  if (!(integration instanceof SqlIntegration)) {
    throw new Error("Managed warehouse datasource is not ClickHouse.");
  }
  return { datasource: ds, integration };
}

function parseMaybeJson(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** ClickHouse: prefer explicit `message` (full `Error.message`) over `title` when both exist in `properties` JSON. */
function chErrorDisplayTitleExpr(): string {
  return `coalesce(nullIf(JSONExtractString(properties, 'message'), ''), title)`;
}

/**
 * Resolve the user-visible error title for one event. Prefer `properties.message`, then the first
 * stack line (often repeats `Error.message`), then stored `title`.
 */
function resolveErrorEventDisplayTitle(
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

function buildTrendBuckets(
  bucketCount: number,
  granularity: "minute" | "hour" | "day",
): TrendPoint[] {
  const end =
    granularity === "minute"
      ? utcStartOfMinute()
      : granularity === "hour"
        ? utcStartOfHour()
        : utcStartOfDay();
  const spanMs =
    granularity === "minute"
      ? 60_000
      : granularity === "hour"
        ? 3_600_000
        : 86_400_000;
  const buckets: TrendPoint[] = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    buckets.push({ t: end - i * spanMs, v: 0 });
  }
  return buckets;
}

type IssueGraphRange = "hour" | "day" | "week" | "month" | "all";

function parseIssueGraphRange(raw: string | undefined): IssueGraphRange {
  if (
    raw === "hour" ||
    raw === "day" ||
    raw === "week" ||
    raw === "month" ||
    raw === "all"
  ) {
    return raw;
  }
  return "week";
}

function getIssueGraphQuery(
  range: IssueGraphRange,
  firstSeen: string,
  lastSeen: string,
  integration: SqlIntegration,
): {
  filterSql: string;
  groupExpr: string;
  buckets: TrendPoint[];
} {
  switch (range) {
    case "hour":
      return {
        filterSql: "AND timestamp > now() - INTERVAL 1 HOUR",
        groupExpr: "toStartOfMinute(timestamp)",
        buckets: buildTrendBuckets(60, "minute"),
      };
    case "day":
      return {
        filterSql: "AND timestamp > now() - INTERVAL 24 HOUR",
        groupExpr: "toStartOfHour(timestamp)",
        buckets: buildTrendBuckets(24, "hour"),
      };
    case "month":
      return {
        filterSql: "AND timestamp > now() - INTERVAL 30 DAY",
        groupExpr: "toStartOfDay(timestamp)",
        buckets: buildTrendBuckets(30, "day"),
      };
    case "all": {
      const firstSeenDate = new Date(String(firstSeen) + "Z");
      const allTimeGraph = getAllTimeIssueGraphQuery(firstSeen, lastSeen);
      return {
        filterSql: `AND timestamp >= ${integration.getSqlDialect().toTimestamp(firstSeenDate)}`,
        groupExpr: allTimeGraph.groupExpr,
        buckets: allTimeGraph.buckets,
      };
    }
    case "week":
    default:
      return {
        filterSql: "AND timestamp > now() - INTERVAL 7 DAY",
        groupExpr: "toStartOfHour(timestamp)",
        buckets: buildTrendBuckets(24 * 7, "hour"),
      };
  }
}

async function getIssueDocs(
  organization: string,
  clientKey: string,
  fingerprints: string[],
): Promise<Map<string, ErrorTrackingIssueDocument>> {
  if (!fingerprints.length) return new Map();
  const docs = await ErrorTrackingIssueModel.find({
    organization,
    clientKey,
    fingerprint: { $in: fingerprints },
  }).exec();
  return new Map(docs.map((d) => [d.fingerprint, d]));
}

/** List issues for a client key (grouped by fingerprint). Query: clientKey, q?, limit?, offset? */
export async function getIssues(
  req: AuthRequest<
    unknown,
    Record<string, never>,
    { clientKey?: string; q?: string; limit?: string; offset?: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const clientKey = req.query.clientKey?.trim();
  if (!clientKey) {
    return res
      .status(400)
      .json({ status: 400, message: "clientKey is required" });
  }

  try {
    const { integration } = await requireClickhouse(context);
    const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);
    const q = req.query.q?.trim();
    const groupedIssuesSql = `
SELECT
  issue_fingerprint,
  argMax(${chErrorDisplayTitleExpr()}, timestamp) AS title,
  max(timestamp) AS last_seen,
  min(timestamp) AS first_seen,
  count() AS events,
  uniqExact(coalesce(nullIf(user_id, ''), device_id)) AS users
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
GROUP BY issue_fingerprint
`;
    const searchClause = q
      ? `WHERE (
  title ILIKE '%${esc(integration, q)}%'
  OR issue_fingerprint = '${esc(integration, q)}'
)`
      : "";
    const groupedSql = `
SELECT *
FROM (${groupedIssuesSql}) AS grouped_issues
${searchClause}
ORDER BY last_seen DESC
LIMIT ${limit} OFFSET ${offset}
`;

    const { rows: issueRows } = await integration.runQuery(groupedSql);
    const fingerprints = issueRows.map((r) =>
      String(r.issue_fingerprint || ""),
    );
    const meta = await getIssueDocs(context.org.id, clientKey, fingerprints);

    const inList =
      fingerprints.length > 0
        ? fingerprints.map((f) => `'${esc(integration, f)}'`).join(",")
        : "''";

    const trend24Sql = `
SELECT
  issue_fingerprint,
  toUnixTimestamp(toStartOfHour(timestamp)) AS ts,
  count() AS c
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND timestamp > now() - INTERVAL 24 HOUR
AND issue_fingerprint IN (${inList})
GROUP BY issue_fingerprint, toStartOfHour(timestamp)
ORDER BY issue_fingerprint, ts
`;

    const trend30Sql = `
SELECT
  issue_fingerprint,
  toUnixTimestamp(toStartOfDay(timestamp)) AS ts,
  count() AS c
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND timestamp > now() - INTERVAL 30 DAY
AND issue_fingerprint IN (${inList})
GROUP BY issue_fingerprint, toStartOfDay(timestamp)
ORDER BY issue_fingerprint, ts
`;

    const trend24 =
      fingerprints.length > 0
        ? (await integration.runQuery(trend24Sql)).rows
        : [];
    const trend30 =
      fingerprints.length > 0
        ? (await integration.runQuery(trend30Sql)).rows
        : [];

    const trend24Buckets = buildTrendBuckets(24, "hour");
    const trend30Buckets = buildTrendBuckets(30, "day");
    const byFp24 = new Map<string, TrendPoint[]>();
    const byFp30 = new Map<string, TrendPoint[]>();

    for (const r of trend24) {
      const fp = String(r.issue_fingerprint || "");
      const ts = Number(r.ts) * 1000;
      const c = Number(r.c || 0);
      const arr = byFp24.get(fp) || [];
      arr.push({ t: ts, v: c });
      byFp24.set(fp, arr);
    }
    for (const r of trend30) {
      const fp = String(r.issue_fingerprint || "");
      const ts = Number(r.ts) * 1000;
      const c = Number(r.c || 0);
      const arr = byFp30.get(fp) || [];
      arr.push({ t: ts, v: c });
      byFp30.set(fp, arr);
    }

    const issues = issueRows.map((r) => {
      const fp = String(r.issue_fingerprint || "");
      const doc = meta.get(fp);
      return {
        fingerprint: fp,
        title: String(r.title || ""),
        lastSeen: new Date(String(r.last_seen) + "Z").toISOString(),
        firstSeen: new Date(String(r.first_seen) + "Z").toISOString(),
        events: Number(r.events || 0),
        users: Number(r.users || 0),
        trend24h: fillIssueTrendSeries(trend24Buckets, byFp24.get(fp) || []),
        trend30d: fillIssueTrendSeries(trend30Buckets, byFp30.get(fp) || []),
        assigneeUserId: doc?.assigneeUserId || null,
        priority: doc?.priority || "medium",
        status: doc?.status || "open",
        resolvedAt: doc?.resolvedAt || null,
        resolvedInRelease: doc?.resolvedInRelease || null,
      };
    });

    return res.status(200).json({ status: 200, issues });
  } catch (e) {
    if (e instanceof ManagedWarehousePendingError) {
      return res.status(503).json({
        status: 503,
        message: "Managed warehouse is still provisioning.",
      });
    }
    throw e;
  }
}

export async function getIssueDetail(
  req: AuthRequest<
    unknown,
    { fingerprint: string },
    { clientKey?: string; graphRange?: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const clientKey = req.query.clientKey?.trim();
  const { fingerprint } = req.params;
  if (!clientKey) {
    return res
      .status(400)
      .json({ status: 400, message: "clientKey is required" });
  }

  try {
    const { integration } = await requireClickhouse(context);
    const sql = `
SELECT
  argMax(${chErrorDisplayTitleExpr()}, timestamp) AS title,
  max(timestamp) AS last_seen,
  min(timestamp) AS first_seen,
  count() AS events,
  uniqExact(coalesce(nullIf(user_id, ''), device_id)) AS users,
  argMax(release_version, timestamp) AS last_release,
  argMin(release_version, timestamp) AS first_release
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
`;
    const { rows } = await integration.runQuery(sql);
    const row = rows[0];
    if (!row || !row.last_seen) {
      return res.status(404).json({ status: 404, message: "Issue not found" });
    }

    const metaMap = await getIssueDocs(context.org.id, clientKey, [
      fingerprint,
    ]);
    const doc = metaMap.get(fingerprint);

    const dimensionsSql = `
SELECT environment, count() AS c
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
GROUP BY environment
ORDER BY c DESC
LIMIT 20
`;
    const { rows: envRows } = await integration.runQuery(dimensionsSql);

    const releaseSql = `
SELECT release_version, count() AS c
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
AND release_version != ''
GROUP BY release_version
ORDER BY c DESC
LIMIT 20
`;
    const { rows: relRows } = await integration.runQuery(releaseSql);

    const graphRange = parseIssueGraphRange(req.query.graphRange);
    const graphQuery = getIssueGraphQuery(
      graphRange,
      String(row.first_seen),
      String(row.last_seen),
      integration,
    );
    const graphSql = `
SELECT
  toUnixTimestamp(${graphQuery.groupExpr}) AS ts,
  count() AS c
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
${graphQuery.filterSql}
GROUP BY ${graphQuery.groupExpr}
ORDER BY ts
`;
    const { rows: graphRows } = await integration.runQuery(graphSql);
    const graphPoints = fillIssueTrendSeries(
      graphQuery.buckets,
      graphRows.map((g) => ({
        t: Number(g.ts) * 1000,
        v: Number(g.c || 0),
      })),
    );

    return res.status(200).json({
      status: 200,
      issue: {
        fingerprint,
        title: String(row.title || ""),
        lastSeen: new Date(String(row.last_seen) + "Z").toISOString(),
        firstSeen: new Date(String(row.first_seen) + "Z").toISOString(),
        events: Number(row.events || 0),
        users: Number(row.users || 0),
        lastRelease: String(row.last_release || ""),
        firstRelease: String(row.first_release || ""),
        assigneeUserId: doc?.assigneeUserId || null,
        priority: doc?.priority || "medium",
        status: doc?.status || "open",
        resolvedAt: doc?.resolvedAt || null,
        resolvedInRelease: doc?.resolvedInRelease || null,
        comments: doc?.comments || [],
      },
      dimensions: {
        environments: envRows.map((e) => ({
          name: String(e.environment || ""),
          count: Number(e.c || 0),
        })),
        releases: relRows.map((e) => ({
          name: String(e.release_version || ""),
          count: Number(e.c || 0),
        })),
      },
      graph: graphPoints.map((g) => ({
        t: g.t,
        c: g.v,
      })),
    });
  } catch (e) {
    if (e instanceof ManagedWarehousePendingError) {
      return res.status(503).json({
        status: 503,
        message: "Managed warehouse is still provisioning.",
      });
    }
    throw e;
  }
}

function parseTimestampMsQuery(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

/** ClickHouse DateTime often omits timezone; warehouse stores UTC. */
function clickhouseTimestampToIso(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString();
  }
  const normalized = s.includes("T") ? `${s}Z` : `${s.replace(" ", "T")}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

/** List events for one issue. Query: clientKey (req), q?, limit?, offset?, fromMs?, toMs?, order=asc|desc */
export async function getIssueEvents(
  req: AuthRequest<
    unknown,
    { fingerprint: string },
    {
      clientKey?: string;
      q?: string;
      limit?: string;
      offset?: string;
      fromMs?: string;
      toMs?: string;
      order?: string;
    }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const clientKey = req.query.clientKey?.trim();
  const { fingerprint } = req.params;
  if (!clientKey) {
    return res
      .status(400)
      .json({ status: 400, message: "clientKey is required" });
  }

  try {
    const { integration } = await requireClickhouse(context);
    const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);
    const q = req.query.q?.trim();
    const searchClause = q
      ? `AND ((${chErrorDisplayTitleExpr()}) ILIKE '%${esc(
          integration,
          q,
        )}%' OR event_uuid = '${esc(integration, q)}')`
      : "";

    const fromMs = parseTimestampMsQuery(req.query.fromMs);
    const toMs = parseTimestampMsQuery(req.query.toMs);
    const dialect = integration.getSqlDialect();
    const timeClause =
      fromMs != null && toMs != null && fromMs < toMs
        ? `AND timestamp >= ${dialect.toTimestamp(new Date(fromMs))} AND timestamp < ${dialect.toTimestamp(new Date(toMs))}`
        : "";

    const orderAscending = req.query.order?.trim().toLowerCase() === "asc";

    const sql = `
SELECT
  event_uuid,
  timestamp,
  ${chErrorDisplayTitleExpr()} AS title,
  transaction_name,
  release_version,
  environment,
  user_id,
  ua_device_type,
  ua_os,
  url,
  runtime_name
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
${searchClause}
${timeClause}
ORDER BY timestamp ${orderAscending ? "ASC" : "DESC"}, event_uuid ${orderAscending ? "ASC" : "DESC"}
LIMIT ${limit} OFFSET ${offset}
`;
    const { rows } = await integration.runQuery(sql);
    return res.status(200).json({
      status: 200,
      events: rows.map((r) => ({
        eventId: String(r.event_uuid || ""),
        timestamp: clickhouseTimestampToIso(r.timestamp),
        title: String(r.title || ""),
        transaction: String(r.transaction_name || ""),
        release: String(r.release_version || ""),
        environment: String(r.environment || ""),
        user: String(r.user_id || r.device_id || ""),
        device: String(r.ua_device_type || ""),
        os: String(r.ua_os || ""),
        url: String(r.url || ""),
        runtime: String(r.runtime_name || ""),
      })),
    });
  } catch (e) {
    if (e instanceof ManagedWarehousePendingError) {
      return res.status(503).json({
        status: 503,
        message: "Managed warehouse is still provisioning.",
      });
    }
    throw e;
  }
}

/** Full event row + related context + symbolicated stack. Query: clientKey, fingerprint?, eventSearch? */
export async function getEventDetail(
  req: AuthRequest<
    unknown,
    { eventUuid: string },
    { clientKey?: string; fingerprint?: string; eventSearch?: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const clientKey = req.query.clientKey?.trim();
  const fingerprint = req.query.fingerprint?.trim();
  if (!clientKey) {
    return res
      .status(400)
      .json({ status: 400, message: "clientKey is required" });
  }

  try {
    const { integration } = await requireClickhouse(context);
    const eventSearch = req.query.eventSearch?.trim();
    const uuidFilter = eventSearch
      ? `event_uuid = '${esc(integration, eventSearch)}'`
      : `event_uuid = '${esc(integration, req.params.eventUuid)}'`;

    const fpClause = fingerprint
      ? `AND issue_fingerprint = '${esc(integration, fingerprint)}'`
      : "";

    const sql = `
SELECT *
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND ${uuidFilter}
${fpClause}
ORDER BY timestamp DESC
LIMIT 1
`;
    const { rows } = await integration.runQuery(sql);
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ status: 404, message: "Event not found" });
    }

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
    const uid = String(row.user_id || row.device_id || "");
    const url = String(row.url || "");

    let relatedFeatureUsage: Record<string, unknown>[] = [];
    let relatedExperimentViews: Record<string, unknown>[] = [];
    if (uid) {
      const fuSql = `
SELECT
  feature,
  value,
  count() AS evaluations,
  max(timestamp) AS lastSeen
FROM feature_usage
WHERE user_id = '${esc(integration, uid)}'
AND timestamp > now() - INTERVAL 7 DAY
GROUP BY feature, value
ORDER BY lastSeen DESC
LIMIT 40
`;
      const evSql = `
SELECT
  experiment_id,
  variation_id,
  count() AS views,
  max(timestamp) AS lastSeen
FROM experiment_views
WHERE user_id = '${esc(integration, uid)}'
AND timestamp > now() - INTERVAL 7 DAY
GROUP BY experiment_id, variation_id
ORDER BY lastSeen DESC
LIMIT 40
`;
      relatedFeatureUsage = (await integration.runQuery(fuSql)).rows;
      relatedExperimentViews = (await integration.runQuery(evSql)).rows;
    }

    const relatedFeatureUsageNormalized = relatedFeatureUsage.map((r) => ({
      ...r,
      lastSeen: clickhouseTimestampToIso(
        (r as { lastSeen?: unknown }).lastSeen,
      ),
    }));
    const relatedExperimentViewsNormalized = relatedExperimentViews.map(
      (r) => ({
        ...r,
        lastSeen: clickhouseTimestampToIso(
          (r as { lastSeen?: unknown }).lastSeen,
        ),
      }),
    );

    const release = String(row.release_version || properties.release || "");
    const symbolicatedStack = await buildSymbolicatedStack({
      organizationId: context.org.id,
      clientKey,
      release,
      properties,
    });

    return res.status(200).json({
      status: 200,
      event: {
        ...row,
        title: displayTitle,
        timestamp: clickhouseTimestampToIso(row.timestamp),
        properties,
        attributes,
        relatedFeatureUsage: relatedFeatureUsageNormalized,
        relatedExperimentViews: relatedExperimentViewsNormalized,
        urlAtCapture: url,
        symbolicatedStack,
      },
    });
  } catch (e) {
    if (e instanceof ManagedWarehousePendingError) {
      return res.status(503).json({
        status: 503,
        message: "Managed warehouse is still provisioning.",
      });
    }
    throw e;
  }
}

export async function getEventAdjacent(
  req: AuthRequest<
    unknown,
    { eventUuid: string },
    { clientKey?: string; fingerprint?: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const clientKey = req.query.clientKey?.trim();
  const fingerprint = req.query.fingerprint?.trim();
  if (!clientKey || !fingerprint) {
    return res
      .status(400)
      .json({ status: 400, message: "clientKey and fingerprint are required" });
  }

  try {
    const { integration } = await requireClickhouse(context);
    const curSql = `
SELECT timestamp, event_uuid
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
AND event_uuid = '${esc(integration, req.params.eventUuid)}'
LIMIT 1
`;
    const { rows: curRows } = await integration.runQuery(curSql);
    const current = curRows[0];
    if (!current) {
      return res.status(404).json({ status: 404, message: "Event not found" });
    }

    const currentTimestamp = integration
      .getSqlDialect()
      .toTimestamp(new Date(String(current.timestamp) + "Z"));
    const currentEventUuid = String(current.event_uuid || "");

    const prevSql = `
SELECT event_uuid
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
AND (
  timestamp < ${currentTimestamp}
  OR (
    timestamp = ${currentTimestamp}
    AND event_uuid < '${esc(integration, currentEventUuid)}'
  )
)
ORDER BY timestamp DESC, event_uuid DESC
LIMIT 1
`;
    const nextSql = `
SELECT event_uuid
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
AND (
  timestamp > ${currentTimestamp}
  OR (
    timestamp = ${currentTimestamp}
    AND event_uuid > '${esc(integration, currentEventUuid)}'
  )
)
ORDER BY timestamp ASC, event_uuid ASC
LIMIT 1
`;

    const [{ rows: prevRows }, { rows: nextRows }] = await Promise.all([
      integration.runQuery(prevSql),
      integration.runQuery(nextSql),
    ]);

    return res.status(200).json({
      status: 200,
      previousEventId: prevRows[0]
        ? String(prevRows[0].event_uuid || "")
        : null,
      nextEventId: nextRows[0] ? String(nextRows[0].event_uuid || "") : null,
    });
  } catch (e) {
    if (e instanceof ManagedWarehousePendingError) {
      return res.status(503).json({
        status: 503,
        message: "Managed warehouse is still provisioning.",
      });
    }
    throw e;
  }
}

export async function patchIssue(
  req: AuthRequest<
    {
      assigneeUserId?: string | null;
      priority?: string;
      status?: string;
      resolvedInRelease?: string | null;
    },
    { fingerprint: string },
    { clientKey?: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const clientKey = req.query.clientKey?.trim();
  const { fingerprint } = req.params;
  if (!clientKey) {
    return res
      .status(400)
      .json({ status: 400, message: "clientKey is required" });
  }

  await requireClickhouse(context);

  const now = new Date();
  let doc = await ErrorTrackingIssueModel.findOne({
    organization: context.org.id,
    clientKey,
    fingerprint,
  });

  if (!doc) {
    doc = await ErrorTrackingIssueModel.create({
      id: generateId("eti_"),
      organization: context.org.id,
      clientKey,
      fingerprint,
      comments: [],
      dateCreated: now,
      dateUpdated: now,
    });
  }

  const body = req.body || {};
  if ("assigneeUserId" in body) {
    doc.assigneeUserId = body.assigneeUserId ?? undefined;
  }
  if (body.priority) {
    doc.priority = body.priority;
  }
  if (body.status) {
    doc.status = body.status;
    doc.resolvedAt =
      body.status === "resolved"
        ? now
        : body.status === "open"
          ? undefined
          : doc.resolvedAt;
  }
  if ("resolvedInRelease" in body) {
    doc.resolvedInRelease = body.resolvedInRelease ?? undefined;
  }
  doc.dateUpdated = now;
  await doc.save();

  return res.status(200).json({ status: 200, issue: doc });
}

export async function postIssueComment(
  req: AuthRequest<
    { body: string },
    { fingerprint: string },
    { clientKey?: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const clientKey = req.query.clientKey?.trim();
  const { fingerprint } = req.params;
  const text = req.body?.body?.trim();
  if (!clientKey) {
    return res
      .status(400)
      .json({ status: 400, message: "clientKey is required" });
  }
  if (!text) {
    return res.status(400).json({ status: 400, message: "body is required" });
  }

  await requireClickhouse(context);

  const now = new Date();
  let doc = await ErrorTrackingIssueModel.findOne({
    organization: context.org.id,
    clientKey,
    fingerprint,
  });
  if (!doc) {
    doc = await ErrorTrackingIssueModel.create({
      id: generateId("eti_"),
      organization: context.org.id,
      clientKey,
      fingerprint,
      comments: [],
      dateCreated: now,
      dateUpdated: now,
    });
  }

  doc.comments.push({
    userId: context.userId,
    userName: context.userName,
    body: text,
    date: now,
  });
  doc.dateUpdated = now;
  await doc.save();

  return res.status(200).json({ status: 200, issue: doc });
}
