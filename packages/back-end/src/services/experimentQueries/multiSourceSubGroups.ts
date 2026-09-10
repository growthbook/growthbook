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
// collects metrics that need the same set of fact table caches joined — both
// cross-FT ratio metrics and multi-FT funnel metrics. Metrics sharing the
// same sorted FT set are grouped into a single joined stats query.
//
// When getWindowKey is set, metrics over the same caches but with different
// conversion windows split into separate sub-groups.
//
// `onMissingPipeline` controls behavior when a metric's cache hasn't been
// built yet:
//   - "throw": main runner — missing pipeline is a bug.
//   - "skip": exploratory runner — soft-skip until main run catches up.
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

  for (const group of multiSourceGroups) {
    // Resolve pipelines for each fact table in the group.
    const pipelines: P[] = [];
    const seenGroupIds = new Set<string>();
    let skip = false;

    for (const ftId of group.factTableIds) {
      const sourceGroup = metricSourceGroups.find(
        (g) =>
          g.factTableId === ftId &&
          g.metrics.some((m) => group.metrics.some((gm) => gm.id === m.id)),
      );
      if (!sourceGroup) {
        if (onMissingPipeline === "throw") {
          throw new Error(
            `Multi-source metric group is missing a source group for fact table "${ftId}".`,
          );
        }
        skip = true;
        break;
      }
      if (seenGroupIds.has(sourceGroup.groupId)) continue;
      seenGroupIds.add(sourceGroup.groupId);

      const pipeline = pipelineByGroupId.get(sourceGroup.groupId);
      if (!pipeline) {
        if (onMissingPipeline === "throw") {
          throw new Error(
            `Multi-source metric group is missing its pipeline for group "${sourceGroup.groupId}".`,
          );
        }
        skip = true;
        break;
      }
      pipelines.push(pipeline);
    }
    if (skip) continue;

    // Sort pipelines by groupId for a canonical key.
    pipelines.sort((a, b) => a.group.groupId.localeCompare(b.group.groupId));
    const pipelineKey = pipelines.map((p) => p.group.groupId).join("__");

    if (!getWindowKey) {
      // No window partitioning — all metrics in this group share one sub-group.
      const existing = subGroupMap.get(pipelineKey);
      if (existing) {
        existing.metrics.push(...group.metrics);
        existing.crossFtRatioMetrics.push(...group.crossFtRatioMetrics);
      } else {
        subGroupMap.set(pipelineKey, {
          pipelines,
          metrics: [...group.metrics],
          crossFtRatioMetrics: [...group.crossFtRatioMetrics],
          windowKey: null,
        });
      }
    } else {
      // Partition by window key — metrics with different windows split.
      for (const metric of group.metrics) {
        const windowKey = getWindowKey(metric) ?? null;
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
  }

  return Array.from(subGroupMap.values());
}
