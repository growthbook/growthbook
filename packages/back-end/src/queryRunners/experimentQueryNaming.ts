import type {
  ExperimentSnapshotInterface,
  SnapshotNewMetricsUpdate,
} from "shared/types/experiment-snapshot";
import { parseUnitDimQueryName } from "./unitDimensionQueryNaming";

export const TRAFFIC_QUERY_NAME = "traffic";

export const CLUSTER_TRAFFIC_QUERY_NAME = "clusterTraffic";

export const CLUSTER_HEALTH_QUERY_NAME = "clusterHealth";

const HEALTH_QUERY_NAMES: ReadonlySet<string> = new Set([
  TRAFFIC_QUERY_NAME,
  CLUSTER_TRAFFIC_QUERY_NAME,
  CLUSTER_HEALTH_QUERY_NAME,
]);

const GROUP_QUERY_NAME = /^group_(\d+)$/;

export const getGroupQueryName = (index: number): string => `group_${index}`;

export const STATISTICS_QUERY_PREFIX = "statistics_";

/** The drop of the units table a run no longer needs once its results landed. */
export function isTableCleanupQuery(name: string, snapshotId: string): boolean {
  return name === `drop_${snapshotId}`;
}

/** The metrics a run of the standard pipeline's result queries covers. */
export type ResultQueryScope = {
  metricIds: ReadonlySet<string>;
  firstGroupIndex: number;
};

export function getIndexAfterLastGroup(queryNames: readonly string[]): number {
  return queryNames.reduce((next, name) => {
    const baseName = parseUnitDimQueryName(name)?.baseQueryName ?? name;
    const index = GROUP_QUERY_NAME.exec(baseName)?.[1];
    return index === undefined ? next : Math.max(next, Number(index) + 1);
  }, 0);
}

/**
 * Which of its parent's queries a new-metrics update copies. On the standard
 * pipeline: metric groups and traffic always, a single metric's query only
 * while that metric is still analyzed, never the parent's units table or its
 * drop. On the Incremental Pipeline: statistics and traffic, since every other
 * query writes the cache tables.
 */
export function isCarriedNewMetricsUpdateQuery(
  name: string,
  snapshot: Pick<ExperimentSnapshotInterface, "runnerKind" | "settings">,
  { parentSnapshotId }: Pick<SnapshotNewMetricsUpdate, "parentSnapshotId">,
): boolean {
  if (HEALTH_QUERY_NAMES.has(name)) return true;
  const baseName = parseUnitDimQueryName(name)?.baseQueryName ?? name;
  if ((snapshot.runnerKind ?? "results") !== "results") {
    return baseName.startsWith(STATISTICS_QUERY_PREFIX);
  }
  if (name === parentSnapshotId || name === `drop_${parentSnapshotId}`) {
    return false;
  }
  return (
    GROUP_QUERY_NAME.test(baseName) ||
    snapshot.settings.metricSettings.some((m) => m.id === baseName)
  );
}
