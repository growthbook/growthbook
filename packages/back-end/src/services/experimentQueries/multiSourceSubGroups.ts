import type { FactMetricInterface } from "shared/types/fact-table";
import type { CrossFtRatioMetric, MultiSourceGroup } from "./planMetricFanOut";

// Minimal shape of a metric source group needed to resolve a multi-source
// metric to its host groups. We accept a small structural type rather than
// importing `MetricSourceGroups` to keep this helper agnostic of the runner.
export interface MultiSourceGroupRef {
  groupId: string;
  factTableId: string;
  metrics: { id: string }[];
}

// A pipeline is a per-group runner-side object. We only need to read the
// group id and fact table id to canonicalize; downstream orchestration uses
// the pipeline value as opaque.
export interface MultiSourcePipelineRef {
  group: { groupId: string; factTableId: string };
}

export interface MultiSourceSubGroup<P> {
  pipelines: P[];
  metrics: FactMetricInterface[];
  crossFtRatioMetrics: CrossFtRatioMetric[];
  windowKey: string | null;
}

// Build the set of multi-source sub-groups for a fan-out. Each sub-group
// collects metrics that need the same set of cache tables joined — both
// cross-FT ratio metrics and multi-FT funnel metrics. The stats query joins
// exactly one cache table per fact table, so caches are resolved per metric:
// a fact table's metrics are chunked across several cache tables once they
// exceed the per-query column budget, and two metrics over the same fact
// tables only share a stats query when every one of their caches match.
//
// When getWindowKey is set, metrics over the same caches but with different
// conversion windows split into separate sub-groups.
//
// `onMissingPipeline` controls behavior when a metric's cache hasn't been
// built yet:
//   - "throw": main runner — missing pipeline is a bug.
//   - "skip": exploratory runner — soft-skip the metric until the main run
//     catches up.
export function buildMultiSourceSubGroups<P extends MultiSourcePipelineRef>({
  multiSourceGroups,
  metricSourceGroups,
  pipelineByGroupId,
  onMissingPipeline,
  getWindowKey,
}: {
  multiSourceGroups: MultiSourceGroup[];
  metricSourceGroups: MultiSourceGroupRef[];
  pipelineByGroupId: Map<string, P>;
  onMissingPipeline: "throw" | "skip";
  getWindowKey?: (m: FactMetricInterface) => string | null;
}): MultiSourceSubGroup<P>[] {
  const subGroupMap = new Map<string, MultiSourceSubGroup<P>>();

  // Resolve the cache pipeline that holds `metric`'s columns for each fact
  // table, sorted by groupId for a canonical key. Returns null when a cache is
  // missing and onMissingPipeline is "skip".
  const resolvePipelines = (
    metric: FactMetricInterface,
    factTableIds: string[],
  ): P[] | null => {
    const pipelines: P[] = [];
    for (const ftId of factTableIds) {
      const sourceGroup = metricSourceGroups.find(
        (g) =>
          g.factTableId === ftId && g.metrics.some((m) => m.id === metric.id),
      );
      const pipeline = sourceGroup
        ? pipelineByGroupId.get(sourceGroup.groupId)
        : undefined;
      if (!pipeline) {
        if (onMissingPipeline === "throw") {
          throw new Error(
            `Multi-source metric "${metric.id}" is missing its source group or pipeline for fact table "${ftId}".`,
          );
        }
        return null;
      }
      pipelines.push(pipeline);
    }
    pipelines.sort((a, b) => a.group.groupId.localeCompare(b.group.groupId));
    return pipelines;
  };

  for (const group of multiSourceGroups) {
    for (const metric of group.metrics) {
      const pipelines = resolvePipelines(metric, group.factTableIds);
      if (!pipelines) continue;

      const pipelineKey = pipelines.map((p) => p.group.groupId).join("__");
      const windowKey = getWindowKey?.(metric) ?? null;
      const subGroupKey = windowKey
        ? `${pipelineKey}__${windowKey}`
        : pipelineKey;
      const crossFtEntry = group.crossFtRatioMetrics.find(
        (c) => c.metric.id === metric.id,
      );

      const existing = subGroupMap.get(subGroupKey);
      if (existing) {
        existing.metrics.push(metric);
        if (crossFtEntry) existing.crossFtRatioMetrics.push(crossFtEntry);
      } else {
        subGroupMap.set(subGroupKey, {
          pipelines,
          metrics: [metric],
          crossFtRatioMetrics: crossFtEntry ? [crossFtEntry] : [],
          windowKey,
        });
      }
    }
  }

  return Array.from(subGroupMap.values());
}
