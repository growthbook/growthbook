import {
  getNewMetricsUpdate,
  MAX_NEW_METRICS_UPDATES_IN_A_ROW,
} from "shared/experiments";
import type {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import type { QueryPointer } from "shared/types/query";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  findNewMetricsUpdateAncestor,
  type NewMetricsUpdateAncestor,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getQueriesByIds } from "back-end/src/models/QueryModel";
import {
  type ExperimentResultsQueryParams,
  startExperimentResultQueries,
} from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import {
  getIndexAfterLastGroup,
  type ResultQueryScope,
} from "back-end/src/queryRunners/experimentQueryNaming";
import { NewMetricsUpdateUnavailableError } from "back-end/src/util/errors";

/**
 * The SQL of every query startExperimentResultQueries would start, by query
 * name, without running or saving anything.
 */
export async function generateExperimentResultQuerySql(
  context: ApiReqContext,
  params: ExperimentResultsQueryParams,
  integration: SourceIntegrationInterface,
  scope?: ResultQueryScope,
): Promise<Map<string, string>> {
  const sqlByName = new Map<string, string>();
  await startExperimentResultQueries(
    context,
    params,
    integration,
    async ({ name, query }) => {
      sqlByName.set(name, query);
      return { name, query: name, status: "queued" };
    },
    scope,
  );
  return sqlByName;
}

export type GenerateResultQuerySql = (args: {
  settings: ExperimentSnapshotSettings;
  queryParentId: string;
  scope?: ResultQueryScope;
}) => Promise<Map<string, string>>;

export const tooManyNewMetricsUpdatesError = () =>
  new NewMetricsUpdateUnavailableError(
    "base_incomplete",
    `The latest results come from ${MAX_NEW_METRICS_UPDATES_IN_A_ROW} updates of newly added metrics in a row, the most that can build on each other. Send "updateScope": "all_metrics" instead.`,
  );

/**
 * Base full update first, parent last. Counts the chain itself, since a parent
 * stored before its count was may undercount it.
 */
async function loadNewMetricsUpdateLineage(
  context: ReqContext | ApiReqContext,
  parent: NewMetricsUpdateAncestor,
): Promise<NewMetricsUpdateAncestor[]> {
  const lineage = [parent];
  for (
    let newMetricsUpdate = getNewMetricsUpdate(parent);
    newMetricsUpdate;
    newMetricsUpdate = getNewMetricsUpdate(lineage[0])
  ) {
    // Every level loaded so far is a new-metrics update.
    if (lineage.length >= MAX_NEW_METRICS_UPDATES_IN_A_ROW) {
      throw tooManyNewMetricsUpdatesError();
    }
    const ancestor = await findNewMetricsUpdateAncestor(
      context,
      newMetricsUpdate.parentSnapshotId,
    );
    if (!ancestor) {
      throw new NewMetricsUpdateUnavailableError(
        "base_incomplete",
        'An earlier update the latest results were built from no longer exists, so they can\'t be reused. Send "updateScope": "all_metrics" instead.',
      );
    }
    lineage.unshift(ancestor);
  }
  return lineage;
}

/**
 * One snapshot of a new-metrics update lineage as it would run today: its
 * stored metrics in stored order with today's settings.
 */
export type NewMetricsUpdateReplayLevel = {
  snapshotId: string;
  metricSettings: MetricForSnapshot[];
  clusterLevelMetricIds: string[];
  newMetricIds: string[] | null;
  // The level's own cutoff flag and planning clock, which its SQL was
  // generated with. Its units query reads the time of the replay instead.
  endDateIsCutoff: boolean;
  plannedAt: Date | null;
};

/**
 * The SQL each level would run today, by query name. A new-metrics update
 * numbers its own metric groups after the groups it copied, so the levels
 * replay base first to reproduce the stored grouping.
 */
export async function replayNewMetricsUpdateLineage({
  levels,
  settings,
  generateResultQuerySql,
}: {
  levels: readonly NewMetricsUpdateReplayLevel[];
  settings: ExperimentSnapshotSettings;
  generateResultQuerySql: GenerateResultQuerySql;
}): Promise<Map<string, string>> {
  const sqlByName = new Map<string, string>();
  for (const level of levels) {
    const scope = level.newMetricIds
      ? {
          metricIds: new Set(level.newMetricIds),
          firstGroupIndex: getIndexAfterLastGroup([...sqlByName.keys()]),
        }
      : undefined;
    const levelSql = await generateResultQuerySql({
      settings: {
        ...settings,
        metricSettings: level.metricSettings,
        clusterLevelMetricIds: level.clusterLevelMetricIds,
        endDateIsCutoff: level.endDateIsCutoff,
        plannedAt: level.plannedAt ?? undefined,
      },
      queryParentId: level.snapshotId,
      scope,
    });
    levelSql.forEach((sql, name) => sqlByName.set(name, sql));
  }
  return sqlByName;
}

