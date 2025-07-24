import {
  DashboardBlockInterface,
  DimensionBlockInterface,
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
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";
import { DashboardTemplateInterface } from "back-end/src/enterprise/validators/dashboard-template";
import { isNumber, isString } from "back-end/src/util/types";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { expandMetricGroups } from "../../experiments";

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
): value is DimensionBlockInterface["differenceType"] {
  return ["absolute", "relative", "scaled"].includes(value);
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
): Partial<ExperimentSnapshotSettings> {
  const blockSettings: Partial<ExperimentSnapshotSettings> = {};
  if (
    blockHasFieldOfType(block, "dimensionId", isString) &&
    block.dimensionId.length > 0
  ) {
    blockSettings.dimensions = [{ id: block.dimensionId }];
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
  "metadata-description": ({ initialValues, experiment }) => ({
    type: "metadata-description",
    title: "Experiment Description",
    description: "",
    experimentId: experiment.id,
    ...(initialValues || {}),
  }),
  "metadata-hypothesis": ({ initialValues, experiment }) => ({
    type: "metadata-hypothesis",
    title: "Experiment Hypothesis",
    description: "",
    experimentId: experiment.id,
    ...(initialValues || {}),
  }),
  "variation-image": ({ initialValues, experiment }) => ({
    type: "variation-image",
    title: "",
    description: "",
    variationIds: [],
    experimentId: experiment.id,
    ...(initialValues || {}),
  }),
  metric: ({ initialValues, experiment, metricGroups }) => ({
    type: "metric",
    title: "",
    description: "",
    experimentId: experiment.id,
    metricIds: expandMetricGroups(experiment.goalMetrics, metricGroups),
    snapshotId: experiment.analysisSummary?.snapshotId || "",
    variationIds: [],
    differenceType: "relative",
    baselineRow: 0,
    columnsFilter: [],
    ...(initialValues || {}),
  }),
  dimension: ({ initialValues, experiment, metricGroups }) => ({
    type: "dimension",
    title: "",
    description: "",
    experimentId: experiment.id,
    metricIds: expandMetricGroups(experiment.goalMetrics, metricGroups),
    dimensionId: "",
    dimensionValues: [],
    snapshotId: experiment.analysisSummary?.snapshotId || "",
    variationIds: [],
    differenceType: "relative",
    baselineRow: 0,
    columnsFilter: [],
    ...(initialValues || {}),
  }),
  "time-series": ({ initialValues, experiment, metricGroups }) => ({
    type: "time-series",
    title: "",
    description: "",
    experimentId: experiment.id,
    metricId: expandMetricGroups(experiment.goalMetrics, metricGroups)[0] || "",
    snapshotId: experiment.analysisSummary?.snapshotId || "",
    variationIds: [],
    ...(initialValues || {}),
  }),
  "traffic-graph": ({ initialValues, experiment }) => ({
    type: "traffic-graph",
    title: "",
    description: "",
    experimentId: experiment.id,
    ...(initialValues || {}),
  }),
  "traffic-table": ({ initialValues, experiment }) => ({
    type: "traffic-table",
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
