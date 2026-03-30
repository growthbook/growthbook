import { createContext, useContext } from "react";
import { ExperimentTableRow } from "@/services/experiments";

export type MetricDrilldownTab = "overview" | "slices" | "debug";

export interface DrilldownOptions {
  initialTab?: MetricDrilldownTab;
  initialSliceSearchTerm?: string;
  dimensionInfo?: { name: string; value: string };
}

export interface MetricDrilldownContextValue {
  openDrilldown: (row: ExperimentTableRow, options?: DrilldownOptions) => void;
}

export const MetricDrilldownContext =
  createContext<MetricDrilldownContextValue | null>(null);

export function useMetricDrilldownContext(): MetricDrilldownContextValue | null {
  return useContext(MetricDrilldownContext);
}
