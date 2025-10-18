// Context types for different block types
export type ExperimentMetricBlockContext = {
  type: "experiment-metric";
  sliceData: Array<{
    value: string;
    label: string;
    sliceLevels: Array<{
      column: string;
      datatype: "string" | "boolean";
      levels: string[];
    }>;
  }>;
};

export type ExperimentDimensionBlockContext = {
  type: "experiment-dimension";
  // Add dimension-specific context here if needed
};

export type ExperimentTimeSeriesBlockContext = {
  type: "experiment-time-series";
  // Add time series-specific context here if needed
};

export type ExperimentMetadataBlockContext = {
  type: "experiment-metadata";
  // Add metadata-specific context here if needed
};

export type ExperimentTrafficBlockContext = {
  type: "experiment-traffic";
  // Add traffic-specific context here if needed
};

export type MarkdownBlockContext = {
  type: "markdown";
  // Add markdown-specific context here if needed
};

export type SqlExplorerBlockContext = {
  type: "sql-explorer";
  // Add SQL explorer-specific context here if needed
};

export type BlockContext =
  | ExperimentMetricBlockContext
  | ExperimentDimensionBlockContext
  | ExperimentTimeSeriesBlockContext
  | ExperimentMetadataBlockContext
  | ExperimentTrafficBlockContext
  | MarkdownBlockContext
  | SqlExplorerBlockContext;
