import { z } from "zod";

import {
  createMetricAnalysisPropsValidator,
  metricAnalysisInterfaceValidator,
  metricAnalysisPopulationTypeValidator,
  metricAnalysisSettingsValidator,
} from "../src/routers/metric-analysis/metric-analysis.validators";

export type CreateMetricAnalysisProps = z.infer<
  typeof createMetricAnalysisPropsValidator
>;

export type MetricAnalysisPopulationType = z.infer<
  typeof metricAnalysisPopulationTypeValidator
>;

export type MetricAnalysisSettings = z.infer<
  typeof metricAnalysisSettingsValidator
>;

export type MetricAnalysisInterface = z.infer<
  typeof metricAnalysisInterfaceValidator
>;
