import {
  DashboardBlockInterface,
  DashboardBlockData,
  DashboardBlockType,
  DashboardBlockInterfaceOrData,
  CreateDashboardBlockInterface,
  DashboardTemplateInterface,
} from "shared/enterprise";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { isNumber, isString } from "../../util/types";
import { getSnapshotAnalysis } from "../../util";
import {
  parseSliceQueryString,
  generateSliceString,
  expandMetricGroups,
} from "../../experiments";
import { DataVizConfig } from "../../../validators";

export const differenceTypes = ["absolute", "relative", "scaled"] as const;

// BlockConfig item types for sql-explorer blocks
export const BLOCK_CONFIG_ITEM_TYPES = {
  RESULTS_TABLE: "results_table",
  VISUALIZATION: "visualization",
} as const;

export function isResultsTableItem(item: string): boolean {
  return item === BLOCK_CONFIG_ITEM_TYPES.RESULTS_TABLE;
}
export const pinSources = ["experiment", "custom", "none"] as const;

export interface BlockSnapshotSettings {
  dimensionId?: string;
}

export function getBlockData<T extends DashboardBlockInterface>(
  block: DashboardBlockInterfaceOrData<T>,
): DashboardBlockData<T> {
  return { ...block, organization: undefined, id: undefined, uid: undefined };
}

export function dashboardBlockHasIds<T extends DashboardBlockInterface>(
  data: DashboardBlockInterfaceOrData<T>,
): data is T {
  const block = data as T;
  return !!(block.id && block.uid && block.organization);
}

export function isDifferenceType(
  value: string,
): value is (typeof differenceTypes)[number] {
  return (differenceTypes as readonly string[]).includes(value);
}

export function blockHasFieldOfType<Field extends string, T>(
  data: DashboardBlockInterfaceOrData<DashboardBlockInterface> | undefined,
  field: Field,
  typeCheck: (val: unknown) => val is T,
): data is Extract<
  DashboardBlockInterfaceOrData<DashboardBlockInterface>,
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
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
): BlockSnapshotSettings {
  const blockSettings: BlockSnapshotSettings = {};
  if (
    blockHasFieldOfType(block, "dimensionId", isString) &&
    block.dimensionId.length > 0
  ) {
    blockSettings.dimensionId = block.dimensionId;
  }
  return blockSettings;
}

export function getBlockAnalysisSettings(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings,
): ExperimentSnapshotAnalysisSettings {
  const blockSettings: Partial<ExperimentSnapshotAnalysisSettings> = {};
  if (
    blockHasFieldOfType(block, "dimensionId", isString) &&
    block.dimensionId.length > 0
  ) {
    blockSettings.dimensions = [block.dimensionId];
  }
  if (blockHasFieldOfType(block, "differenceType", isDifferenceType)) {
    blockSettings.differenceType = block.differenceType;
  }
  if (blockHasFieldOfType(block, "baselineRow", isNumber)) {
    blockSettings.baselineVariationIndex = block.baselineRow;
  }

  return {
    ...defaultAnalysisSettings,
    ...blockSettings,
  };
}

export function snapshotSatisfiesBlock(
  snapshot: ExperimentSnapshotInterface,
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
) {
  const blockSettings = getBlockSnapshotSettings(block);
  // If snapshot does have a dimension, must match block dimension
  if (snapshot.dimension) {
    return snapshot.dimension === blockSettings.dimensionId;
  }
  if (!blockSettings.dimensionId) return true;
  // If snapshot doesn't have a dimension, check whether the requested dimension is precomputed
  return snapshot.settings.dimensions.some(
    ({ id }) => blockSettings.dimensionId === id,
  );
}

export function getBlockSnapshotAnalysis<
  B extends DashboardBlockInterfaceOrData<DashboardBlockInterface>,
