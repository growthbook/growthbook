import type { ExperimentInterface } from "shared/types/experiment";

type DatasourceBoundSettings = Pick<
  ExperimentInterface,
  | "goalMetrics"
  | "secondaryMetrics"
  | "guardrailMetrics"
  | "activationMetric"
  | "segment"
  | "precomputedUnitDimensionIds"
>;

// What moving an experiment to another data source drops: the metrics and the
// segment from the old one, and its unit dimensions.
export function datasourceChangeDrops(
  experiment: Partial<DatasourceBoundSettings>,
  {
    metricFromSource,
    segmentFromSource,
  }: {
    metricFromSource: (id: string) => boolean;
    segmentFromSource: (id: string) => boolean;
  },
): Partial<DatasourceBoundSettings> {
  const drops: Partial<DatasourceBoundSettings> = {};
  (["goalMetrics", "secondaryMetrics", "guardrailMetrics"] as const).forEach(
    (field) => {
      const ids = experiment[field] ?? [];
      const kept = ids.filter(metricFromSource);
      if (kept.length !== ids.length) drops[field] = kept;
    },
  );
  if (
    experiment.activationMetric &&
    !metricFromSource(experiment.activationMetric)
  ) {
    drops.activationMetric = "";
  }
  if (experiment.segment && !segmentFromSource(experiment.segment)) {
    drops.segment = "";
  }
  if (experiment.precomputedUnitDimensionIds?.length) {
    drops.precomputedUnitDimensionIds = [];
  }
  return drops;
}
