import type { DataSourceInterface } from "shared/types/datasource";
import type { FactTableInterface } from "shared/types/fact-table";
import type {
  AggregatedFactTableInterface,
  EventForwarderReplay,
  IncrementalRefreshInterface,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { postEventForwarderStatusToLicenseServer } from "back-end/src/enterprise/licenseUtil";
import { dangerouslyGetFactTableByIdBypassPermission } from "back-end/src/models/FactTableModel";
import {
  decryptEventForwarderConfigModel,
  isInHouseConsumerTopic,
} from "back-end/src/services/eventForwarder/config";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

const REPLAY_FULL_REFRESH_REASON =
  "Backed-up Event Forwarder events were written after the last full refresh";

// Whether SQL names a table, matched on its last path segment.
// - Ignores case and identifier quoting.
// - `gb_events` does not match `gb_events_v2` or `my_gb_events`.
// ponytail: searches the raw text, so a name in a comment or a string counts.
// That costs one unneeded Full Refresh. Stripping them needs each dialect's
// escaping rules, and getting those wrong hides a real read. Parse per dialect
// if the false positives ever matter.
export function sqlReferencesTable(sql: string, table: string): boolean {
  const unquote = (text: string) => text.toLowerCase().replace(/["`[\]]/g, "");
  const name = unquote(table).split(".").pop()?.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_$])${escaped}([^a-z0-9_$]|$)`).test(
    unquote(sql),
  );
}

// Replayed rows have old event times; a cache that only reads past its
// watermark never sees them. True when all hold:
// - The cache was not rebuilt after the replay's last write.
// - Its watermark is at or past the oldest replayed event.
// - Its source SQL names one of the forwarder's tables.
// ponytail: matches table names in SQL, so a source reading the tables through
// a view is missed. Snapshot each source's watermark at restart if that bites.
export function cacheMissedReplay({
  rebuiltAt,
  watermark,
  sql,
  replay,
  forwarderTables,
}: {
  rebuiltAt: Date | null | undefined;
  watermark: Date | null;
  sql: string | undefined;
  replay: EventForwarderReplay;
  forwarderTables: string[];
}): boolean {
  if (rebuiltAt && rebuiltAt >= new Date(replay.lastWriteAt)) return false;
  return (
    watermark !== null &&
    !!sql &&
    watermark >= new Date(replay.earliestEventAt) &&
    forwarderTables.some((table) => sqlReferencesTable(sql, table))
  );
}

type ReplayCheckState = Pick<
  IncrementalRefreshInterface,
  "unitsMaxTimestamp" | "metricSources" | "fullRefreshStartedAt"
>;

// An experiment's units table and each metric source are caches of their own;
// one Full Refresh rebuilds them all.
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
  const missed = (watermark: Date | null, sql: string | undefined) =>
    cacheMissedReplay({
      rebuiltAt: incrementalRefresh.fullRefreshStartedAt,
      watermark,
      sql,
      replay,
      forwarderTables,
    });

  return (
    missed(incrementalRefresh.unitsMaxTimestamp, exposureQuerySql) ||
    incrementalRefresh.metricSources.some((source) =>
      missed(source.maxTimestamp, getFactTableSql(source.factTableId)),
    )
  );
}

// The forwarder's replay times and table names; null when nothing was replayed.
// - Fails open (null) if the license server is unreachable. The next check
//   asks again, and only a rebuild clears the condition.
async function getReplayInfo(
  context: ReqContext,
  datasourceId: string,
): Promise<{ replay: EventForwarderReplay; tables: string[] } | null> {
  if (!IS_CLOUD) return null;
  // Bypasses read scope: every viewer must get the same answer, and only the
  // yes/no decision leaves this module.
  const config = (
    await context.models.eventForwarderConfigs.getAllBypassingReadPermissions()
  ).find((c) => c.datasourceId === datasourceId);
  const connectorName = config?.connectorName?.trim();
  // Only the in-house consumer parks and replays events.
  if (
    !config ||
    !connectorName ||
    !isInHouseConsumerTopic(config.topic, config.sinkType)
  ) {
    return null;
  }
  try {
    const { replay } = await postEventForwarderStatusToLicenseServer({
      organizationId: context.org.id,
      datasourceId,
      connectorName,
    });
    if (!replay) return null;
    return {
      replay,
      tables: Object.values(
        decryptEventForwarderConfigModel(config).tables ?? {},
      ).filter((table) => !!table),
    };
  } catch (e) {
    logger.warn(
      { err: e, datasourceId, organizationId: context.org.id },
      "Could not check for an Event Forwarder replay; skipping the check",
    );
    return null;
  }
}

/**
 * Why an incremental update would miss replayed Event Forwarder events, or
 * null when it would not.
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
  const info = await getReplayInfo(context, datasource.id);
  if (!info) return null;
  // Same bypass as the forwarder config: a viewer who cannot read a Fact
  // Table must still get the same answer.
  const factTableSql = new Map(
    await Promise.all(
      incrementalRefresh.metricSources.map(
        async ({ factTableId }): Promise<[string, string | undefined]> => [
          factTableId,
          (
            await dangerouslyGetFactTableByIdBypassPermission(
              context.org.id,
              factTableId,
            )
          )?.sql,
        ],
      ),
    ),
  );
  return incrementalRefreshMissedReplay({
    incrementalRefresh,
    replay: info.replay,
    forwarderTables: info.tables,
    exposureQuerySql: datasource.settings.queries?.exposure?.find(
      (query) => query.id === exposureQueryId,
    )?.query,
    getFactTableSql: (id) => factTableSql.get(id),
  })
    ? REPLAY_FULL_REFRESH_REASON
    : null;
}

/**
 * Whether an Aggregated Fact Table lacks rows an Event Forwarder replay wrote,
 * so its next run must restate instead of appending.
 */
export async function aggregatedFactTableMissedReplay(
  context: ReqContext,
  {
    factTable,
    registry,
  }: {
    factTable: Pick<FactTableInterface, "datasource" | "sql">;
    registry: Pick<
      AggregatedFactTableInterface,
      "lastRestateStartedAt" | "lastMaxTimestamp"
    >;
  },
): Promise<boolean> {
  const info = await getReplayInfo(context, factTable.datasource);
  return (
    !!info &&
    cacheMissedReplay({
      rebuiltAt: registry.lastRestateStartedAt,
      watermark: registry.lastMaxTimestamp,
      sql: factTable.sql,
      replay: info.replay,
      forwarderTables: info.tables,
    })
  );
}
