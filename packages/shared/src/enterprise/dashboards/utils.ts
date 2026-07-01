import {
  DashboardBlockInterface,
  DashboardBlockData,
  DashboardBlockType,
  DashboardBlockInterfaceOrData,
  CreateDashboardBlockInterface,
  DashboardTemplateInterface,
  DashboardInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  DashboardGlobalDimension,
  DashboardGlobalDimensionTarget,
} from "shared/enterprise";
import {
  MetricExplorationConfig,
  FactTableExplorationConfig,
  DataSourceExplorationConfig,
} from "shared/validators";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { DataSourceInterface } from "shared/types/datasource";
import { isNumber, isString } from "../../util/types";
import { getSnapshotAnalysis, isManagedWarehouse } from "../../util";
import {
  parseSliceQueryString,
  generateSliceString,
  expandMetricGroups,
} from "../../experiments/experiments";
import { DataVizConfig } from "../../../validators";
import { getInitialConfigByBlockType } from "../product-analytics/utils";

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

type DashboardGlobalControlSupportedBlock = DashboardBlockInterfaceOrData<
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
>;

const dashboardGlobalControlSupportedBlockTypes = new Set<DashboardBlockType>([
  "metric-exploration",
  "fact-table-exploration",
  "data-source-exploration",
]);

export function getTemporaryDashboardBlockId(index: number): string {
  return `tmp:${index}`;
}

export function isDashboardGlobalControlSupportedBlock(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
): block is DashboardGlobalControlSupportedBlock {
  return dashboardGlobalControlSupportedBlockTypes.has(block.type);
}

export function blockUsesDashboardDateControl(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
): block is DashboardGlobalControlSupportedBlock & {
  globalControlSettings: { dateRange: true };
} {
  return (
    isDashboardGlobalControlSupportedBlock(block) &&
    block.globalControlSettings?.dateRange === true
  );
}

export function blockUsesDashboardDimensionControl(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  dimensionId: string,
): block is DashboardGlobalControlSupportedBlock {
  if (!isDashboardGlobalControlSupportedBlock(block)) return false;
  return block.globalControlSettings?.dimensions?.[dimensionId] !== false;
}

function getTargetedValueIndexes(
  block: DashboardGlobalControlSupportedBlock,
  target: DashboardGlobalDimensionTarget,
): number[] {
  const values = block.config.dataset.values;
  if (typeof target.valueIndex === "number") {
    const value = values[target.valueIndex];
    if (!value) return [];
    if (
      block.config.dataset.type === "metric" &&
      target.metricId &&
      value.type === "metric" &&
      value.metricId !== target.metricId
    ) {
      return [];
    }
    return [target.valueIndex];
  }

  return values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => {
      if (
        block.config.dataset.type === "metric" &&
        target.metricId &&
        value.type === "metric"
      ) {
        return value.metricId === target.metricId;
      }
      return true;
    })
    .map(({ index }) => index);
}

function targetMatchesCurrentBlock(
  block: DashboardGlobalControlSupportedBlock,
  target: DashboardGlobalDimensionTarget,
  blockIndex?: number,
): boolean {
  const blockId = dashboardBlockHasIds(block)
    ? block.id
    : blockIndex !== undefined
      ? getTemporaryDashboardBlockId(blockIndex)
      : null;
  if (!blockId || target.blockId !== blockId) {
    return false;
  }
  if (target.datasource && target.datasource !== block.config.datasource) {
    return false;
  }

  const { dataset } = block.config;
  if (
    dataset.type === "fact_table" &&
    target.factTableId &&
    target.factTableId !== dataset.factTableId
  ) {
    return false;
  }
  if (
    dataset.type === "data_source" &&
    dataset.columnTypes &&
    !(target.column in dataset.columnTypes)
  ) {
    return false;
  }
  return getTargetedValueIndexes(block, target).length > 0;
}

export type DashboardGlobalDimensionSkippedReason =
  | "disabled"
  | "invalid-target"
  | "capacity";

export type DashboardGlobalDimensionEvaluation = {
  dimension: DashboardGlobalDimension;
  target?: DashboardGlobalDimensionTarget;
  enabled: boolean;
  applied: boolean;
  column: string;
  maxValues: number;
  skippedReason?: DashboardGlobalDimensionSkippedReason;
};

export type DashboardGlobalControlsEvaluation<
  T extends DashboardGlobalControlSupportedBlock,
> = {
  effectiveConfig: T["config"];
  dateRange: {
    enabled: boolean;
    applied: boolean;
  };
  dimensions: DashboardGlobalDimensionEvaluation[];
};

function getMaxGlobalDimensions(
  block: DashboardGlobalControlSupportedBlock,
): number {
  if (block.config.chartType === "bigNumber") return 0;
  return block.config.dataset.values.length > 1 ? 1 : 2;
}

