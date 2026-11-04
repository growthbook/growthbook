import { ExperimentMetricDefinition, isFactMetric } from "shared/experiments";
import { FactMetricType, FactTableDefinition } from "shared/types/fact-table";
import { capitalizeFirstLetter } from "@/services/utils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formTypeFromStored } from "@/components/FactTables/MetricEditor/metricFormTranslation";
import { TYPE_LABELS } from "@/components/FactTables/MetricEditor/MetricTypeSelect";

// The type picker's names, for a stored type alone.
const STORED_TYPE_LABELS: Record<FactMetricType, string> = {
  proportion: "Proportion",
  retention: "Retention",
  funnel: "Funnel",
  mean: "Mean",
  ratio: "Ratio",
  quantile: "Percentile",
  dailyParticipation: "Daily participation",
};

// The metric editor's type picker name, or the stored type's when the editor
// can't show the metric.
export function metricTypeLabel(
  metric: ExperimentMetricDefinition,
  getFactTableById: (id: string) => FactTableDefinition | null,
): string {
  if (!isFactMetric(metric)) return capitalizeFirstLetter(metric.type);
  const factTable = metric.numerator
    ? getFactTableById(metric.numerator.factTableId)
    : null;
  const form = formTypeFromStored(metric, factTable ?? undefined);
  return form.representable
    ? TYPE_LABELS[form.type]
    : STORED_TYPE_LABELS[metric.metricType];
}

export default function FactMetricTypeDisplayName(
  props: { type: FactMetricType } | { metric: ExperimentMetricDefinition },
) {
  const { getFactTableById } = useDefinitions();
  return (
    <>
      {"metric" in props
        ? metricTypeLabel(props.metric, getFactTableById)
        : STORED_TYPE_LABELS[props.type]}
    </>
  );
}
