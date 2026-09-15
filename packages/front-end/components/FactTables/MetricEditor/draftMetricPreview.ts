import { factMetricValidator } from "shared/validators";
import { FactMetricInterface } from "shared/types/fact-table";
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
