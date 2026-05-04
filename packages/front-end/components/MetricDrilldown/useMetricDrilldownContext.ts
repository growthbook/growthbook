import { createContext, useContext } from "react";
import { ExperimentTableRow } from "@/services/experiments";

export type MetricDrilldownTab = "overview" | "slices" | "debug";

export interface DrilldownDimensionInfo {
  id: string;
  name: string;
  value: string;
  rawValue: string;
}

export interface DrilldownOptions {
  initialTab?: MetricDrilldownTab;
  initialSliceSearchTerm?: string;
  dimensionInfo?: DrilldownDimensionInfo;
}

export interface MetricDrilldownContextValue {
  openDrilldown: (row: ExperimentTableRow, options?: DrilldownOptions) => void;
}

export const MetricDrilldownContext =
  createContext<MetricDrilldownContextValue | null>(null);

export function useMetricDrilldownContext(): MetricDrilldownContextValue | null {
  return useContext(MetricDrilldownContext);
}
