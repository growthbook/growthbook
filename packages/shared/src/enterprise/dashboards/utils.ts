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
  MetricExperimentsBlockInterface,
  ExperimentsScaledImpactBlockInterface,
  ExperimentsWinRateBlockInterface,
  ExperimentsStatusBlockInterface,
  FunnelExplorationBlockInterface,
} from "shared/enterprise";
import {
  MetricExplorationConfig,
  FactTableExplorationConfig,
  DataSourceExplorationConfig,
  FunnelExplorationConfig,
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

// Single source of truth for the Difference Type selector's options (label +
// value), shared by every block editor that renders the control so the option
// set can't drift between copies. Ordered as shown in the UI.
export const DIFFERENCE_TYPE_OPTIONS: {
  label: string;
  value: (typeof differenceTypes)[number];
}[] = [
  { label: "Relative", value: "relative" },
  { label: "Absolute", value: "absolute" },
  { label: "Scaled", value: "scaled" },
];

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
  | FunnelExplorationBlockInterface
>;

const dashboardGlobalControlSupportedBlockTypes = new Set<DashboardBlockType>([
  "metric-exploration",
  "fact-table-exploration",
  "data-source-exploration",
  "funnel-exploration",
]);

export function getTemporaryDashboardBlockId(index: number): string {
  return `tmp:${index}`;
}

export function isDashboardGlobalControlSupportedBlock(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
): block is DashboardGlobalControlSupportedBlock {
  return dashboardGlobalControlSupportedBlockTypes.has(block.type);
}

// The set of dashboard-wide global filters. `dateRange` drives exploration
// blocks and the experiment blocks that support it; the rest drive experiment
// blocks only.
export const DASHBOARD_GLOBAL_FILTER_KEYS = [
  "dateRange",
  "projects",
  "metricId",
  "experimentSearchString",
] as const;
export type DashboardGlobalFilterKey =
  (typeof DASHBOARD_GLOBAL_FILTER_KEYS)[number];

type DashboardExperimentBlock = DashboardBlockInterfaceOrData<
  | MetricExperimentsBlockInterface
  | ExperimentsScaledImpactBlockInterface
  | ExperimentsWinRateBlockInterface
  | ExperimentsStatusBlockInterface
>;

// Which global filters each experiment block type honors. Experiments with Lift
// (metric-experiments) intentionally omits `dateRange` — it has its own separate
// phase start/end date windows, so the dashboard Date Range filter does not
// drive it. Win Percentage and Team Velocity omit `metricId` (no metric field).
const EXPERIMENT_BLOCK_FILTER_SUPPORT: Partial<
  Record<DashboardBlockType, readonly DashboardGlobalFilterKey[]>
> = {
  "metric-experiments": ["projects", "metricId", "experimentSearchString"],
  "experiments-scaled-impact": [
    "dateRange",
    "projects",
    "metricId",
    "experimentSearchString",
  ],
  "experiments-win-rate": ["dateRange", "projects", "experimentSearchString"],
  "experiments-status": ["dateRange", "projects", "experimentSearchString"],
};

export function isDashboardExperimentBlock(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
): block is DashboardExperimentBlock {
  return block.type in EXPERIMENT_BLOCK_FILTER_SUPPORT;
}

type GlobalControlSettings = NonNullable<
  DashboardExperimentBlock["globalControlSettings"]
>;

// Safe accessor for the optional per-block opt-in settings, which only exist on
// exploration and experiment blocks.
function getBlockGlobalControlSettings(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
): GlobalControlSettings | undefined {
  return "globalControlSettings" in block
    ? block.globalControlSettings
    : undefined;
}

export function experimentBlockSupportsGlobalFilter(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  key: DashboardGlobalFilterKey,
): boolean {
  return (EXPERIMENT_BLOCK_FILTER_SUPPORT[block.type] ?? []).includes(key);
}

// The dashboard-wide filters this block supports AND that the dashboard
// currently has an active value for. These are the filters a single
// "Use dashboard experiment filters" toggle governs for the block.
export function getActiveExperimentGlobalFilterKeys(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  globalControls: DashboardInterface["globalControls"] | undefined,
): DashboardGlobalFilterKey[] {
  return DASHBOARD_GLOBAL_FILTER_KEYS.filter(
    (key) =>
      experimentBlockSupportsGlobalFilter(block, key) &&
      globalFilterIsSet(globalControls, key),
  );
}

// Whether the single "Use dashboard experiment filters" toggle should be shown:
// the dashboard exposes at least one active filter this block supports.
export function experimentBlockHasActiveGlobalFilters(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  globalControls: DashboardInterface["globalControls"] | undefined,
): boolean {
  return getActiveExperimentGlobalFilterKeys(block, globalControls).length > 0;
}

// The single-toggle state: the block follows the dashboard when it has opted in
// to every active dashboard filter it supports. Returns false when the dashboard
// has no active filters for this block (nothing to follow).
export function experimentBlockFollowsGlobalFilters(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  globalControls: DashboardInterface["globalControls"] | undefined,
): boolean {
  const keys = getActiveExperimentGlobalFilterKeys(block, globalControls);
  if (keys.length === 0) return false;
  const settings = getBlockGlobalControlSettings(block);
  return keys.every((key) => settings?.[key] === true);
}

// Badge condition: the dashboard exposes filters this block supports, but the
// block has opted out of following them (so it uses its own local filters).
export function experimentBlockOptedOutOfGlobalFilters(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  globalControls: DashboardInterface["globalControls"] | undefined,
): boolean {
  return (
    experimentBlockHasActiveGlobalFilters(block, globalControls) &&
    !experimentBlockFollowsGlobalFilters(block, globalControls)
  );
}

// Compute the block's next per-filter opt-in settings when the single
// "Use dashboard experiment filters" toggle is flipped: every active supported
// filter is set to `enabled`, leaving any unrelated stored flags untouched.
export function setExperimentBlockGlobalFilterFollowing(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  globalControls: DashboardInterface["globalControls"] | undefined,
  enabled: boolean,
): GlobalControlSettings {
  const keys = getActiveExperimentGlobalFilterKeys(block, globalControls);
  const settings: GlobalControlSettings = {
    ...(getBlockGlobalControlSettings(block) ?? {}),
  };
  keys.forEach((key) => {
    settings[key] = enabled;
  });
  return settings;
}

// Any block (exploration or experiment) that can follow the given global filter.
// Exploration blocks only support the date range control.
export function blockSupportsGlobalFilter(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  key: DashboardGlobalFilterKey,
): boolean {
  if (key === "dateRange" && isDashboardGlobalControlSupportedBlock(block)) {
    return true;
  }
  return experimentBlockSupportsGlobalFilter(block, key);
}

// True when the block both supports the filter and has opted in.
export function blockUsesGlobalFilter(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  key: DashboardGlobalFilterKey,
): boolean {
  return (
    blockSupportsGlobalFilter(block, key) &&
    getBlockGlobalControlSettings(block)?.[key] === true
  );
}

// Enroll every block that supports `key` and hasn't yet made a choice
// (undefined). Blocks that were explicitly opted out (`false`) or in (`true`)
// are left untouched, so this is safe to call on every persist.
export function autoEnrollDashboardBlocksInGlobalFilter<
  T extends DashboardBlockInterfaceOrData<DashboardBlockInterface>,
>(blocks: T[], key: DashboardGlobalFilterKey): T[] {
  return blocks.map((block) => {
    if (!blockSupportsGlobalFilter(block, key)) return block;
    const settings = getBlockGlobalControlSettings(block);
    if (settings?.[key] !== undefined) return block;
    return {
      ...block,
      globalControlSettings: { ...settings, [key]: true },
    } as T;
  });
}

export function autoEnrollDashboardBlocksInDateControl<
  T extends DashboardBlockInterfaceOrData<DashboardBlockInterface>,
>(blocks: T[]): T[] {
  return autoEnrollDashboardBlocksInGlobalFilter(blocks, "dateRange");
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

// Whether a given global filter is currently active (has a usable value).
export function globalFilterIsSet(
  globalControls: DashboardInterface["globalControls"] | undefined,
  key: DashboardGlobalFilterKey,
): boolean {
  if (!globalControls) return false;
  const value = globalControls[key];
  switch (key) {
    case "dateRange":
      return Boolean(value);
    case "projects":
      return Array.isArray(value) && value.length > 0;
    case "metricId":
    case "experimentSearchString":
      return typeof value === "string" && value.length > 0;
    default:
      return false;
  }
}

/**
 * True when a save transitions a global filter from "off" to "on" — the moment
 * we auto-enroll supported blocks.
 */
export function isEnablingGlobalFilter(
  existingGlobalControls: DashboardInterface["globalControls"] | undefined,
  nextGlobalControls: DashboardInterface["globalControls"] | undefined,
  key: DashboardGlobalFilterKey,
): boolean {
  return (
    !globalFilterIsSet(existingGlobalControls, key) &&
    globalFilterIsSet(nextGlobalControls, key)
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
  return isEnablingGlobalFilter(
    existingGlobalControls,
    nextGlobalControls,
    "dateRange",
  );
}

/**
 * Resolves the blocks to persist when global controls change, applying
 * first-enable auto-enrollment consistently across the internal controller and
 * the REST API model. Runs for every global filter (date range, projects,
 * metric, experiment search) that this save newly enables.
 *
 * - When `nextBlocks` is provided (create, or update whose payload includes
 *   blocks), returns those blocks, auto-enrolled for any newly enabled filter.
 * - When `nextBlocks` is omitted (update without a blocks payload), returns
 *   auto-enrolled `existingBlocks` only if this save enables at least one
 *   filter, otherwise `undefined` to signal "leave blocks untouched".
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
  const newlyEnabledKeys = DASHBOARD_GLOBAL_FILTER_KEYS.filter((key) =>
    isEnablingGlobalFilter(existingGlobalControls, nextGlobalControls, key),
  );

  const enroll = (blocks: T[]): T[] =>
    newlyEnabledKeys.reduce(
      (acc, key) => autoEnrollDashboardBlocksInGlobalFilter(acc, key),
      blocks,
    );

  if (nextBlocks) {
    return newlyEnabledKeys.length ? enroll(nextBlocks) : nextBlocks;
  }

  if (newlyEnabledKeys.length && existingBlocks) {
    return enroll(existingBlocks);
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
  | DataSourceExplorationConfig
  | FunnelExplorationConfig;

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
 * Overlays the dashboard's global filters onto an experiment block, honoring
 * each block's per-filter opt-in. Returns a block with `projects` / `metricId` /
 * `experimentSearchString` / `dateRange` (and, for Team Velocity,
 * `dateGranularity`) replaced by the dashboard values where the block has opted
 * in. Render code uses the result exactly as it would the stored block, so the
 * stored block is never mutated (edit flows keep the local values).
 *
 * Experiments with Lift is never date-controlled (it has its own separate phase
 * start/end windows), which falls out of EXPERIMENT_BLOCK_FILTER_SUPPORT.
 */
export function getEffectiveExperimentBlock<T extends DashboardExperimentBlock>(
  block: T,
  dashboard: Pick<DashboardInterface, "globalControls">,
): T {
  const globalControls = dashboard.globalControls;
  if (!globalControls) return block;

  const overrides: Record<string, unknown> = {};

  if (
    blockUsesGlobalFilter(block, "projects") &&
    globalFilterIsSet(globalControls, "projects")
  ) {
    overrides.projects = globalControls.projects;
  }
  if (
    blockUsesGlobalFilter(block, "metricId") &&
    globalFilterIsSet(globalControls, "metricId")
  ) {
    overrides.metricId = globalControls.metricId;
  }
  if (
    blockUsesGlobalFilter(block, "experimentSearchString") &&
    globalFilterIsSet(globalControls, "experimentSearchString")
  ) {
    overrides.experimentSearchString = globalControls.experimentSearchString;
  }
  if (
    blockUsesGlobalFilter(block, "dateRange") &&
    globalFilterIsSet(globalControls, "dateRange")
  ) {
    overrides.dateRange = globalControls.dateRange;
    // Granularity follows the date-range opt-in and only affects Team Velocity.
    if (block.type === "experiments-status" && globalControls.dateGranularity) {
      overrides.dateGranularity = globalControls.dateGranularity;
    }
  }

  if (Object.keys(overrides).length === 0) return block;
  return { ...block, ...overrides } as T;
}

/**
 * Which experiment-block global filter controls are relevant for the given set
 * of blocks. Drives conditional rendering of the dashboard filter bar: a control
 * is shown only when at least one present block supports it.
 */
export function getDashboardExperimentFilterApplicability(
  blocks: readonly DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
): {
  hasExperimentBlocks: boolean;
  showDateRange: boolean;
  showGranularity: boolean;
  showProjects: boolean;
  showMetric: boolean;
  showExperimentSearch: boolean;
  // Experiments with Lift ignores the dashboard Date Range filter; the bar
  // surfaces this caveat when such a block is present.
  hasDateExcludedBlock: boolean;
} {
  const experimentBlocks = blocks.filter(isDashboardExperimentBlock);
  const supports = (key: DashboardGlobalFilterKey) =>
    experimentBlocks.some((block) =>
      experimentBlockSupportsGlobalFilter(block, key),
    );
  return {
    hasExperimentBlocks: experimentBlocks.length > 0,
    showDateRange: supports("dateRange"),
    showGranularity: experimentBlocks.some(
      (block) => block.type === "experiments-status",
    ),
    showProjects: supports("projects"),
    showMetric: supports("metricId"),
    showExperimentSearch: supports("experimentSearchString"),
    hasDateExcludedBlock: experimentBlocks.some(
      (block) => block.type === "metric-experiments",
    ),
  };
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
  blocks: readonly DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
}): {
  supportedBlocks: DashboardGlobalControlSupportedBlock[];
  unsupportedBlocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  dateControlledBlocks: DashboardGlobalControlSupportedBlock[];
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

  return {
    supportedBlocks,
    unsupportedBlocks,
    dateControlledBlocks,
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
  const affectedBlocks = new Set(applicability.dateControlledBlocks);
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
  "metric-experiments": ({ initialValues }) => ({
    type: "metric-experiments",
    title: "",
    description: "",
    metricId: "",
    projects: [],
    experimentSearchString: "",
    differenceType: "relative",
    bandits: false,
    ...(initialValues || {}),
  }),
  "experiments-scaled-impact": ({ initialValues }) => ({
    type: "experiments-scaled-impact",
    title: "Scaled Impact",
    description: "",
    dateRange: { predefined: "last90Days" },
    projects: [],
    experimentSearchString: "",
    metricId: "",
    ...(initialValues || {}),
  }),
  "experiments-win-rate": ({ initialValues }) => ({
    type: "experiments-win-rate",
    title: "Win Percentage",
    description: "",
    dateRange: { predefined: "last90Days" },
    projects: [],
    experimentSearchString: "",
    showProjectBreakdown: true,
    comparison: { enabled: false },
    ...(initialValues || {}),
  }),
  "experiments-status": ({ initialValues }) => ({
    type: "experiments-status",
    title: "Team Velocity",
    description: "",
    dateRange: { predefined: "last90Days" },
    projects: [],
    experimentSearchString: "",
    dateGranularity: "auto",
    comparison: { enabled: false },
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
  "funnel-exploration": ({ initialValues }) => ({
    type: "funnel-exploration",
    title: "",
    description: "",
    explorerAnalysisId: "",
    config:
      initialValues?.config ??
      (getInitialConfigByBlockType(
        "funnel-exploration",
        initialValues?.config?.datasource ?? "",
      ) as FunnelExplorationConfig),
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