export function evaluateDashboardGlobalControlsForBlock<
  T extends DashboardGlobalControlSupportedBlock,
>(
  block: T,
  dashboard: Pick<DashboardInterface, "globalControls">,
  blockIndex?: number,
): DashboardGlobalControlsEvaluation<T> {
  const dateRangeEnabled = blockUsesDashboardDateControl(block);
  const dateRangeApplied = Boolean(
    dateRangeEnabled && dashboard.globalControls?.dateRange,
  );
  const config = dateRangeApplied
    ? {
        ...block.config,
        dateRange: dashboard.globalControls!.dateRange!,
      }
    : block.config;
  const dateDimensions = config.dimensions.filter(
    (dimension) => dimension.dimensionType === "date",
  );
  const blockDimensions = config.dimensions.filter(
    (dimension) => dimension.dimensionType !== "date",
  );
  const availableGlobalDimensions = Math.max(
    0,
    getMaxGlobalDimensions(block) -
      dateDimensions.length -
      blockDimensions.length,
  );
  let appliedGlobalDimensions = 0;
  const dimensions = (dashboard.globalControls?.dimensions ?? []).map(
    (dimension): DashboardGlobalDimensionEvaluation => {
      const enabled = blockUsesDashboardDimensionControl(block, dimension.id);
      const target = dimension.targets.find((target) =>
        targetMatchesCurrentBlock(block, target, blockIndex),
      );
      const column = target?.column || dimension.column;

      if (!enabled) {
        return {
          dimension,
          target,
          enabled,
          applied: false,
          column,
          maxValues: dimension.maxValues,
          skippedReason: "disabled",
        };
      }
      if (!target) {
        return {
          dimension,
          enabled,
          applied: false,
          column,
          maxValues: dimension.maxValues,
          skippedReason: "invalid-target",
        };
      }
      if (appliedGlobalDimensions >= availableGlobalDimensions) {
        return {
          dimension,
          target,
          enabled,
          applied: false,
          column,
          maxValues: dimension.maxValues,
          skippedReason: "capacity",
        };
      }

      appliedGlobalDimensions += 1;
      return {
        dimension,
        target,
        enabled,
        applied: true,
        column,
        maxValues: dimension.maxValues,
      };
    },
  );
  const globalDimensions = dimensions
    .filter((dimension) => dimension.applied)
    .map((dimension) => ({
      dimensionType: "dynamic" as const,
      column: dimension.column,
      maxValues: dimension.maxValues,
    }));

  return {
    effectiveConfig: {
      ...config,
      dimensions: [...dateDimensions, ...blockDimensions, ...globalDimensions],
    } as T["config"],
    dateRange: {
      enabled: dateRangeEnabled,
      applied: dateRangeApplied,
    },
    dimensions,
  };
}

export function getEffectiveExplorationConfig<
  T extends DashboardGlobalControlSupportedBlock,
>(
  block: T,
  dashboard: Pick<DashboardInterface, "globalControls">,
  blockIndex?: number,
): T["config"] {
  return evaluateDashboardGlobalControlsForBlock(block, dashboard, blockIndex)
    .effectiveConfig;
}

export function getDashboardGlobalControlApplicability(dashboard: {
  globalControls?: DashboardInterface["globalControls"];
  blocks: readonly DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
}): {
  supportedBlocks: DashboardGlobalControlSupportedBlock[];
  unsupportedBlocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  dateControlledBlocks: DashboardGlobalControlSupportedBlock[];
  dimensions: {
    dimension: DashboardGlobalDimension;
    affectedBlocks: DashboardGlobalControlSupportedBlock[];
    invalidTargets: DashboardGlobalDimensionTarget[];
  }[];
} {
  const supportedBlocks: DashboardGlobalControlSupportedBlock[] = [];
  const unsupportedBlocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[] =
    [];

  dashboard.blocks.forEach((block) => {
    if (isDashboardGlobalControlSupportedBlock(block)) {
      supportedBlocks.push(block);
    } else {
      unsupportedBlocks.push(block);
    }
  });

  const dateControlledBlocks = supportedBlocks.filter(
    blockUsesDashboardDateControl,
  );
  const dimensions = (dashboard.globalControls?.dimensions ?? []).map(
    (dimension) => {
      const affectedBlocks = new Set<DashboardGlobalControlSupportedBlock>();
      const invalidTargets: DashboardGlobalDimensionTarget[] = [];

      dimension.targets.forEach((target) => {
        const blockIndex = dashboard.blocks.findIndex((block) => {
          if (!isDashboardGlobalControlSupportedBlock(block)) return false;
          const blockId = dashboardBlockHasIds(block)
            ? block.id
            : getTemporaryDashboardBlockId(
                dashboard.blocks.findIndex((candidate) => candidate === block),
              );
          return blockId === target.blockId;
        });
        const block =
          blockIndex >= 0 &&
          isDashboardGlobalControlSupportedBlock(dashboard.blocks[blockIndex])
            ? dashboard.blocks[blockIndex]
            : undefined;
        if (!block || !targetMatchesCurrentBlock(block, target, blockIndex)) {
          invalidTargets.push(target);
          return;
        }
        const dimensionEvaluation = evaluateDashboardGlobalControlsForBlock(
          block,
          dashboard,
          blockIndex,
        ).dimensions.find(
          (dimensionEvaluation) =>
            dimensionEvaluation.dimension.id === dimension.id,
        );
        if (dimensionEvaluation?.skippedReason === "invalid-target") {
          invalidTargets.push(target);
          return;
        }
        if (dimensionEvaluation?.applied) {
          affectedBlocks.add(block);
        }
      });

      return {
        dimension,
        affectedBlocks: [...affectedBlocks],
        invalidTargets,
      };
    },
  );

  return {
    supportedBlocks,
    unsupportedBlocks,
    dateControlledBlocks,
    dimensions,
  };
}

