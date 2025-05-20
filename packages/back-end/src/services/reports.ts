import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_STATS_ENGINE,
  DEFAULT_TARGET_MDE,
} from "shared/constants";
import {
  isFactMetric,
  isBinomialMetric,
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  getAllMetricSettingsForSnapshot,
  expandMetricGroups,
} from "shared/experiments";
import { isDefined } from "shared/util";
import uniqid from "uniqid";
import { getScopedSettings } from "shared/settings";
import uniq from "lodash/uniq";
import { pick, omit } from "lodash";
import {
  ExperimentReportArgs,
  ExperimentReportVariation,
  ExperimentSnapshotReportInterface,
  MetricSnapshotSettings,
  ExperimentReportSSRData,
} from "back-end/types/report";
import {
  ExperimentDecisionFrameworkSettings,
  ExperimentInterface,
  ExperimentPhase,
  MetricOverride,
} from "back-end/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "back-end/types/experiment-snapshot";
import { OrganizationSettings, ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";
import {
  FactTableMap,
  getFactTablesByIds,
} from "back-end/src/models/FactTableModel";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  createExperimentSnapshotModel,
  getLatestSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import {
  getDefaultExperimentAnalysisSettings,
  isJoinableMetric,
} from "back-end/src/services/experiments";
import { MetricInterface } from "back-end/types/metric";
import { MetricPriorSettings } from "back-end/types/fact-table";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { DataSourceInterface } from "back-end/types/datasource";
import { ReqContextClass } from "back-end/src/services/context";
import { getMetricsByIds } from "back-end/src/models/MetricModel";
import { findDimensionsByOrganization } from "back-end/src/models/DimensionModel";
import { ProjectInterface } from "back-end/types/project";

export function getReportVariations(
  experiment: ExperimentInterface,
  phase: ExperimentPhase
): ExperimentReportVariation[] {
  return experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phase?.variationWeights?.[i] || 0,
    };
  });
}

export function getMetricSnapshotSettingsFromSnapshot(
  snapshotSettings: ExperimentSnapshotSettings,
  analysisSettings: ExperimentSnapshotAnalysisSettings
): MetricSnapshotSettings[] {
  return snapshotSettings.metricSettings.map((m) => {
    return {
      metric: m.id,
      properPrior: m.computedSettings?.properPrior || false,
      properPriorMean: m.computedSettings?.properPriorMean || 0,
      properPriorStdDev:
        m.computedSettings?.properPriorStdDev || DEFAULT_PROPER_PRIOR_STDDEV,
      regressionAdjustmentReason:
        m.computedSettings?.regressionAdjustmentReason || "",
      regressionAdjustmentDays:
        m.computedSettings?.regressionAdjustmentDays ||
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled:
        (analysisSettings.regressionAdjusted &&
          m.computedSettings?.regressionAdjustmentEnabled) ||
        false,
      regressionAdjustmentAvailable:
        m.computedSettings?.regressionAdjustmentAvailable ?? true,
    };
  });
}

export function reportArgsFromSnapshot(
  experiment: ExperimentInterface,
  snapshot: ExperimentSnapshotInterface,
  analysisSettings: ExperimentSnapshotAnalysisSettings
): ExperimentReportArgs {
  const phase = experiment.phases[snapshot.phase];
  if (!phase) {
    throw new Error("Unknown experiment phase");
  }
  return {
    trackingKey: snapshot.settings.experimentId || experiment.trackingKey,
    datasource: snapshot.settings.datasourceId || experiment.datasource,
    exposureQueryId: experiment.exposureQueryId,
    startDate: snapshot.settings.startDate,
    endDate: snapshot.settings.endDate,
    dimension: snapshot.dimension || undefined,
    variations: getReportVariations(experiment, phase),
    coverage: snapshot.settings.coverage,
    segment: snapshot.settings.segment,
    goalMetrics: experiment.goalMetrics,
    secondaryMetrics: experiment.secondaryMetrics,
    metricOverrides: experiment.metricOverrides,
    guardrailMetrics: experiment.guardrailMetrics,
    activationMetric: snapshot.settings.activationMetric || undefined,
    queryFilter: snapshot.settings.queryFilter,
    skipPartialData: snapshot.settings.skipPartialData,
    attributionModel: snapshot.settings.attributionModel,
    statsEngine: analysisSettings.statsEngine,
    regressionAdjustmentEnabled: analysisSettings.regressionAdjusted,
    settingsForSnapshotMetrics: getMetricSnapshotSettingsFromSnapshot(
      snapshot.settings,
      analysisSettings
    ),
    defaultMetricPriorSettings: snapshot.settings.defaultMetricPriorSettings,
    sequentialTestingEnabled: analysisSettings.sequentialTesting,
    sequentialTestingTuningParameter:
      analysisSettings.sequentialTestingTuningParameter,
    pValueThreshold: analysisSettings.pValueThreshold,
    decisionFrameworkSettings: experiment.decisionFrameworkSettings,
  };
}