>(snapshot: ExperimentSnapshotInterface, block: B) {
  const defaultAnalysis = getSnapshotAnalysis(snapshot);
  if (!defaultAnalysis) return null;
  const blockAnalysisSettings = getBlockAnalysisSettings(
    block,
    defaultAnalysis.settings,
  );
  return getSnapshotAnalysis(snapshot, blockAnalysisSettings);
}

type CreateBlock<T extends DashboardBlockInterface> = (args: {
  experiment: ExperimentInterfaceStringDates | ExperimentInterface;
  metricGroups: MetricGroupInterface[];
  initialValues?: Partial<DashboardBlockData<T>>;
}) => DashboardBlockData<T>;

export const CREATE_BLOCK_TYPE: {
  [k in DashboardBlockType]: CreateBlock<
    Extract<DashboardBlockInterface, { type: k }>
  >;
} = {
  markdown: ({ initialValues }) => ({
    type: "markdown",
    title: "",
    description: "",
    content: "",
    ...(initialValues || {}),
  }),
  "experiment-metadata": ({ initialValues, experiment }) => ({
    type: "experiment-metadata",
    title: "Experiment Metadata",
    description: "",
    experimentId: experiment.id,
    showDescription: true,
    showHypothesis: true,
    showVariationImages: true,
    variationIds: [],
    ...(initialValues || {}),
  }),
  "experiment-metric": ({ initialValues, experiment }) => ({
    type: "experiment-metric",
    title: "",
    description: "",
    experimentId: experiment.id,
    metricIds: [],
    snapshotId: experiment.analysisSummary?.snapshotId || "",
    variationIds: [],
    differenceType: "relative",
    baselineRow: 0,
    columnsFilter: [],
    sliceTagsFilter: [],
    metricTagFilter: [],
    sortBy: null,
    sortDirection: null,
    ...(initialValues || {}),
  }),
  "experiment-dimension": ({ initialValues, experiment }) => ({
    type: "experiment-dimension",
    title: "",
    description: "",
    experimentId: experiment.id,
    metricIds: [],
    dimensionId: "",
    dimensionValues: [],
    snapshotId: experiment.analysisSummary?.snapshotId || "",
    variationIds: [],
    differenceType: "relative",
    baselineRow: 0,
    columnsFilter: [],
    metricTagFilter: [],
    sortBy: null,
    sortDirection: null,
    ...(initialValues || {}),
  }),
  "experiment-time-series": ({ initialValues, experiment }) => ({
    type: "experiment-time-series",
    title: "",
    description: "",
    experimentId: experiment.id,
    metricIds: [],
    snapshotId: experiment.analysisSummary?.snapshotId || "",
    variationIds: [],
    differenceType: "relative",
    sliceTagsFilter: [],
    metricTagFilter: [],
    sortBy: null,
    sortDirection: null,
    ...(initialValues || {}),
  }),
  "experiment-traffic": ({ initialValues, experiment }) => ({
    type: "experiment-traffic",
    title: "",
    description: "",
    experimentId: experiment.id,
    showTable: true,
    showTimeseries: false,
    ...(initialValues || {}),
  }),
  "sql-explorer": ({ initialValues }) => ({
    type: "sql-explorer",
    title: "",
    description: "",
    savedQueryId: "",
    blockConfig: [],
    ...(initialValues || {}),
  }),
  "metric-explorer": ({ initialValues }) => ({
    type: "metric-explorer",
    title: "",
    description: "",
    factMetricId: "",
    analysisSettings: {
      lookbackDays: 30,
      startDate: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      endDate: new Date(),
      populationId: "",
      populationType: "factTable",
      userIdType: "",
      additionalNumeratorFilters: undefined,
      additionalDenominatorFilters: undefined,
    },
    visualizationType: "timeseries",
    valueType: "avg",
    metricAnalysisId: "",
    ...(initialValues || {}),
  }),
};

