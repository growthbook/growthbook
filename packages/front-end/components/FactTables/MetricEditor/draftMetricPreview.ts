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
  // Check the raw form filters, like "View sample rows" does:
  // fromFactMetricFormValues drops `col = ""`, so a half-filled filter would
  // otherwise vanish and the preview would run unfiltered.
  const rawFilters =
    draft.metricType === "funnel"
      ? (draft.funnelSettings?.steps ?? []).flatMap((step) => step.rowFilters)
      : [
          ...(draft.numerator.rowFilters ?? []),
          ...(draft.metricType === "ratio"
            ? (draft.denominator?.rowFilters ?? [])
            : []),
        ];
  if (!rawFilters.every(isRowFilterComplete)) return null;
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

// The preview is a plain daily query, not an experiment analysis: it caps each
// row instead of each unit's total, and it has no exposure to anchor windows.
export function getMetricPreviewCaveat(
  metric: Pick<
    FactMetricInterface,
    "metricType" | "cappingSettings" | "lowerCappingSettings" | "windowSettings"
  >,
): string | null {
  if (metric.metricType === "funnel") return null;
  const parts: string[] = [];
  if (metric.windowSettings.type || metric.windowSettings.delayValue) {
    parts.push("ignores metric windows and delays");
  }
  if (metric.cappingSettings.type && metric.metricType !== "proportion") {
    parts.push("caps each event instead of each unit's total");
  }
  if (metric.lowerCappingSettings?.type) {
    parts.push("ignores the lower cap");
  }
  if (!parts.length) return null;
  const last = parts.pop();
  const list = parts.length ? `${parts.join(", ")}, and ${last}` : last;
  return `The preview ${list}. Experiment results will differ.`;
}