export function getAnalysisSettingsFromReportArgs(
  args: ExperimentReportArgs
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: args.dimension ? [args.dimension] : [],
    statsEngine: args.statsEngine || DEFAULT_STATS_ENGINE,
    regressionAdjusted: args.regressionAdjustmentEnabled,
    pValueCorrection: null,
    sequentialTesting: args.sequentialTestingEnabled,
    sequentialTestingTuningParameter: args.sequentialTestingTuningParameter,
    pValueThreshold: args.pValueThreshold,
    differenceType: args.differenceType ?? "relative",
    baselineVariationIndex: 0,
    numGoalMetrics: args.goalMetrics.length,
  };
}
export function getSnapshotSettingsFromReportArgs(
  args: ExperimentReportArgs,
  metricMap: Map<string, ExperimentMetricInterface>
): {
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
} {
  const defaultMetricPriorSettings = args.defaultMetricPriorSettings || {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };
  const snapshotSettings: ExperimentSnapshotSettings = {
    metricSettings: getAllMetricIdsFromExperiment(args)
      .map((m) =>
        getMetricForSnapshot({
          id: m,
          metricMap,
          settingsForSnapshotMetrics: args.settingsForSnapshotMetrics,
          metricOverrides: args.metricOverrides,
          decisionFrameworkSettings: args.decisionFrameworkSettings,
        })
      )
      .filter(isDefined),
    activationMetric: args.activationMetric || null,
    attributionModel: args.attributionModel || "firstExposure",
    datasourceId: args.datasource,
    startDate: args.startDate,
    endDate: args.endDate || new Date(),
    experimentId: args.trackingKey,
    exposureQueryId: args.exposureQueryId,
    manual: false,
    segment: args.segment || "",
    queryFilter: args.queryFilter || "",
    skipPartialData: !!args.skipPartialData,
    defaultMetricPriorSettings: defaultMetricPriorSettings,
    regressionAdjustmentEnabled: !!args.regressionAdjustmentEnabled,
    goalMetrics: args.goalMetrics,
    secondaryMetrics: args.secondaryMetrics,
    guardrailMetrics: args.guardrailMetrics,
    dimensions: args.dimension ? [{ id: args.dimension }] : [],
    variations: args.variations.map((v) => ({
      id: v.id,
      weight: v.weight,
    })),
    coverage: args.coverage,
  };
  const analysisSettings = getAnalysisSettingsFromReportArgs(args);

  return { snapshotSettings, analysisSettings };
}

export function getMetricForSnapshot({
  id,
  metricMap,
  settingsForSnapshotMetrics,
  metricOverrides,
  decisionFrameworkSettings,
}: {
  id: string | null | undefined;
  metricMap: Map<string, ExperimentMetricInterface>;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  metricOverrides?: MetricOverride[];
  decisionFrameworkSettings: ExperimentDecisionFrameworkSettings;
}): MetricForSnapshot | null {
  if (!id) return null;
  const metric = metricMap.get(id);
  if (!metric) return null;
  const overrides = metricOverrides?.find((o) => o.id === id);
  const targetMDEOverride = decisionFrameworkSettings?.goalMetricTargetMDEOverrides?.find(
    (o) => o.id === id
  );
  const metricSnapshotSettings = settingsForSnapshotMetrics?.find(
    (s) => s.metric === id
  );
  return {
    id,
    settings: {
      datasource: metric.datasource,
      type: isBinomialMetric(metric) ? "binomial" : "count",
      aggregation: ("aggregation" in metric && metric.aggregation) || undefined,
      cappingSettings: metric.cappingSettings,
      denominator: (!isFactMetric(metric) && metric.denominator) || undefined,
      sql: (!isFactMetric(metric) && metric.sql) || undefined,
      userIdTypes: (!isFactMetric(metric) && metric.userIdTypes) || undefined,
    },
    computedSettings: {
      windowSettings: {
        delayValue:
          overrides?.delayHours ??
          metric.windowSettings.delayValue ??
          DEFAULT_METRIC_WINDOW_DELAY_HOURS,
        delayUnit: overrides?.delayHours
          ? "hours"
          : metric.windowSettings.delayUnit ?? "hours",
        type:
          overrides?.windowType ??
          metric.windowSettings.type ??
          DEFAULT_METRIC_WINDOW,
        windowUnit:
          overrides?.windowHours || overrides?.windowType
            ? "hours"
            : metric.windowSettings.windowUnit ?? "hours",
        windowValue:
          overrides?.windowHours ??
          metric.windowSettings.windowValue ??
          DEFAULT_METRIC_WINDOW_HOURS,
      },
      properPrior: metricSnapshotSettings?.properPrior ?? false,
      properPriorMean: metricSnapshotSettings?.properPriorMean ?? 0,
      properPriorStdDev:
        metricSnapshotSettings?.properPriorStdDev ??
        DEFAULT_PROPER_PRIOR_STDDEV,
      regressionAdjustmentDays:
        metricSnapshotSettings?.regressionAdjustmentDays ??
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled:
        metricSnapshotSettings?.regressionAdjustmentEnabled ?? false,
      regressionAdjustmentAvailable:
        metricSnapshotSettings?.regressionAdjustmentAvailable ?? true,
      regressionAdjustmentReason:
        metricSnapshotSettings?.regressionAdjustmentReason ?? "",
      targetMDE:
        targetMDEOverride?.targetMDE ?? metric.targetMDE ?? DEFAULT_TARGET_MDE,
    },
  };
}

