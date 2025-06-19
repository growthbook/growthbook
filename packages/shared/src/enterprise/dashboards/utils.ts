import {
  DashboardBlockInterface,
  MarkdownBlockInterface,
  MetadataBlockInterface,
  VariationImageBlockInterface,
  MetricBlockInterface,
  DimensionBlockInterface,
  TimeSeriesBlockInterface,
  DashboardBlockData,
} from "back-end/src/enterprise/validators/dashboard-block";
import { DashboardSettingsInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

export function getDefaultDashboardSettingsForExperiment(
  experiment: ExperimentInterfaceStringDates
): DashboardSettingsInterface {
  return {
    defaultSnapshotSettings: { dimensionId: "" },
    defaultAnalysisSettings: {
      baselineVariationIndex: 0,
      differenceType: "relative",
    },
    dateStart: new Date(Date.now() - 30 * 1000 * 3600 * 24),
    dateEnd: new Date(),
    defaultMetricId: experiment.goalMetrics[0],
    defaultVariationIds: experiment.variations.map(({ id }) => id),
    defaultDimensionValues: [],
  };
}

export function isMarkdownBlock(
  block: DashboardBlockInterface
): block is MarkdownBlockInterface {
  return block.type === "markdown";
}

export function isMetadataBlock(
  block: DashboardBlockInterface
): block is MetadataBlockInterface {
  return block.type === "metadata";
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

export function isPersistedDashboardBlock(
  data: DashboardBlockData<DashboardBlockInterface>
): data is DashboardBlockInterface {
  const block = data as DashboardBlockInterface;
  return !!(block.id && block.uid && block.organization);
}