type DatasourceMap = ReadonlyMap<
  string,
  Pick<DataSourceInterface, "type"> | undefined
>;
type DatasourceRecord = Readonly<
  Record<string, Pick<DataSourceInterface, "type"> | undefined>
>;
type DatasourceLookup = DatasourceMap | DatasourceRecord;

function isDatasourceMap(
  datasourcesById: DatasourceLookup,
): datasourcesById is DatasourceMap {
  return datasourcesById instanceof Map;
}

function getDatasourceFromLookup(
  datasourcesById: DatasourceLookup,
  datasourceId: string,
): Pick<DataSourceInterface, "type"> | undefined {
  if (isDatasourceMap(datasourcesById)) {
    return datasourcesById.get(datasourceId);
  }

  return datasourcesById[datasourceId];
}

export function canAutoRefreshDashboard(
  dashboard: {
    globalControls?: DashboardInterface["globalControls"];
    blocks: readonly DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  },
  datasourcesById: DatasourceLookup,
): boolean {
  const applicability = getDashboardGlobalControlApplicability(dashboard);
  const affectedBlocks = new Set([
    ...applicability.dateControlledBlocks,
    ...applicability.dimensions.flatMap(({ affectedBlocks }) => affectedBlocks),
  ]);

  return [...affectedBlocks].every((block) => {
    const datasource = getDatasourceFromLookup(
      datasourcesById,
      block.config.datasource,
    );
    return datasource ? isManagedWarehouse(datasource) : false;
  });
}

export function isDifferenceType(
  value: unknown,
): value is (typeof differenceTypes)[number] {
  if (typeof value !== "string") return false;
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
  // Check both regular precomputed dimensions and precomputed unit dimensions
  const precomputedDimIds = snapshot.settings.dimensions.map(({ id }) => id);
  const precomputedUnitDimIds =
    snapshot.settings.precomputedUnitDimensionIds ?? [];
  return (
    precomputedDimIds.includes(blockSettings.dimensionId) ||
    precomputedUnitDimIds.includes(blockSettings.dimensionId)
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
  "metric-exploration": ({ initialValues }) => ({
    type: "metric-exploration",
    title: "",
    description: "",
    explorerAnalysisId: "",
    config:
      initialValues?.config ??
      (getInitialConfigByBlockType(
        "metric-exploration",
        initialValues?.config?.datasource ?? "",
      ) as MetricExplorationConfig),
    ...(initialValues || {}),
  }),
  "fact-table-exploration": ({ initialValues }) => ({
    type: "fact-table-exploration",
    title: "",
    description: "",
    explorerAnalysisId: "",
    config:
      initialValues?.config ??
      (getInitialConfigByBlockType(
        "fact-table-exploration",
        initialValues?.config?.datasource ?? "",
      ) as FactTableExplorationConfig),
    ...(initialValues || {}),
  }),
  "data-source-exploration": ({ initialValues }) => ({
    type: "data-source-exploration",
    title: "",
    description: "",
    explorerAnalysisId: "",
    config:
      initialValues?.config ??
      (getInitialConfigByBlockType(
        "data-source-exploration",
        initialValues?.config?.datasource ?? "",
      ) as DataSourceExplorationConfig),
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
    // TypeScript can't correlate destructured discriminant with rest properties
    (CREATE_BLOCK_TYPE[type] as CreateBlock<DashboardBlockInterface>)({
      initialValues,
      experiment,
      metricGroups,
    }),
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
