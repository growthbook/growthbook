import { factMetricValidator } from "shared/validators";
import { FactMetricInterface } from "shared/types/fact-table";
import { isRowFilterComplete } from "@/components/FactTables/rowFilterUtils";
import {
  CreateFactMetricFormProps,
  fromFactMetricFormValues,
} from "@/services/metrics";

export function getDraftMetricPreview(
  draft: CreateFactMetricFormProps,
): FactMetricInterface | null {
  try {
    const values = fromFactMetricFormValues(draft);
    const funnel = values.metricType === "funnel";
    if (
      funnel
        ? !values.funnelSettings?.steps.length
        : !values.numerator.factTableId
    ) {
      return null;
    }
    const refs = funnel
      ? (values.funnelSettings?.steps ?? [])
      : [
          values.numerator,
          ...(values.metricType === "ratio" ? [values.denominator] : []),
        ];
    if (
      (funnel && refs.length < 2) ||
      refs.some(
        (ref) =>
          !ref?.factTableId ||
          !(ref.rowFilters ?? []).every(isRowFilterComplete) ||
          ("column" in ref && !ref.column) ||
          ("aggregateFilterColumn" in ref &&
            ref.aggregateFilterColumn &&
            !ref.aggregateFilter?.trim()),
      )
    )
      return null;
    return factMetricValidator.parse({
      ...values,
      id: "fact__preview",
      organization: "",
      dateCreated: new Date(0),
      dateUpdated: new Date(0),
      name: values.name || "Metric preview",
      numerator: funnel ? null : values.numerator,
      denominator: funnel ? null : values.denominator,
      quantileSettings: funnel ? null : values.quantileSettings,
      funnelSettings: funnel ? values.funnelSettings : null,
    });
  } catch {
    return null;
  }
}

export function getMetricPreviewUnavailableReason(
  metric: Pick<FactMetricInterface, "metricType" | "numerator">,
): string | null {
  if (
    metric.metricType === "mean" &&
    metric.numerator?.column === "$$distinctDates"
  ) {
    return "Active Days cannot be previewed outside an experiment: each daily value would be 1.";
  }
  if (
    metric.metricType === "retention" ||
    metric.metricType === "dailyParticipation"
  ) {
    return "Calculating this rate requires an eligible user population from an experiment.";
  }
  return null;
}
