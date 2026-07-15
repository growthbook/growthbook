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
} from "shared/enterprise";
import {
  MetricExplorationConfig,
  FactTableExplorationConfig,
  DataSourceExplorationConfig,
  ExplorationDateRange,
  dateGranularity,
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

export const DEFAULT_DASHBOARD_GLOBAL_CONTROLS = {
  dateRange: {
    predefined: "last30Days",
    lookbackValue: null,
    lookbackUnit: null,
    startDate: null,
    endDate: null,
  },
  dateGranularity: "auto",
} satisfies NonNullable<DashboardInterface["globalControls"]>;

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

export function autoEnrollDashboardBlocksInDateControl<
  T extends DashboardBlockInterfaceOrData<DashboardBlockInterface>,
>(blocks: T[]): T[] {
  return blocks.map((block) =>
    isDashboardGlobalControlSupportedBlock(block) &&
    block.globalControlSettings?.dateRange === undefined
      ? ({
          ...block,
          globalControlSettings: {
            ...block.globalControlSettings,
            dateRange: true,
          },
        } as T)
      : block,
  );
}

export function applyDashboardComparisonToBlocks<
  T extends DashboardBlockInterfaceOrData<DashboardBlockInterface>,
>(blocks: T[], comparison: DashboardInterface["comparison"]): T[] {
  return blocks.map((block) => {
    if (!isDashboardGlobalControlSupportedBlock(block)) return block;
    const enabled = Boolean(comparison?.enabled);
    if (Boolean(block.comparison?.enabled) === enabled) return block;

    return {
      ...block,
      comparison: enabled
        ? {
            ...block.comparison,
            enabled: true,
          }
        : undefined,
      comparisonExplorerAnalysisId: undefined,
    } as T;
  });
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

/**
 * True when a save transitions the dashboard from "no date control" to
 * "date control enabled" — the moment we auto-enroll supported blocks.
 */
export function isEnablingDashboardDateControl(
  existingGlobalControls: DashboardInterface["globalControls"] | undefined,
  nextGlobalControls: DashboardInterface["globalControls"] | undefined,
): boolean {
  return Boolean(
    !existingGlobalControls?.dateRange && nextGlobalControls?.dateRange,
  );
}

/**
 * Resolves the blocks to persist when global controls change, applying
 * first-enable auto-enrollment consistently across the internal controller and
 * the REST API model.
 *
 * - When `nextBlocks` is provided (create, or update whose payload includes
 *   blocks), returns those blocks, auto-enrolled if this save is enabling the
 *   date control.
 * - When `nextBlocks` is omitted (update without a blocks payload), returns
 *   auto-enrolled `existingBlocks` only if this save is enabling the date
 *   control, otherwise `undefined` to signal "leave blocks untouched".
 */
export function resolveGlobalControlsBlockEnrollment<
  T extends DashboardBlockInterfaceOrData<DashboardBlockInterface>,
>({
  existingGlobalControls,
  nextGlobalControls,
  existingBlocks,
  nextBlocks,
}: {
  existingGlobalControls?: DashboardInterface["globalControls"];
  nextGlobalControls?: DashboardInterface["globalControls"];
  existingBlocks?: T[];
  nextBlocks?: T[];
}): T[] | undefined {
  const enrolling = isEnablingDashboardDateControl(
    existingGlobalControls,
    nextGlobalControls,
  );

  if (nextBlocks) {
    return enrolling
      ? autoEnrollDashboardBlocksInDateControl(nextBlocks)
      : nextBlocks;
  }

  if (enrolling && existingBlocks) {
    return autoEnrollDashboardBlocksInDateControl(existingBlocks);
  }

  return undefined;
}

export type DashboardGlobalControlsEvaluation<
  T extends DashboardGlobalControlSupportedBlock,
> = {
  effectiveConfig: T["config"];
  dateRange: {
    enabled: boolean;
    applied: boolean;
  };
};

type DateGranularity = (typeof dateGranularity)[number];
type DashboardGlobalControlSupportedConfig =
  | MetricExplorationConfig
  | FactTableExplorationConfig
  | DataSourceExplorationConfig;

function applyDateGranularity<T extends DashboardGlobalControlSupportedBlock>(
  config: T["config"],
  granularity?: DateGranularity,
): T["config"] {
  if (!granularity) return config;

  return {
    ...config,
    dimensions: config.dimensions.map((dimension) =>
      dimension.dimensionType === "date"
        ? {
            ...dimension,
            dateGranularity: granularity,
          }
        : dimension,
    ),
  };
}

export function restoreBlockLocalDateControls<
  T extends DashboardGlobalControlSupportedConfig,
>(effectiveConfig: T, blockConfig: T): T {
  const blockDateDimension = blockConfig.dimensions.find(
    (dimension) => dimension.dimensionType === "date",
  );

  return {
    ...effectiveConfig,
    dateRange: blockConfig.dateRange,
    dimensions: effectiveConfig.dimensions.map((dimension) =>
      dimension.dimensionType === "date" && blockDateDimension
        ? {
            ...dimension,
            dateGranularity: blockDateDimension.dateGranularity,
          }
        : dimension,
    ),
  };
}

export function evaluateDashboardGlobalControlsForBlock<
  T extends DashboardGlobalControlSupportedBlock,
>(
  block: T,
  dashboard: Pick<DashboardInterface, "globalControls">,
): DashboardGlobalControlsEvaluation<T> {
  const dateRangeEnabled = blockUsesDashboardDateControl(block);
  const dateRangeApplied = Boolean(
    dateRangeEnabled && dashboard.globalControls?.dateRange,
  );
  const config = dateRangeApplied
    ? applyDateGranularity(
        {
          ...block.config,
          dateRange: dashboard.globalControls!.dateRange!,
        },
        dashboard.globalControls?.dateGranularity,
      )
    : block.config;

  return {
    effectiveConfig: config,
    dateRange: {
      enabled: dateRangeEnabled,
      applied: dateRangeApplied,
    },
  };
}

export function getEffectiveExplorationConfig<
  T extends DashboardGlobalControlSupportedBlock,
>(
  block: T,
  dashboard: Pick<DashboardInterface, "globalControls">,
): T["config"] {
  return evaluateDashboardGlobalControlsForBlock(block, dashboard)
    .effectiveConfig;
}

/**
 * The only fields a dashboard date control drives on an exploration config:
 * the date range and the date dimension's granularity. Staleness checks compare
 * this fingerprint instead of the whole config so unrelated fields (or future
 * server-side normalization of other fields) can't produce a spurious
 * "controls changed" state.
 */
export function getExplorationDateControlFingerprint(config: {
  dateRange: ExplorationDateRange;
  dimensions: ReadonlyArray<{
    dimensionType: string;
    dateGranularity?: DateGranularity;
  }>;
}): {
  dateRange: ExplorationDateRange;
  dateGranularity: DateGranularity | null;
} {
  const dateDimension = config.dimensions.find(
    (dimension) => dimension.dimensionType === "date",
  );
  return {
    dateRange: config.dateRange,
    dateGranularity: dateDimension?.dateGranularity ?? null,
  };
}

export function getDashboardGlobalControlApplicability(dashboard: {
  globalControls?: DashboardInterface["globalControls"];
  comparison?: DashboardInterface["comparison"];
  blocks: readonly DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
}): {
  supportedBlocks: DashboardGlobalControlSupportedBlock[];
  unsupportedBlocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  dateControlledBlocks: DashboardGlobalControlSupportedBlock[];
  compareControlledBlocks: DashboardGlobalControlSupportedBlock[];
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
  const compareControlledBlocks = supportedBlocks;

  return {
    supportedBlocks,
    unsupportedBlocks,
    dateControlledBlocks,
    compareControlledBlocks,
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
    comparison?: DashboardInterface["comparison"];
    blocks: readonly DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  },
  datasourcesById: DatasourceLookup,
): boolean {
  const applicability = getDashboardGlobalControlApplicability(dashboard);
  const affectedBlocks = new Set<DashboardGlobalControlSupportedBlock>();
  if (dashboard.globalControls?.dateRange) {
    applicability.dateControlledBlocks.forEach((block) =>
      affectedBlocks.add(block),
    );
  }
  if (dashboard.comparison?.enabled) {
    applicability.compareControlledBlocks.forEach((block) =>
      affectedBlocks.add(block),
    );
  }
  if (!affectedBlocks.size) return false;

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