export async function createReportSnapshot({
  report,
  previousSnapshot: snapshotData,
  context,
  useCache = false,
  metricMap,
  factTableMap,
}: {
  report: ExperimentSnapshotReportInterface;
  previousSnapshot?: ExperimentSnapshotInterface; // todo: sensible defaults if not provided
  context: ReqContext | ApiReqContext;
  useCache?: boolean;
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
}): Promise<ExperimentSnapshotInterface> {
  // todo: new query runner
  const { org: organization } = context;
  const experiment = report.experimentId
    ? await getExperimentById(context, report.experimentId)
    : null;

  // Prepare the new snapshot model...
  if (!snapshotData) {
    // This should "never" happen, but just in case the report's initial snapshot is missing...
    if (!experiment)
      throw new Error(
        "Unable to create snapshot for report: invalid experiment"
      );
    snapshotData =
      (await getLatestSnapshot({
        experiment: experiment.id,
        phase: Math.max(experiment.phases.length - 1, 0),
        type: "standard",
      })) || undefined;
    if (!snapshotData)
      throw new Error("Unable to create snapshot for report: no data");
  }

  const phaseIndex = snapshotData.phase;

  const project = experiment?.project
    ? await context.models.projects.getById(experiment.project)
    : null;
  const datasource = await getDataSourceById(
    context,
    experiment?.datasource || snapshotData?.settings?.datasourceId || ""
  );
  if (!datasource) throw new Error("Could not load data source");

  const orgSettings = organization.settings || {};
  const { settings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    experiment: experiment ?? undefined,
  });
  const statsEngine =
    report.experimentAnalysisSettings.statsEngine || settings.statsEngine.value;

  const metricGroups = await context.models.metricGroups.getAll();
  const metricIds = getAllMetricIdsFromExperiment(
    report.experimentAnalysisSettings,
    false,
    metricGroups
  );
  const allReportMetrics = metricIds.map((m) => metricMap.get(m) || null);
  const denominatorMetricIds = uniq<string>(
    allReportMetrics
      .map((m) => m?.denominator)
      .filter((d) => d && typeof d === "string") as string[]
  );
  const denominatorMetrics = denominatorMetricIds
    .map((m) => metricMap.get(m) || null)
    .filter(isDefined) as MetricInterface[];
  const {
    settingsForSnapshotMetrics,
    regressionAdjustmentEnabled,
  } = getAllMetricSettingsForSnapshot({
    allExperimentMetrics: allReportMetrics,
    denominatorMetrics,
    orgSettings,
    experimentRegressionAdjustmentEnabled:
      report.experimentAnalysisSettings.regressionAdjustmentEnabled,
    experimentMetricOverrides:
      report.experimentAnalysisSettings.metricOverrides,
    datasourceType: datasource?.type,
    hasRegressionAdjustmentFeature: true,
  });

  const defaultAnalysisSettings = getDefaultExperimentAnalysisSettings(
    statsEngine,
    report.experimentAnalysisSettings,
    organization,
    regressionAdjustmentEnabled,
    report.experimentAnalysisSettings.dimension
  );

  const analysisSettings: ExperimentSnapshotAnalysisSettings = {
    ...defaultAnalysisSettings,
    differenceType:
      report.experimentAnalysisSettings.differenceType ?? "relative",
  };

  const snapshotSettings = getReportSnapshotSettings({
    report,
    analysisSettings,
    phaseIndex,
    orgPriorSettings: organization.settings?.metricDefaults?.priorSettings,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    metricGroups,
    datasource,
  });

  // Fill in and sanitize the model
  snapshotData = {
    ...snapshotData,
    id: uniqid("snp_"),
    type: "report",
    report: report.id,
    triggeredBy: "manual",
    error: "",
    runStarted: new Date(),
    dateCreated: new Date(),
    status: "running",
    dimension: report.experimentAnalysisSettings.dimension || null,
    settings: snapshotSettings,
    queries: [],
    unknownVariations: [],
    multipleExposures: 0,
    analyses: snapshotData.analyses.map((analysis) => ({
      ...analysis,
      dateCreated: new Date(),
      results: [],
      status: "running",
      settings: {
        ...analysis.settings,
        ...analysisSettings,
      },
    })),
  };
  if (
    snapshotData?.health?.traffic &&
    !snapshotData?.health?.traffic?.dimension
  ) {
    // fix a weird corruption in the model where formerly-empty Mongoose Map comes back missing:
    snapshotData.health.traffic.dimension = {};
  }

  const snapshot = await createExperimentSnapshotModel({
    data: snapshotData,
  });

  const integration = getSourceIntegrationObject(context, datasource, true);

  const queryRunner = new ExperimentResultsQueryRunner(
    context,
    snapshot,
    integration,
    useCache
  );
  await queryRunner.startAnalysis({
    snapshotSettings: snapshot.settings,
    variationNames: report.experimentMetadata.variations.map((v) => v.name),
    metricMap,
    queryParentId: snapshot.id,
    factTableMap,
  });

  return snapshot;
}

