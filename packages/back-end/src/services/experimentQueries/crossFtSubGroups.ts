import type { CrossFtRatioMetric, MetricFanOut } from "./planMetricFanOut";

// Minimal shape of a metric source group needed to resolve a cross-FT metric
// to its host groups. We accept a small structural type rather than importing
// `MetricSourceGroups` to keep this helper agnostic of the runner module.
export interface CrossFtMetricSourceGroupRef {
  groupId: string;
  factTableId: string;
  metrics: { id: string }[];
}

// A pipeline is a per-group runner-side object. We only need to read the
// group id and fact table id to canonicalize the cross-FT pair; downstream
// orchestration uses the pipeline value as opaque.
export interface CrossFtPipelineRef {
  group: { groupId: string; factTableId: string };
}

export interface CrossFtSubGroup<P> {
  pipelines: [P, P];
  metrics: CrossFtRatioMetric[];
  // Null when `getWindowKey` is absent or returns null (skipPartialData off).
  // Otherwise an ascending index used as `_w${windowOrdinal}` on the stats
  // query name so mixed-window pairs over the same two caches stay unique.
  windowOrdinal: number | null;
}

// Build the set of cross-FT sub-groups for a fan-out. Each sub-group is keyed
// on the unordered pair of cache pipelines and collects every cross-FT ratio
// metric that needs those two caches joined — regardless of which side is
// numerator vs denominator. This lets `A/B` and `B/A` ratio metrics share a
// single joined stats query.
//
// When `getWindowKey` is provided and returns a non-null value, the key is
// extended with that window so mixed-window cross-FT metrics sharing the
// same two caches split into one stats query per window. When the callback
// is absent (or returns null), grouping is byte-identical to the pair-only
// key.
//
// Source-0 privilege (CUPED / event-quantile threshold) is irrelevant for
// cross-FT ratio metrics, so collapsing orientations is safe. The metric's
// own column refs carry orientation into the stats SQL.
//
// `onMissingPipeline` controls behavior when a metric's numerator or
// denominator cache hasn't been built yet:
//   - `"throw"` — main runner: the fan-out and per-FT pass both materialize
//     these caches, so a missing pipeline is a bug.
//   - `"skip"` — exploratory runner: we may be asked to analyze a cross-FT
//     metric whose first main run hasn't completed yet; soft-skip and let
//     the next main run catch up.
export function buildCrossFtSubGroups<P extends CrossFtPipelineRef>({
  crossFtPairs,
  metricSourceGroups,
  pipelineByGroupId,
  onMissingPipeline,
  getWindowKey,
}: {
  crossFtPairs: MetricFanOut["crossFtPairs"];
  metricSourceGroups: CrossFtMetricSourceGroupRef[];
  pipelineByGroupId: Map<string, P>;
  onMissingPipeline: "throw" | "skip";
  getWindowKey?: (m: CrossFtRatioMetric) => string | null;
}): CrossFtSubGroup<P>[] {
  type Draft = CrossFtSubGroup<P> & { windowKey: string | null };
  const subGroupMap = new Map<string, Draft>();

  for (const pair of crossFtPairs) {
    for (const crossFt of pair.metrics) {
      const numeratorGroup = metricSourceGroups.find(
        (g) =>
          g.factTableId === crossFt.numeratorFactTableId &&
          g.metrics.some((m) => m.id === crossFt.metric.id),
      );
      const denominatorGroup = metricSourceGroups.find(
        (g) =>
          g.factTableId === crossFt.denominatorFactTableId &&
          g.metrics.some((m) => m.id === crossFt.metric.id),
      );
      const numPipeline = numeratorGroup
        ? pipelineByGroupId.get(numeratorGroup.groupId)
        : undefined;
      const denomPipeline = denominatorGroup
        ? pipelineByGroupId.get(denominatorGroup.groupId)
        : undefined;
      if (!numPipeline || !denomPipeline) {
        if (onMissingPipeline === "throw") {
          throw new Error(
            `Cross-FT ratio metric "${crossFt.metric.id}" is missing its numerator or denominator source group.`,
          );
        }
        continue;
      }

      // Canonicalize on (groupIdA, groupIdB) sorted ascending so A/B and
      // B/A collapse into a single sub-group.
      const sortedPipelines: [P, P] =
        numPipeline.group.groupId < denomPipeline.group.groupId
          ? [numPipeline, denomPipeline]
          : [denomPipeline, numPipeline];
      const pairKey = `${sortedPipelines[0].group.groupId}__${sortedPipelines[1].group.groupId}`;
      const windowKey = getWindowKey?.(crossFt) ?? null;
      const subGroupKey = windowKey ? `${pairKey}__${windowKey}` : pairKey;
      const existing = subGroupMap.get(subGroupKey);
      if (existing) {
        existing.metrics.push(crossFt);
      } else {
        subGroupMap.set(subGroupKey, {
          pipelines: sortedPipelines,
          metrics: [crossFt],
          windowOrdinal: null,
          windowKey,
        });
      }
    }
  }

  const drafts = Array.from(subGroupMap.values());
  if (!getWindowKey) {
    return drafts.map((d) => ({
      pipelines: d.pipelines,
      metrics: d.metrics,
      windowOrdinal: d.windowOrdinal,
    }));
  }

  // Assign ascending window ordinals per pipeline pair so query names
  // (`statistics_cross_${gA}__${gB}_w${idx}`) stay unique and deterministic
  // without putting the window hours into the name.
  const byPair = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const pairKey = `${draft.pipelines[0].group.groupId}__${draft.pipelines[1].group.groupId}`;
    const list = byPair.get(pairKey) ?? [];
    list.push(draft);
    byPair.set(pairKey, list);
  }

  const result: CrossFtSubGroup<P>[] = [];
  for (const list of byPair.values()) {
    const allNull = list.every((d) => d.windowKey === null);
    if (allNull) {
      for (const d of list) {
        result.push({
          pipelines: d.pipelines,
          metrics: d.metrics,
          windowOrdinal: null,
        });
      }
      continue;
    }
    list.sort((a, b) => Number(a.windowKey) - Number(b.windowKey));
    list.forEach((d, i) => {
      result.push({
        pipelines: d.pipelines,
        metrics: d.metrics,
        windowOrdinal: i,
      });
    });
  }
  return result;
}