export function createDashboardBlocksFromTemplate(
  {
    blockInitialValues,
  }: Pick<DashboardTemplateInterface, "blockInitialValues">,
  experiment: ExperimentInterface | ExperimentInterfaceStringDates,
  metricGroups: MetricGroupInterface[],
): CreateDashboardBlockInterface[] {
  return blockInitialValues.map(({ type, ...initialValues }) =>
    CREATE_BLOCK_TYPE[type]({ initialValues, experiment, metricGroups }),
  );
}

// Filters and groups experiment metrics based on selected metric IDs.
// Optionally deduplicates metrics across groups when allowDuplicates is false.
export function filterAndGroupExperimentMetrics({
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  metricGroups,
  selectedMetricIds,
  allowDuplicates,
}: {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricGroups: MetricGroupInterface[];
  selectedMetricIds: string[];
  allowDuplicates: boolean;
}): {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
} {
  const expandedGoalMetrics = expandMetricGroups(goalMetrics, metricGroups);
  const expandedSecondaryMetrics = expandMetricGroups(
    secondaryMetrics,
    metricGroups,
  );
  const expandedGuardrailMetrics = expandMetricGroups(
    guardrailMetrics,
    metricGroups,
  );

  const filteredGoalMetrics = expandedGoalMetrics.filter((mId) =>
    selectedMetricIds.includes(mId),
  );

  const filteredSecondaryMetrics = expandedSecondaryMetrics.filter(
    (mId) =>
      selectedMetricIds.includes(mId) &&
      (allowDuplicates || !filteredGoalMetrics.includes(mId)),
  );

  const filteredGuardrailMetrics = expandedGuardrailMetrics.filter(
    (mId) =>
      selectedMetricIds.includes(mId) &&
      (allowDuplicates ||
        (!filteredGoalMetrics.includes(mId) &&
          !filteredSecondaryMetrics.includes(mId))),
  );

  return {
    goalMetrics: filteredGoalMetrics,
    secondaryMetrics: filteredSecondaryMetrics,
    guardrailMetrics: filteredGuardrailMetrics,
  };
}

// Converts pinnedMetricSlices to sliceTagsFilter by extracting slice tags
// from pinned slice keys and generating all possible slice tags (individual + combined).
// Adds "overall" to include base metric results when migrating pinned slices.
export function convertPinnedSlicesToSliceTags(
  pinnedMetricSlices: string[],
): string[] {
  const sliceTags = new Set<string>();

  for (const pinnedKey of pinnedMetricSlices) {
    const questionMarkIndex = pinnedKey.indexOf("?");
    if (questionMarkIndex === -1) continue;

    const locationIndex = pinnedKey.indexOf("&location=");
    if (locationIndex === -1) continue;

    const sliceString = pinnedKey.substring(
      questionMarkIndex + 1,
      locationIndex,
    );

    const sliceLevels = parseSliceQueryString(sliceString);

    if (sliceLevels.length === 0) continue;

    sliceLevels.forEach((sliceLevel) => {
      const value = sliceLevel.levels[0] || "";
      const tag = generateSliceString({ [sliceLevel.column]: value });
      sliceTags.add(tag);
    });

    if (sliceLevels.length > 1) {
      const slices: Record<string, string> = {};
      sliceLevels.forEach((sl) => {
        slices[sl.column] = sl.levels[0] || "";
      });
      const comboTag = generateSliceString(slices);
      sliceTags.add(comboTag);
    }
  }

  if (pinnedMetricSlices.length > 0) {
    sliceTags.add("overall");
  }

  return Array.from(sliceTags);
}

export function chartTypeSupportsAnchorYAxisToZero(
  chartType: DataVizConfig["chartType"],
): boolean {
  return ["line", "scatter"].includes(chartType);
}

export function chartTypeHasDisplaySettings(
  chartType: DataVizConfig["chartType"] | undefined,
): boolean {
  if (!chartType) {
    return false;
  }
  // Check if the chart type supports any display settings
  // As more display settings are added, add their checks here
  return chartTypeSupportsAnchorYAxisToZero(chartType);
}
