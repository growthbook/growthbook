import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import {
  ErrorTrackingIssueModel,
  ErrorTrackingIssueDocument,
} from "back-end/src/models/ErrorTrackingIssueModel";

export function esc(integration: SqlIntegration, value: string): string {
  return integration.getSqlDialect().escapeStringLiteral(value);
}

/** ClickHouse: prefer explicit `message` (full `Error.message`) over `title` when both exist in `properties` JSON. */
export function chErrorDisplayTitleExpr(): string {
  return `coalesce(nullIf(JSONExtractString(properties, 'message'), ''), title)`;
}

/** ClickHouse DateTime often omits timezone; warehouse stores UTC. */
export function clickhouseTimestampToIso(raw: unknown): string {
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

export async function getIssueDocs(
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

export type IssuePriority = "low" | "medium" | "high" | "critical";
export type IssueStatus = "open" | "resolved" | "muted";

export type IssueSummary = {
  fingerprint: string;
  title: string;
  lastSeen: string;
  firstSeen: string;
  events: number;
  users: number;
  assigneeUserId: string | null;
  priority: IssuePriority;
  status: IssueStatus;
  resolvedAt: string | null;
  resolvedInRelease: string | null;
};

export function buildIssueSummary(
  row: {
    issue_fingerprint?: unknown;
    title?: unknown;
    last_seen?: unknown;
    first_seen?: unknown;
    events?: unknown;
    users?: unknown;
  },
  doc: ErrorTrackingIssueDocument | undefined,
): IssueSummary {
  return {
    fingerprint: String(row.issue_fingerprint || ""),
    title: String(row.title || ""),
    lastSeen: clickhouseTimestampToIso(row.last_seen),
    firstSeen: clickhouseTimestampToIso(row.first_seen),
    events: Number(row.events || 0),
    users: Number(row.users || 0),
    assigneeUserId: doc?.assigneeUserId || null,
    priority: (doc?.priority as IssuePriority) || "medium",
    status: (doc?.status as IssueStatus) || "open",
    resolvedAt: doc?.resolvedAt?.toISOString() || null,
    resolvedInRelease: doc?.resolvedInRelease || null,
  };
}

type GroupedIssueRow = {
  issue_fingerprint: unknown;
  title: unknown;
  last_seen: unknown;
  first_seen: unknown;
  events: unknown;
  users: unknown;
};

/** Shared WHERE/search semantics for both the paginated query and its count. */
function buildGroupedIssuesQuery({
  integration,
  clientKey,
  q,
}: {
  integration: SqlIntegration;
  clientKey: string;
  q?: string;
}): { groupedIssuesSql: string; searchClause: string } {
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
  return { groupedIssuesSql, searchClause };
}

/** Grouped, paginated issue rows for a client key, plus the total matching count. */
export async function queryGroupedIssues({
  integration,
  clientKey,
  q,
  limit,
  offset,
}: {
  integration: SqlIntegration;
  clientKey: string;
  q?: string;
  limit: number;
  offset: number;
}): Promise<{ rows: GroupedIssueRow[]; total: number }> {
  const { groupedIssuesSql, searchClause } = buildGroupedIssuesQuery({
    integration,
    clientKey,
    q,
  });

  const groupedSql = `
SELECT *
FROM (${groupedIssuesSql}) AS grouped_issues
${searchClause}
ORDER BY last_seen DESC
LIMIT ${limit} OFFSET ${offset}
`;
  const countSql = `
SELECT count() AS total
FROM (${groupedIssuesSql}) AS grouped_issues
${searchClause}
`;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    integration.runQuery(groupedSql, undefined, {
      queryType: "errorTrackingIssueList",
    }),
    integration.runQuery(countSql, undefined, {
      queryType: "errorTrackingIssueList",
    }),
  ]);

  return {
    rows: rows as GroupedIssueRow[],
    total: Number(countRows[0]?.total || 0),
  };
}

type IssueDetailRow = {
  title: unknown;
  last_seen: unknown;
  first_seen: unknown;
  events: unknown;
  users: unknown;
  last_release: unknown;
  first_release: unknown;
};

/** Aggregated detail row for one issue, or undefined if the issue has no events. */
export async function queryIssueDetailRow({
  integration,
  clientKey,
  fingerprint,
}: {
  integration: SqlIntegration;
  clientKey: string;
  fingerprint: string;
}): Promise<IssueDetailRow | undefined> {
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
  const { rows } = await integration.runQuery(sql, undefined, {
    queryType: "errorTrackingIssueDetail",
  });
  // Aggregates with no GROUP BY always return exactly one row, even when no
  // underlying rows matched — ClickHouse fills max()/min() on an empty set
  // with the column's zero value (e.g. the DateTime epoch), not NULL, so
  // last_seen alone can't signal "not found." count() is reliably 0 instead.
  const row = rows[0] as IssueDetailRow | undefined;
  return row && Number(row.events) > 0 ? row : undefined;
}

