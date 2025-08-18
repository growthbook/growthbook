import {
  DashboardBlockInterface,
  DashboardBlockData,
  DashboardBlockType,
  DashboardBlockInterfaceOrData,
  CreateDashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";
import { DashboardTemplateInterface } from "back-end/src/enterprise/validators/dashboard-template";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { isNumber, isString } from "../../util/types";
import { expandMetricGroups } from "../../experiments";
import { getSnapshotAnalysis } from "../../util";

export const differenceTypes = ["absolute", "relative", "scaled"] as const;
export interface BlockSnapshotSettings {
  dimensionId?: string;
}

export function getBlockData<T extends DashboardBlockInterface>(
  block: DashboardBlockInterfaceOrData<T>
): DashboardBlockData<T> {
  return { ...block, organization: undefined, id: undefined, uid: undefined };
}

export function isPersistedDashboardBlock<T extends DashboardBlockInterface>(
  data: DashboardBlockInterfaceOrData<T>
): data is T {
  const block = data as T;
  return !!(block.id && block.uid && block.organization);
}

export function isDifferenceType(
  value: string
): value is typeof differenceTypes[number] {
  return (differenceTypes as readonly string[]).includes(value);
}

export function blockHasFieldOfType<Field extends string, T>(
  data: DashboardBlockInterfaceOrData<DashboardBlockInterface> | undefined,
  field: Field,
  typeCheck: (val: unknown) => val is T
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
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>
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
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings
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

export function blockSnapshotSettingsMatch<
  B extends DashboardBlockInterfaceOrData<DashboardBlockInterface>
>(snapshotSettings: ExperimentSnapshotSettings, block: B) {
  const blockSettings = getBlockSnapshotSettings(block);
  // TODO: check this logic w/ Luke/Bryce
  if (!blockSettings.dimensionId)
    return snapshotSettings.dimensions.length === 0;
  snapshotSettings.dimensions.find(
    ({ id }) => id === blockSettings.dimensionId
  );
}

export function getBlockSnapshotAnalysis<
  B extends DashboardBlockInterfaceOrData<DashboardBlockInterface>
>(snapshot: ExperimentSnapshotInterface, block: B) {
  const defaultAnalysis = getSnapshotAnalysis(snapshot);
  if (!defaultAnalysis) return null;
  const blockAnalysisSettings = getBlockAnalysisSettings(
    block,
    defaultAnalysis.settings
  );
  return getSnapshotAnalysis(snapshot, blockAnalysisSettings);
}

export function dashboardCanAutoUpdate({
  blocks,
}: {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
}) {
  // Only update dashboards where all the blocks will stay up to date with each other
  return !blocks.find((block) =>
    ["sql-explorer", "dimension"].includes(block.type)
  );
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
  "experiment-description": ({ initialValues, experiment }) => ({
    type: "experiment-description",
    title: "Experiment Description",
    description: "",
    experimentId: experiment.id,
    ...(initialValues || {}),
  }),
  "experiment-hypothesis": ({ initialValues, experiment }) => ({
    type: "experiment-hypothesis",
    title: "Experiment Hypothesis",
    description: "",
    experimentId: experiment.id,
    ...(initialValues || {}),
  }),
  "experiment-variation-image": ({ initialValues, experiment }) => ({
    type: "experiment-variation-image",
    title: "",
    description: "",
    variationIds: [],
    experimentId: experiment.id,
    ...(initialValues || {}),
  }),
  "experiment-metric": ({ initialValues, experiment }) => ({
    type: "experiment-metric",
    title: "",
    description: "",
    experimentId: experiment.id,
    metricIds: experiment.goalMetrics,
    snapshotId: experiment.analysisSummary?.snapshotId || "",
    variationIds: [],
    differenceType: "relative",
    baselineRow: 0,
    columnsFilter: [],
    ...(initialValues || {}),
  }),
  "experiment-dimension": ({ initialValues, experiment }) => ({
    type: "experiment-dimension",
    title: "",
    description: "",
    experimentId: experiment.id,
    metricIds: experiment.goalMetrics,
    dimensionId: "",
    dimensionValues: [],
    snapshotId: experiment.analysisSummary?.snapshotId || "",
    variationIds: [],
    differenceType: "relative",
    baselineRow: 0,
    columnsFilter: [],
    ...(initialValues || {}),
  }),
  "experiment-time-series": ({ initialValues, experiment, metricGroups }) => ({
    type: "experiment-time-series",
    title: "",
    description: "",
    experimentId: experiment.id,
    metricId: expandMetricGroups(experiment.goalMetrics, metricGroups)[0] || "",
    snapshotId: experiment.analysisSummary?.snapshotId || "",
    variationIds: [],
    ...(initialValues || {}),
  }),
  "experiment-traffic-graph": ({ initialValues, experiment }) => ({
    type: "experiment-traffic-graph",
    title: "",
    description: "",
    experimentId: experiment.id,
    ...(initialValues || {}),
  }),
  "experiment-traffic-table": ({ initialValues, experiment }) => ({
    type: "experiment-traffic-table",
    title: "",
    description: "",
    experimentId: experiment.id,
    ...(initialValues || {}),
  }),
  "sql-explorer": ({ initialValues }) => ({
    type: "sql-explorer",
    title: "",
    description: "",
    savedQueryId: "",
    dataVizConfigIndex: -1,
    ...(initialValues || {}),
  }),
};

export function createDashboardBlocksFromTemplate(
  {
    blockInitialValues,
  }: Pick<DashboardTemplateInterface, "blockInitialValues">,
  experiment: ExperimentInterface | ExperimentInterfaceStringDates,
  metricGroups: MetricGroupInterface[]
): CreateDashboardBlockInterface[] {
  return blockInitialValues.map(({ type, ...initialValues }) =>
    CREATE_BLOCK_TYPE[type]({ initialValues, experiment, metricGroups })
  );
}
