// Context types for different block types
import { SliceLevelsData } from "shared/experiments";

// Base interface for all block contexts
export interface BlockContext {
  type: string;
}

export type ExperimentMetricBlockContext = BlockContext & {
  type: "experiment-metric";
  sliceData: Array<{
    value: string;
    label: string;
    sliceLevels: SliceLevelsData[];
  }>;
  togglePinnedMetricSlice?: (
    metricId: string,
    sliceLevels: SliceLevelsData[],
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  isSlicePinned?: (pinKey: string) => boolean;
};

export type ExperimentTimeSeriesBlockContext = BlockContext & {
  type: "experiment-time-series";
  sliceData: Array<{
    value: string;
    label: string;
    sliceLevels: SliceLevelsData[];
  }>;
  togglePinnedMetricSlice?: (
    metricId: string,
    sliceLevels: SliceLevelsData[],
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  isSlicePinned?: (pinKey: string) => boolean;
};

// add more block-specific contexts here

export type SpecificBlockContext =
  | ExperimentMetricBlockContext
  | ExperimentTimeSeriesBlockContext;
