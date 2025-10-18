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

export type ExperimentDimensionBlockContext = BlockContext & {
  type: "experiment-dimension";
  // Add dimension-specific context here if needed
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

export type ExperimentMetadataBlockContext = BlockContext & {
  type: "experiment-metadata";
  // Add metadata-specific context here if needed
};

export type ExperimentTrafficBlockContext = BlockContext & {
  type: "experiment-traffic";
  // Add traffic-specific context here if needed
};

export type MarkdownBlockContext = BlockContext & {
  type: "markdown";
  // Add markdown-specific context here if needed
};

export type SqlExplorerBlockContext = BlockContext & {
  type: "sql-explorer";
  // Add SQL explorer-specific context here if needed
};

export type SpecificBlockContext =
  | ExperimentMetricBlockContext
  | ExperimentDimensionBlockContext
  | ExperimentTimeSeriesBlockContext
  | ExperimentMetadataBlockContext
  | ExperimentTrafficBlockContext
  | MarkdownBlockContext
  | SqlExplorerBlockContext;
