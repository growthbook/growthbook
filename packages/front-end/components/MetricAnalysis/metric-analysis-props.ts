import {
  CreateMetricAnalysisProps,
  MetricAnalysisSource,
} from "back-end/types/metric-analysis";
import { MetricAnalysisFormFields } from "@/components/MetricAnalysis/MetricAnalysis";

export function getMetricAnalysisProps({
  id,
  values,
  endOfToday,
  source,
}: {
  id: string;
  values: MetricAnalysisFormFields;
  endOfToday: Date;
  source?: MetricAnalysisSource;
}): CreateMetricAnalysisProps {
  const todayMinusLookback = new Date(endOfToday);
  todayMinusLookback.setDate(
    todayMinusLookback.getDate() - (values.lookbackDays as number),
  );
  todayMinusLookback.setHours(0, 0, 0, 0);

  return {
    id: id,
    userIdType: values.userIdType,
    lookbackDays: Number(values.lookbackDays),
    startDate: todayMinusLookback.toISOString().substring(0, 16),
    endDate: endOfToday.toISOString().substring(0, 16),
    populationType: values.populationType,
    populationId: values.populationId ?? null,
    source: source ?? "metric",
    additionalNumeratorFilters: [],
    additionalDenominatorFilters: [],
    metricAutoSlices: [],
    customMetricSlices: [],
  };
}
