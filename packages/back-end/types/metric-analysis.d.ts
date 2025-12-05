import { z } from "zod";

import {
  createMetricAnalysisPropsValidator,
  metricAnalysisHistogramValidator,
  metricAnalysisInterfaceValidator,
  metricAnalysisPopulationTypeValidator,
  metricAnalysisResultValidator,
  metricAnalysisSettingsValidator,
  metricAnalysisSourceValidator,
} from "back-end/src/routers/metric-analysis/metric-analysis.validators";

export type CreateMetricAnalysisProps = z.infer<
  typeof createMetricAnalysisPropsValidator
>;

export type MetricAnalysisSource = z.infer<
  typeof metricAnalysisSourceValidator
>;

export type MetricAnalysisPopulationType = z.infer<
  typeof metricAnalysisPopulationTypeValidator
>;

export type MetricAnalysisResultDate = {
  date: Date;
  units: number;
  mean: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
  slices?: Array<{
    slice?: Record<string, string | null>;
    units: number;
    mean: number;
    stddev?: number;
    numerator?: number;
    denominator?: number;
  }>;
};

export type MetricAnalysisHistogram = z.infer<
  typeof metricAnalysisHistogramValidator
>;

export type MetricAnalysisResult = z.infer<
  typeof metricAnalysisResultValidator
>;

export type MetricAnalysisSettings = z.infer<
  typeof metricAnalysisSettingsValidator
>;

export type MetricAnalysisInterface = z.infer<
  typeof metricAnalysisInterfaceValidator
>;
