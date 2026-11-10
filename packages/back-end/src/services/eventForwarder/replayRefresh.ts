import type { DataSourceInterface } from "shared/types/datasource";
import type {
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
  "Backed-up Event Forwarder events were written after the last Full Refresh";

// Whether SQL reads a table, matched on its last path segment.
// - Ignores case, identifier quoting, comments and string values.
// - `gb_events` does not match `gb_events_v2` or `my_gb_events`.
export function sqlReferencesTable(sql: string, table: string): boolean {
  const unquote = (text: string) => text.toLowerCase().replace(/["`[\]]/g, "");
  const name = unquote(table).split(".").pop()?.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|\\]/g, "\\$&");
  // One pass, so a quote inside a comment (or `--` inside a string) cannot
  // swallow real SQL.
  const code = sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
  return new RegExp(`(^|[^a-z0-9_$])${escaped}([^a-z0-9_$]|$)`).test(
    unquote(code),
  );
}

type ReplayCheckState = Pick<
  IncrementalRefreshInterface,
  "unitsMaxTimestamp" | "metricSources" | "fullRefreshStartedAt"
>;

// Replayed rows have old event times; an incremental update only reads past
// its watermark. True when all hold:
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
  const { fullRefreshStartedAt } = incrementalRefresh;
  if (
    fullRefreshStartedAt &&
    fullRefreshStartedAt >= new Date(replay.lastWriteAt)
  ) {
    return false;
  }
  const earliestEvent = new Date(replay.earliestEventAt);
  const missed = (watermark: Date | null, sql: string | undefined) =>
    watermark !== null &&
    !!sql &&
    watermark >= earliestEvent &&
    forwarderTables.some((table) => sqlReferencesTable(sql, table));

  return (
    missed(incrementalRefresh.unitsMaxTimestamp, exposureQuerySql) ||
    incrementalRefresh.metricSources.some((source) =>
      missed(source.maxTimestamp, getFactTableSql(source.factTableId)),
    )
  );
}

// The forwarder's replay times and table names; null when nothing was replayed.
async function getReplayInfo(
  context: ReqContext,
  datasourceId: string,
): Promise<{ replay: EventForwarderReplay; tables: string[] } | null> {
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
}

/**
 * Why an incremental update would miss replayed Event Forwarder events, or
 * null when it would not.
 * - Fails open if the license server is unreachable. The next check still
 *   catches it: only a Full Refresh clears the condition.
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
  } catch (e) {
    logger.warn(
      { err: e, datasourceId: datasource.id, organizationId: context.org.id },
      "Could not check for an Event Forwarder replay; skipping the check",
    );
    return null;
  }
}
