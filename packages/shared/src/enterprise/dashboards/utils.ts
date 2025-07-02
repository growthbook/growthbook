import {
  DashboardBlockInterface,
  MarkdownBlockInterface,
  VariationImageBlockInterface,
  MetricBlockInterface,
  DimensionBlockInterface,
  TimeSeriesBlockInterface,
  DashboardBlockData,
  HypothesisBlockInterface,
  DescriptionBlockInterface,
  SqlExplorerBlockInterface,
  TrafficGraphBlockInterface,
  TrafficTableBlockInterface,
  DashboardBlockWithSnapshot,
} from "back-end/src/enterprise/validators/dashboard-block";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";

export function getBlockData<
  T extends DashboardBlockData<DashboardBlockInterface>
>(block: T) {
  return { ...block, organization: undefined, id: undefined, uid: undefined };
}

export function isMarkdownBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<MarkdownBlockInterface> {
  return block.type === "markdown";
}

export function isDescriptionBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<DescriptionBlockInterface> {
  return block.type === "metadata-description";
}

export function isHypothesisBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<HypothesisBlockInterface> {
  return block.type === "metadata-hypothesis";
}

export function isVariationImageBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<VariationImageBlockInterface> {
  return block.type === "variation-image";
}

export function isMetricBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<MetricBlockInterface> {
  return block.type === "metric";
}

export function isDimensionBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<DimensionBlockInterface> {
  return block.type === "dimension";
}

export function isTimeSeriesBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<TimeSeriesBlockInterface> {
  return block.type === "time-series";
}

export function isTrafficTableBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<TrafficTableBlockInterface> {
  return block.type === "traffic-table";
}

export function isTrafficGraphBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<TrafficGraphBlockInterface> {
  return block.type === "traffic-graph";
}

export function isSqlExplorerBlock(
  block: DashboardBlockData<DashboardBlockInterface>
): block is DashboardBlockData<SqlExplorerBlockInterface> {
  return block.type === "sql-explorer";
}

export function isPersistedDashboardBlock(
  data: DashboardBlockData<DashboardBlockInterface>
): data is DashboardBlockInterface {
  const block = data as DashboardBlockInterface;
  return !!(block.id && block.uid && block.organization);
}

export function isDashboardBlockWithSnapshot(
  data: DashboardBlockData<DashboardBlockInterface>
): data is DashboardBlockData<DashboardBlockWithSnapshot> {
  const block = data as DashboardBlockData<DashboardBlockWithSnapshot>;
  return typeof block.snapshotId === "string";
}

export function isDashboardBlockWithMetricIds(
  data: DashboardBlockData<DashboardBlockInterface>
): data is Extract<
  DashboardBlockData<DashboardBlockInterface>,
  { metricIds: string[] }
> {
  const block = data as { metricIds: string[] };
  return Array.isArray(block.metricIds);
}

export function isDashboardBlockWithDimensionIds(
  data: DashboardBlockData<DashboardBlockInterface>
): data is Extract<
  DashboardBlockData<DashboardBlockInterface>,
  { dimensionIds: string[] }
> {
  const block = data as { dimensionIds: string[] };
  return Array.isArray(block.dimensionIds);
}

export function isDashboardBlockWithBaselineRow(
  data: DashboardBlockData<DashboardBlockInterface>
): data is Extract<
  DashboardBlockData<DashboardBlockInterface>,
  { baselineRow: number }
> {
  const block = data as { baselineRow: number };
  return typeof block.baselineRow === "number";
}

export function isDashboardBlockWithDifferenceType(
  data: DashboardBlockData<DashboardBlockInterface>
): data is Extract<
  DashboardBlockData<DashboardBlockInterface>,
  { differenceType: string }
> {
  const block = data as { differenceType: string };
  return typeof block.differenceType === "string";
}

export function getBlockSnapshotSettings(
  block: DashboardBlockData<DashboardBlockInterface>
): Partial<ExperimentSnapshotSettings> {
  switch (block.type) {
    case "dimension":
      return {
        dimensions: (block.dimensionIds || []).map((id) => ({
          id,
        })),
      };
    default:
      return {};
  }
}

export function getBlockAnalysisSettings(
  block: DashboardBlockData<DashboardBlockInterface>,
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings
): ExperimentSnapshotAnalysisSettings {
  switch (block.type) {
    case "dimension":
      return {
        ...defaultAnalysisSettings,
        dimensions: block.dimensionIds,
        differenceType: block.differenceType,
        baselineVariationIndex: block.baselineRow,
      };
    case "metric":
      return {
        ...defaultAnalysisSettings,
        differenceType: block.differenceType,
        baselineVariationIndex: block.baselineRow,
      };
    default:
      return { ...defaultAnalysisSettings };
  }
}