export function getReportSnapshotSettings({
  report,
  analysisSettings,
  phaseIndex,
  orgPriorSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
  metricGroups,
  datasource,
}: {
  report: ExperimentSnapshotReportInterface;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  phaseIndex: number;
  orgPriorSettings: MetricPriorSettings | undefined;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  metricGroups: MetricGroupInterface[];
  datasource?: DataSourceInterface;
}): ExperimentSnapshotSettings {
  const defaultPriorSettings = orgPriorSettings ?? {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };

  const queries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = queries.find(
    (q) => q.id === report.experimentAnalysisSettings.exposureQueryId
  );

  // expand metric groups and scrub unjoinable metrics
  const goalMetrics = expandMetricGroups(
    report.experimentAnalysisSettings.goalMetrics,
    metricGroups
  ).filter((m) =>
    isJoinableMetric({
      metricId: m,
      metricMap,
      factTableMap,
      exposureQuery,
      datasource,
    })
  );
  const secondaryMetrics = expandMetricGroups(
    report.experimentAnalysisSettings.secondaryMetrics,
    metricGroups
  ).filter((m) =>
    isJoinableMetric({
      metricId: m,
      metricMap,
      factTableMap,
      exposureQuery,
      datasource,
    })
  );
  const guardrailMetrics = expandMetricGroups(
    report.experimentAnalysisSettings.guardrailMetrics,
    metricGroups
  ).filter((m) =>
    isJoinableMetric({
      metricId: m,
      metricMap,
      factTableMap,
      exposureQuery,
      datasource,
    })
  );

  const metricSettings = expandMetricGroups(
    getAllMetricIdsFromExperiment(
      report.experimentAnalysisSettings,
      true,
      metricGroups
    ),
    metricGroups
  )
    .map((m) =>
      getMetricForSnapshot({
        id: m,
        metricMap,
        settingsForSnapshotMetrics,
        metricOverrides: report.experimentAnalysisSettings.metricOverrides,
        decisionFrameworkSettings:
          report.experimentAnalysisSettings.decisionFrameworkSettings,
      })
    )
    .filter(isDefined);

  const phase = report.experimentMetadata.phases?.[phaseIndex];
  return {
    manual: false,
    activationMetric:
      report.experimentAnalysisSettings.activationMetric || null,
    attributionModel:
      report.experimentAnalysisSettings.attributionModel || "firstExposure",
    skipPartialData: !!report.experimentAnalysisSettings.skipPartialData,
    segment: report.experimentAnalysisSettings.segment || "",
    queryFilter: report.experimentAnalysisSettings.queryFilter || "",
    datasourceId: report.experimentAnalysisSettings.datasource || "",
    dimensions: analysisSettings.dimensions.map((id) => ({ id })),
    startDate:
      report.experimentAnalysisSettings.dateStarted ||
      phase?.dateStarted ||
      report?.dateCreated,
    endDate: report.experimentAnalysisSettings.dateEnded || new Date(),
    experimentId: report.experimentAnalysisSettings.trackingKey,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    regressionAdjustmentEnabled: !!analysisSettings.regressionAdjusted,
    defaultMetricPriorSettings: defaultPriorSettings,
    exposureQueryId: report.experimentAnalysisSettings.exposureQueryId,
    metricSettings,
    variations: report.experimentMetadata.variations.map((v, i) => ({
      id: v.key || i + "",
      weight: phase?.variationWeights?.[i] || 0,
    })),
    coverage: phase?.coverage ?? 1,
  };
}