// Comment lines carry metric and fact table names, which don't change results.
const withoutCommentLines = (sql: string): string =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

/** The named queries whose stored SQL is missing or differs from today's. */
export function getQueriesWithChangedSql({
  queryNames,
  storedSql,
  todaysSql,
}: {
  queryNames: readonly string[];
  storedSql: ReadonlyMap<string, string>;
  todaysSql: ReadonlyMap<string, string>;
}): string[] {
  return queryNames.filter((name) => {
    const stored = storedSql.get(name);
    const today = todaysSql.get(name);
    return (
      stored === undefined ||
      today === undefined ||
      withoutCommentLines(stored) !== withoutCommentLines(today)
    );
  });
}

/**
 * Each level of a lineage as it would run today. A metric today's plan has
 * takes today's entry. One it lacks, such as a metric removed from the
 * experiment since, keeps the level's own entry and cluster level, so a query
 * it shared with copied metrics regenerates as it ran if its definition is
 * unchanged. The new-metrics update leaves its results out.
 */
export function getNewMetricsUpdateReplayLevels({
  lineage,
  planned,
}: {
  lineage: readonly NewMetricsUpdateAncestor[];
  planned: Pick<
    ExperimentSnapshotSettings,
    "metricSettings" | "clusterLevelMetricIds" | "skipPartialData"
  >;
}): NewMetricsUpdateReplayLevel[] {
  const todaysEntries = new Map(planned.metricSettings.map((m) => [m.id, m]));
  return lineage.map((level) => {
    const endDateIsCutoff = !!level.settings.endDateIsCutoff;
    const plannedAt = level.settings.plannedAt ?? null;
    // Without a cutoff, skipPartialData SQL reads the clock, which snapshots
    // planned before it was stored don't have.
    if (!endDateIsCutoff && planned.skipPartialData && !plannedAt) {
      throw new NewMetricsUpdateUnavailableError("settings_changed");
    }
    return {
      snapshotId: level.id,
      metricSettings: level.settings.metricSettings.map(
        (m) => todaysEntries.get(m.id) ?? m,
      ),
      clusterLevelMetricIds: [
        ...(planned.clusterLevelMetricIds ?? []),
        ...(level.settings.clusterLevelMetricIds ?? []).filter(
          (id) => !todaysEntries.has(id),
        ),
      ],
      newMetricIds: getNewMetricsUpdate(level)?.queriedMetricIds ?? null,
      endDateIsCutoff,
      plannedAt,
    };
  });
}

/**
 * Refuses unless every query the new-metrics update would copy from a results
 * parent, and every units table those queries read, would be generated with
 * the same SQL today. This catches changed metric definitions, exposure and
 * segment SQL, identity joins, and releases that change how SQL is
 * generated.
 */
export async function assertCarriedQuerySqlUnchanged({
  context,
  parent,
  planned,
  carriedQueries,
  generateResultQuerySql,
}: {
  context: ReqContext | ApiReqContext;
  parent: ExperimentSnapshotInterface;
  planned: ExperimentSnapshotSettings;
  carriedQueries: QueryPointer[];
  generateResultQuerySql: GenerateResultQuerySql;
}): Promise<void> {
  const lineage = await loadNewMetricsUpdateLineage(context, parent);

  const levels = getNewMetricsUpdateReplayLevels({ lineage, planned });

  // In pipeline mode, exposure and segment SQL live in each level's units table query.
  const unitsQueries = lineage.flatMap((level) =>
    level.queries.filter((q) => q.name === level.id),
  );
  const comparedQueries = [...carriedQueries, ...unitsQueries];
  const sqlById = new Map(
    (
      await getQueriesByIds(
        context,
        comparedQueries.map((q) => q.query),
        false,
      )
    ).map((doc) => [doc.id, doc.query]),
  );
  const storedSql = new Map(
    comparedQueries.flatMap((q): [string, string][] => {
      const sql = sqlById.get(q.query);
      return sql === undefined ? [] : [[q.name, sql]];
    }),
  );

  const todaysSql = await replayNewMetricsUpdateLineage({
    levels,
    settings: planned,
    generateResultQuerySql,
  }).catch((error: unknown) => {
    // A normal update reports the error itself if it is real.
    context.logger.warn(
      error,
      "Could not regenerate the SQL a new-metrics update would copy",
    );
    throw new NewMetricsUpdateUnavailableError("settings_changed");
  });
  const changed = getQueriesWithChangedSql({
    queryNames: comparedQueries.map((q) => q.name),
    storedSql,
    todaysSql,
  });
  if (changed.length) {
    throw new NewMetricsUpdateUnavailableError("settings_changed");
  }
}
