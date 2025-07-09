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

export function isDifferenceType(
  value: unknown
): value is DimensionBlockInterface["differenceType"] {
  return ["absolute", "relative", "scaled"].includes(value as string);
}

export function blockHasFieldOfType<Field extends string, T>(
  data: DashboardBlockData<DashboardBlockInterface>,
  field: Field,
  typeCheck: (val: unknown) => val is T
): data is Extract<
  DashboardBlockData<DashboardBlockInterface>,
  { [K in Field]: T }
> {
  return (
    typeof data === "object" &&
    data !== null &&
    field in data &&
    typeCheck((data as { [K in Field]: T })[field])
  );
}

export function getBlockSnapshotSettings(
  block: DashboardBlockData<DashboardBlockInterface>
): Partial<ExperimentSnapshotSettings> {
  switch (block.type) {
    case "dimension":
      return {
        dimensions: block.dimensionId ? [{ id: block.dimensionId }] : [],
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
        dimensions: block.dimensionId ? [block.dimensionId] : [],
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

export function dashboardCanAutoUpdate({
  blocks,
}: {
  blocks: DashboardBlockData<DashboardBlockInterface>[];
}) {
  // Only update dashboards where all the blocks will stay up to date with each other
  return !blocks.find((block) =>
    ["sql-explorer", "dimension"].includes(block.type)
  );
}
