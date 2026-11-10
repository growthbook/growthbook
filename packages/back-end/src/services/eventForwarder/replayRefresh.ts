import type { DataSourceInterface } from "shared/types/datasource";
import type {
  EventForwarderReplay,
  IncrementalRefreshInterface,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { postEventForwarderStatusToLicenseServer } from "back-end/src/enterprise/licenseUtil";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import {
  decryptEventForwarderConfigModel,
  isInHouseConsumerTopic,
} from "back-end/src/services/eventForwarder/config";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

export const EVENT_FORWARDER_REPLAY_FULL_REFRESH_REASON =
  "Backed-up Event Forwarder events were written after the last Full Refresh";

// Whether SQL reads a table, matched on its last path segment.
// - Ignores case and identifier quoting.
// - `gb_events` does not match `gb_events_v2` or `my_gb_events`.
export function sqlReferencesTable(sql: string, table: string): boolean {
  const unquote = (text: string) => text.toLowerCase().replace(/["`[\]]/g, "");
  const name = unquote(table).split(".").pop()?.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_$])${escaped}([^a-z0-9_$]|$)`).test(
    unquote(sql),
  );
}

type ReplayCheckState = Pick<
  IncrementalRefreshInterface,
  "unitsMaxTimestamp" | "metricSources" | "fullRefreshStartedAt"
>;

// A replay writes rows with old event times. An incremental update only reads
// past its watermark, so it never sees them. True when all of these hold:
// - No Full Refresh has started since the replay's last write.
// - A source's watermark is at or past the oldest replayed event.
// - That source's SQL reads one of the forwarder's tables.
// ponytail: matches table names in SQL, so a source reading the tables through
// a view is missed. Snapshot each source's watermark at restart if that bites.
export function incrementalRefreshMissedReplay({
  incrementalRefresh,
  replay,
  forwarderTables,
  exposureQuerySql,
  getFactTableSql,
}: {
  incrementalRefresh: ReplayCheckState;
  replay: EventForwarderReplay;
  forwarderTables: string[];
  exposureQuerySql: string | undefined;
  getFactTableSql: (factTableId: string) => string | undefined;
}): boolean {
  const lastWrite = new Date(replay.lastWriteAt);
  const fullRefreshStartedAt = incrementalRefresh.fullRefreshStartedAt ?? null;
  if (fullRefreshStartedAt !== null && fullRefreshStartedAt >= lastWrite) {
    return false;
  }
  const earliestEvent = replay.earliestEventAt
    ? new Date(replay.earliestEventAt)
    : null;
  const missed = (watermark: Date | null, sql: string | undefined) =>
    watermark !== null &&
    !!sql &&
    (earliestEvent === null || watermark >= earliestEvent) &&
    forwarderTables.some((table) => sqlReferencesTable(sql, table));

  return (
    missed(incrementalRefresh.unitsMaxTimestamp, exposureQuerySql) ||
    incrementalRefresh.metricSources.some((source) =>
      missed(source.maxTimestamp, getFactTableSql(source.factTableId)),
    )
  );
}

type ReplayInfo = { replay: EventForwarderReplay; tables: string[] } | null;

// Every refresh of every experiment on the Data Source asks; one license
// server call a minute is enough.
const REPLAY_CACHE_MS = 60_000;
const replayCache = new Map<string, { at: number; info: ReplayInfo }>();

async function getReplayInfo(
  context: ReqContext,
  datasourceId: string,
): Promise<ReplayInfo> {
  const key = `${context.org.id}:${datasourceId}`;
  const cached = replayCache.get(key);
  if (cached && Date.now() - cached.at < REPLAY_CACHE_MS) return cached.info;

  // Bypasses read scope: every viewer must get the same answer, and only the
  // yes/no decision leaves this module.
  const config = (
    await context.models.eventForwarderConfigs.getAllBypassingReadPermissions()
  ).find((c) => c.datasourceId === datasourceId);
  const connectorName = config?.connectorName?.trim();
  let info: ReplayInfo = null;
  // Only the in-house consumer parks and replays events.
  if (
    config &&
    connectorName &&
    isInHouseConsumerTopic(config.topic, config.sinkType)
  ) {
    const { replay } = await postEventForwarderStatusToLicenseServer({
      organizationId: context.org.id,
      datasourceId,
      connectorName,
    });
    if (replay) {
      const tables = Object.values(
        decryptEventForwarderConfigModel(config).tables ?? {},
      ).filter((table) => !!table);
      info = { replay, tables };
    }
  }
  replayCache.set(key, { at: Date.now(), info });
  return info;
}

/**
 * Why an incremental update of this experiment would miss replayed Event
 * Forwarder events, or null when it would not.
 * - Fails open: if the license server cannot be reached the update runs, and
 *   the next check still catches it (only a Full Refresh clears the condition).
 */
export async function getEventForwarderReplayFullRefreshReason(
  context: ReqContext,
  {
    datasource,
    incrementalRefresh,
    exposureQueryId,
  }: {
    datasource: DataSourceInterface;
    incrementalRefresh: IncrementalRefreshInterface;
    exposureQueryId: string;
  },
): Promise<string | null> {
  if (!IS_CLOUD) return null;
  try {
    const info = await getReplayInfo(context, datasource.id);
    if (!info) return null;
    const factTableMap = await getFactTableMap(context);
    return incrementalRefreshMissedReplay({
      incrementalRefresh,
      replay: info.replay,
      forwarderTables: info.tables,
      exposureQuerySql: datasource.settings.queries?.exposure?.find(
        (query) => query.id === exposureQueryId,
      )?.query,
      getFactTableSql: (id) => factTableMap.get(id)?.sql,
    })
      ? EVENT_FORWARDER_REPLAY_FULL_REFRESH_REASON
      : null;
  } catch (e) {
    logger.warn(
      { err: e, datasourceId: datasource.id, organizationId: context.org.id },
      "Could not check for an Event Forwarder replay; skipping the check",
    );
    return null;
  }
}
