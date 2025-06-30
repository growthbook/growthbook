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

export function isMarkdownBlock(
  block: DashboardBlockInterface
): block is MarkdownBlockInterface {
  return block.type === "markdown";
}

export function isDescriptionBlock(
  block: DashboardBlockInterface
): block is DescriptionBlockInterface {
  return block.type === "metadata-description";
}

export function isHypothesisBlock(
  block: DashboardBlockInterface
): block is HypothesisBlockInterface {
  return block.type === "metadata-hypothesis";
}

export function isVariationImageBlock(
  block: DashboardBlockInterface
): block is VariationImageBlockInterface {
  return block.type === "variation-image";
}

export function isMetricBlock(
  block: DashboardBlockInterface
): block is MetricBlockInterface {
  return block.type === "metric";
}

export function isDimensionBlock(
  block: DashboardBlockInterface
): block is DimensionBlockInterface {
  return block.type === "dimension";
}

export function isTimeSeriesBlock(
  block: DashboardBlockInterface
): block is TimeSeriesBlockInterface {
  return block.type === "time-series";
}

export function isTrafficTableBlock(
  block: DashboardBlockInterface
): block is TrafficTableBlockInterface {
  return block.type === "traffic-table";
}

export function isTrafficGraphBlock(
  block: DashboardBlockInterface
): block is TrafficGraphBlockInterface {
  return block.type === "traffic-graph";
}

export function isSqlExplorerBlock(
  block: DashboardBlockInterface
): block is SqlExplorerBlockInterface {
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

export function isDashboardBlockWithDifferenceType(
  data: DashboardBlockData<DashboardBlockInterface>
): data is Extract<
  DashboardBlockData<DashboardBlockInterface>,
  { differenceType: string }
> {
  const block = data as { differenceType: string };
  return typeof block.differenceType === "string";
}
