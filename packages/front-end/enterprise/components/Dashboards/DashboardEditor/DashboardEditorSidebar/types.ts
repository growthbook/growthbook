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
};

export type ExperimentTimeSeriesBlockContext = BlockContext & {
  type: "experiment-time-series";
  sliceData: Array<{
    value: string;
    label: string;
    sliceLevels: SliceLevelsData[];
  }>;
};

// add more block-specific contexts here

export type SpecificBlockContext =
  | ExperimentMetricBlockContext
  | ExperimentTimeSeriesBlockContext;