export async function generateExperimentReportSSRData({
  context,
  organization,
  project,
  snapshot,
}: {
  context: ReqContextClass;
  organization: string;
  project?: string;
  snapshot?: ExperimentSnapshotInterface;
}): Promise<ExperimentReportSSRData> {
  const metricGroups = await context.models.metricGroups.getAll();

  const experimentMetricIds = expandMetricGroups(
    uniq([
      ...(snapshot?.settings?.goalMetrics ?? []),
      ...(snapshot?.settings?.secondaryMetrics ?? []),
      ...(snapshot?.settings?.guardrailMetrics ?? []),
    ]),
    metricGroups
  );

  const metricIds = uniq([
    ...experimentMetricIds,
    ...(snapshot?.settings?.activationMetric
      ? [snapshot?.settings?.activationMetric]
      : []),
  ]);

  const metrics = await getMetricsByIds(
    context,
    metricIds.filter((m) => m.startsWith("met_"))
  );

  const factMetrics = await context.models.factMetrics.getByIds(
    metricIds.filter((m) => m.startsWith("fact__"))
  );

  const denominatorMetricIds = uniq(
    metrics
      .filter((m) => !!m.denominator)
      .map((m) => m.denominator)
      .filter((id) => id && !metricIds.includes(id)) as string[]
  );

  const denominatorMetrics = await getMetricsByIds(
    context,
    denominatorMetricIds
  );

  const metricMap = [...metrics, ...factMetrics, ...denominatorMetrics].reduce(
    (map, metric) =>
      Object.assign(map, {
        [metric.id]: omit(metric, [
          "queries",
          "runStarted",
          "analysis",
          "analysisError",
          "table",
          "column",
          "timestampColumn",
          "conditions",
          "queryFormat",
        ]),
      }),
    {}
  );

  let factTableIds: string[] = [];
  factMetrics.forEach((m) => {
    if (m?.numerator?.factTableId) factTableIds.push(m.numerator.factTableId);
    if (m?.denominator?.factTableId)
      factTableIds.push(m.denominator.factTableId);
  });

  factTableIds = uniq(factTableIds);

  const factTables = await getFactTablesByIds(context, factTableIds);
  const factTableMap = factTables.reduce(
    (map, factTable) => Object.assign(map, { [factTable.id]: factTable }),
    {}
  );

  const allDimensions = await findDimensionsByOrganization(organization);
  const dimension = allDimensions.find((d) => d.id === snapshot?.dimension);
  const dimensions = dimension ? [dimension] : [];

  const settingsKeys = [
    "confidenceLevel",
    "metricDefaults",
    "multipleExposureMinPercent",
    "statsEngine",
    "pValueThreshold",
    "pValueCorrection",
    "regressionAdjustmentEnabled",
    "regressionAdjustmentDays",
    "srmThreshold",
    "attributionModel",
    "sequentialTestingEnabled",
    "sequentialTestingTuningParameter",
    "displayCurrency",
  ];

  const orgSettings: OrganizationSettings = pick(
    context.org.settings,
    settingsKeys
  );

  const projectObj = project
    ? (await context.models.projects.getById(project)) || undefined
    : undefined;
  const _project: ProjectInterface | undefined = projectObj
    ? (pick(projectObj, ["name", "id", "settings"]) as ProjectInterface)
    : undefined;
  const projectMap = _project?.id ? { [_project.id]: _project } : {};

  return {
    metrics: metricMap,
    metricGroups,
    factTables: factTableMap,
    settings: orgSettings,
    projects: projectMap,
    dimensions,
  };
}