export type IssueDetailSummary = {
  fingerprint: string;
  title: string;
  lastSeen: string;
  firstSeen: string;
  events: number;
  users: number;
  lastRelease: string;
  firstRelease: string;
  assigneeUserId: string | null;
  priority: IssuePriority;
  status: IssueStatus;
  resolvedAt: string | null;
  resolvedInRelease: string | null;
};

export function buildIssueDetailSummary(
  fingerprint: string,
  row: IssueDetailRow,
  doc: ErrorTrackingIssueDocument | undefined,
): IssueDetailSummary {
  return {
    fingerprint,
    title: String(row.title || ""),
    lastSeen: clickhouseTimestampToIso(row.last_seen),
    firstSeen: clickhouseTimestampToIso(row.first_seen),
    events: Number(row.events || 0),
    users: Number(row.users || 0),
    lastRelease: String(row.last_release || ""),
    firstRelease: String(row.first_release || ""),
    assigneeUserId: doc?.assigneeUserId || null,
    priority: (doc?.priority as IssuePriority) || "medium",
    status: (doc?.status as IssueStatus) || "open",
    resolvedAt: doc?.resolvedAt?.toISOString() || null,
    resolvedInRelease: doc?.resolvedInRelease || null,
  };
}

export type IssueDimensions = {
  environments: { name: string; count: number }[];
  releases: { name: string; count: number }[];
  /**
   * Distinct `error_type` values within this issue. A single issue showing
   * more than one errorType is a signal that events which should have
   * grouped together didn't — the ingestor's fingerprint hash includes
   * errorType, so events that are otherwise identical (same message, same
   * stack) but tagged with a different errorType land as separate issues.
   */
  errorTypes: { name: string; count: number }[];
  transactions: { name: string; count: number }[];
};

function dimensionQuery({
  integration,
  clientKey,
  fingerprint,
  column,
}: {
  integration: SqlIntegration;
  clientKey: string;
  fingerprint: string;
  column: string;
}): string {
  return `
SELECT ${column}, count() AS c
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
AND ${column} != ''
GROUP BY ${column}
ORDER BY c DESC
LIMIT 20
`;
}

export async function queryIssueDimensions({
  integration,
  clientKey,
  fingerprint,
}: {
  integration: SqlIntegration;
  clientKey: string;
  fingerprint: string;
}): Promise<IssueDimensions> {
  // environment intentionally omits the "!= ''" filter other dimensions use:
  // an empty environment is itself a meaningful, common value worth counting.
  const dimensionsSql = `
SELECT environment, count() AS c
FROM errors
WHERE client_key = '${esc(integration, clientKey)}'
AND issue_fingerprint = '${esc(integration, fingerprint)}'
GROUP BY environment
ORDER BY c DESC
LIMIT 20
`;

  const [
    { rows: envRows },
    { rows: relRows },
    { rows: errorTypeRows },
    { rows: transactionRows },
  ] = await Promise.all([
    integration.runQuery(dimensionsSql, undefined, {
      queryType: "errorTrackingIssueDetail",
    }),
    integration.runQuery(
      dimensionQuery({
        integration,
        clientKey,
        fingerprint,
        column: "release_version",
      }),
      undefined,
      { queryType: "errorTrackingIssueDetail" },
    ),
    integration.runQuery(
      dimensionQuery({
        integration,
        clientKey,
        fingerprint,
        column: "error_type",
      }),
      undefined,
      { queryType: "errorTrackingIssueDetail" },
    ),
    integration.runQuery(
      dimensionQuery({
        integration,
        clientKey,
        fingerprint,
        column: "transaction_name",
      }),
      undefined,
      { queryType: "errorTrackingIssueDetail" },
    ),
  ]);

  return {
    environments: envRows.map((e) => ({
      name: String(e.environment || ""),
      count: Number(e.c || 0),
    })),
    releases: relRows.map((e) => ({
      name: String(e.release_version || ""),
      count: Number(e.c || 0),
    })),
    errorTypes: errorTypeRows.map((e) => ({
      name: String(e.error_type || ""),
      count: Number(e.c || 0),
    })),
    transactions: transactionRows.map((e) => ({
      name: String(e.transaction_name || ""),
      count: Number(e.c || 0),
    })),
  };
}
