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
  getAllExpandedMetricIdsFromExperiment,
  getAllMetricSettingsForSnapshot,
  expandMetricGroups,
  generateSliceString,
  expandAllSliceMetricsInMap,
  parseSliceMetricId,
  SliceLevelsData,
} from "shared/experiments";
import { isDefined } from "shared/util";
import uniqid from "uniqid";
import { differenceInMinutes } from "date-fns";
import { getScopedSettings } from "shared/settings";
import uniq from "lodash/uniq";
import { pick, omit } from "lodash";
import {
  LegacyExperimentReportArgs,
  ExperimentReportVariation,
  ExperimentSnapshotReportInterface,
  MetricSnapshotSettings,
  ExperimentReportSSRData,
} from "shared/types/report";
import {
  ExperimentDecisionFrameworkSettings,
  ExperimentInterface,
  ExperimentPhase,
  MetricOverride,
} from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import { OrganizationSettings } from "shared/types/organization";
import { MetricInterface } from "shared/types/metric";
import {
  ConversionWindowUnit,
  MetricPriorSettings,
  MetricWindowSettings,
  FactTableInterface,
  ColumnInterface,
} from "shared/types/fact-table";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { DataSourceInterface } from "shared/types/datasource";
import { ProjectInterface } from "shared/types/project";
import { accountFeatures, CommercialFeature } from "shared/enterprise";
import { getMetricsByIds } from "back-end/src/models/MetricModel";
import { ReqContext } from "back-end/types/request";
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
  getAdditionalQueryMetadataForExperiment,
  getDefaultExperimentAnalysisSettings,
  isJoinableMetric,
} from "back-end/src/services/experiments";
import { ReqContextClass } from "back-end/src/services/context";
import { findDimensionsByOrganization } from "back-end/src/models/DimensionModel";
import { getEffectiveAccountPlan } from "back-end/src/enterprise";

export function getReportVariations(
  experiment: ExperimentInterface,
  phase: ExperimentPhase,
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
  analysisSettings: ExperimentSnapshotAnalysisSettings,
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
  analysisSettings: ExperimentSnapshotAnalysisSettings,
): LegacyExperimentReportArgs {
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
      analysisSettings,
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
  args: LegacyExperimentReportArgs,
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: args.dimension ? [args.dimension] : [],
    statsEngine: args.statsEngine || DEFAULT_STATS_ENGINE,
    regressionAdjusted: args.regressionAdjustmentEnabled,
    // legacy report args do not support post stratification
    postStratificationEnabled: false,
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
  args: LegacyExperimentReportArgs,
  metricMap: Map<string, ExperimentMetricInterface>,
  factTableMap?: FactTableMap,
  experiment?: ExperimentInterface,
  metricGroups: MetricGroupInterface[] = [],
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

  // Expand slice metrics if factTableMap is provided
  if (factTableMap) {
    // Expand all slice metrics (auto and custom) and add them to the metricMap
    expandAllSliceMetricsInMap({
      metricMap,
      factTableMap,
      experiment: experiment ?? args,
      metricGroups,
    });
  }

  const snapshotSettings: ExperimentSnapshotSettings = {
    metricSettings: getAllExpandedMetricIdsFromExperiment({
      exp: args,
      expandedMetricMap: metricMap,
      includeActivationMetric: true,
      metricGroups: [],
    })
      .map((m) =>
        getMetricForSnapshot({
          id: m,
          metricMap,
          settingsForSnapshotMetrics: args.settingsForSnapshotMetrics,
          metricOverrides: args.metricOverrides,
          decisionFrameworkSettings: args.decisionFrameworkSettings,
        }),
      )
      .filter(isDefined),
    activationMetric: args.activationMetric || null,
    attributionModel: args.attributionModel || "firstExposure",
    datasourceId: args.datasource,
    startDate: args.startDate,
    endDate: args.endDate || new Date(),
    experimentId: args.trackingKey,
    exposureQueryId: args.exposureQueryId,
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

function convertWindowValueToHours(
  windowValue: number,
  windowUnit: ConversionWindowUnit,
) {
  switch (windowUnit) {
    case "hours":
      return windowValue;
    case "days":
      return windowValue * 24;
    case "weeks":
      return windowValue * 24 * 7;
    case "minutes":
      return windowValue / 60;
  }
}

function generateWindowSettings(
  metric: ExperimentMetricInterface,
  overrides?: MetricOverride,
  phaseLookbackWindow?: { value: number; unit: ConversionWindowUnit },
): MetricWindowSettings {
  if (phaseLookbackWindow) {
    // Convert metric window value to hours if it's a lookback window. Ignore if it's a conversion window.
    const metricWindowValueInHours =
      metric.windowSettings.type === "lookback"
        ? convertWindowValueToHours(
            metric.windowSettings.windowValue,
            metric.windowSettings.windowUnit,
          )
        : 0;

    // Find the minimum window value from the metric settings and the phase lookback window
    const minWindowValueInHours =
      metricWindowValueInHours > 0
        ? Math.min(
            metricWindowValueInHours,
            convertWindowValueToHours(
              phaseLookbackWindow.value,
              phaseLookbackWindow.unit,
            ),
          )
        : convertWindowValueToHours(
            phaseLookbackWindow.value,
            phaseLookbackWindow.unit,
          );

    return {
      delayValue:
        metric.windowSettings.delayValue ?? DEFAULT_METRIC_WINDOW_DELAY_HOURS,
      delayUnit: metric.windowSettings.delayUnit ?? "hours",
      type: "lookback",
      windowUnit: "hours",
      windowValue: minWindowValueInHours,
    };
  }

  return {
    delayValue:
      overrides?.delayHours ??
      metric.windowSettings.delayValue ??
      DEFAULT_METRIC_WINDOW_DELAY_HOURS,
    delayUnit: overrides?.delayHours
      ? "hours"
      : (metric.windowSettings.delayUnit ?? "hours"),
    type:
      overrides?.windowType ??
      metric.windowSettings.type ??
      DEFAULT_METRIC_WINDOW,
    windowUnit:
      overrides?.windowHours || overrides?.windowType
        ? "hours"
        : metric.windowSettings.windowUnit,
    windowValue:
      overrides?.windowHours ??
      metric.windowSettings.windowValue ??
      DEFAULT_METRIC_WINDOW_HOURS,
  };
}

export function getMetricForSnapshot({
  id,
  metricMap,
  settingsForSnapshotMetrics,
  metricOverrides,
  decisionFrameworkSettings,
  phaseLookbackWindow,
}: {
  id: string | null | undefined;
  metricMap: Map<string, ExperimentMetricInterface>;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  metricOverrides?: MetricOverride[];
  decisionFrameworkSettings: ExperimentDecisionFrameworkSettings;
  phaseLookbackWindow?: { value: number; unit: ConversionWindowUnit };
}): MetricForSnapshot | null {
  if (!id) return null;
  const metric = metricMap.get(id);
  if (!metric) return null;

  // For slice metrics, use the base metric ID for lookups
  const { baseMetricId } = parseSliceMetricId(id);
  const overrides = metricOverrides?.find((o) => o.id === baseMetricId);

  const decisionFrameworkMetricOverride =
    decisionFrameworkSettings?.decisionFrameworkMetricOverrides?.find(
      (o) => o.id === baseMetricId,
    );
  const metricSnapshotSettings = settingsForSnapshotMetrics?.find(
    (s) => s.metric === baseMetricId,
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
      windowSettings: generateWindowSettings(
        metric,
        overrides,
        phaseLookbackWindow,
      ),
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
        decisionFrameworkMetricOverride?.targetMDE ??
        metric.targetMDE ??
        DEFAULT_TARGET_MDE,
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
        "Unable to create snapshot for report: invalid experiment",
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
    experiment?.datasource || snapshotData?.settings?.datasourceId || "",
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
  const postStratificationEnabled =
    report.experimentAnalysisSettings.postStratificationEnabled ??
    settings.postStratificationEnabled.value;

  const metricGroups = await context.models.metricGroups.getAll();

  // Expand all slice metrics (auto and custom) and add them to the metricMap
  expandAllSliceMetricsInMap({
    metricMap,
    factTableMap,
    experiment: report.experimentAnalysisSettings,
    metricGroups,
  });

  const metricIds = getAllExpandedMetricIdsFromExperiment({
    exp: report.experimentAnalysisSettings,
    expandedMetricMap: metricMap,
    includeActivationMetric: false,
    metricGroups,
  });
  const allReportMetrics = metricIds.map((m) => metricMap.get(m) || null);
  const denominatorMetricIds = uniq<string>(
    allReportMetrics
      .map((m) => m?.denominator)
      .filter((d) => d && typeof d === "string") as string[],
  );
  const denominatorMetrics = denominatorMetricIds
    .map((m) => metricMap.get(m) || null)
    .filter(isDefined) as MetricInterface[];
  const { settingsForSnapshotMetrics, regressionAdjustmentEnabled } =
    getAllMetricSettingsForSnapshot({
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

  const defaultAnalysisSettings = getDefaultExperimentAnalysisSettings({
    statsEngine,
    experiment: report.experimentAnalysisSettings,
    organization,
    regressionAdjustmentEnabled,
    postStratificationEnabled,
    dimension: report.experimentAnalysisSettings.dimension,
  });

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
    experiment,
  });

  const snapshotType = "report";
  // Fill in and sanitize the model
  snapshotData = {
    ...snapshotData,
    id: uniqid("snp_"),
    type: snapshotType,
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
    useCache,
  );
  await queryRunner.startAnalysis({
    snapshotType,
    snapshotSettings: snapshot.settings,
    variationNames: report.experimentMetadata.variations.map((v) => v.name),
    metricMap,
    queryParentId: snapshot.id,
    factTableMap,
    experimentQueryMetadata: experiment
      ? getAdditionalQueryMetadataForExperiment(experiment)
      : null,
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
  experiment,
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
  experiment?: ExperimentInterface | null;
}): ExperimentSnapshotSettings {
  const defaultPriorSettings = orgPriorSettings ?? {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };

  const queries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = queries.find(
    (q) => q.id === report.experimentAnalysisSettings.exposureQueryId,
  );

  // expand metric groups and scrub unjoinable metrics
  const goalMetrics = expandMetricGroups(
    report.experimentAnalysisSettings.goalMetrics,
    metricGroups,
  ).filter((m) =>
    isJoinableMetric({
      metricId: m,
      metricMap,
      factTableMap,
      exposureQuery,
      datasource,
    }),
  );
  const secondaryMetrics = expandMetricGroups(
    report.experimentAnalysisSettings.secondaryMetrics,
    metricGroups,
  ).filter((m) =>
    isJoinableMetric({
      metricId: m,
      metricMap,
      factTableMap,
      exposureQuery,
      datasource,
    }),
  );
  const guardrailMetrics = expandMetricGroups(
    report.experimentAnalysisSettings.guardrailMetrics,
    metricGroups,
  ).filter((m) =>
    isJoinableMetric({
      metricId: m,
      metricMap,
      factTableMap,
      exposureQuery,
      datasource,
    }),
  );

  const endDate = report.experimentAnalysisSettings.dateEnded || new Date();
  const lookbackOverride = report.experimentAnalysisSettings.lookbackOverride;
  const phaseLookbackWindow =
    lookbackOverride?.type === "window"
      ? {
          value: lookbackOverride.value,
          unit: (lookbackOverride.valueUnit ?? "hours") as ConversionWindowUnit,
        }
      : lookbackOverride?.type === "date"
        ? {
            value: Math.max(
              0,
              differenceInMinutes(endDate, lookbackOverride.value, {
                roundingMethod: "ceil",
              }),
            ),
            unit: "minutes" as ConversionWindowUnit,
          }
        : undefined;

  const metricSettings = getAllExpandedMetricIdsFromExperiment({
    exp: report.experimentAnalysisSettings,
    expandedMetricMap: metricMap,
    includeActivationMetric: true,
    metricGroups,
  })
    .map((m) =>
      getMetricForSnapshot({
        id: m,
        metricMap,
        settingsForSnapshotMetrics,
        metricOverrides: report.experimentAnalysisSettings.metricOverrides,
        decisionFrameworkSettings:
          report.experimentAnalysisSettings.decisionFrameworkSettings,
        phaseLookbackWindow,
      }),
    )
    .filter(isDefined);

  const phase = report.experimentMetadata.phases?.[phaseIndex];
  return {
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
    phase: {
      index: phaseIndex + "",
    },
    customFields: experiment?.customFields,
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
    metricGroups,
  );

  const metricIds = uniq([
    ...experimentMetricIds,
    ...(snapshot?.settings?.activationMetric
      ? [snapshot?.settings?.activationMetric]
      : []),
  ]);

  const metrics = await getMetricsByIds(
    context,
    metricIds.filter((m) => m.startsWith("met_")),
  );

  const factMetrics = await context.models.factMetrics.getByIds(
    metricIds.filter((m) => m.startsWith("fact__")),
  );

  const denominatorMetricIds = uniq(
    metrics
      .filter((m) => !!m.denominator)
      .map((m) => m.denominator)
      .filter((id) => id && !metricIds.includes(id)) as string[],
  );

  const denominatorMetrics = await getMetricsByIds(
    context,
    denominatorMetricIds,
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
    {},
  );

  let factTableIds: string[] = [];
  factMetrics.forEach((m) => {
    if (m?.numerator?.factTableId) factTableIds.push(m.numerator.factTableId);
    if (m?.denominator?.factTableId)
      factTableIds.push(m.denominator.factTableId);
  });

  factTableIds = uniq(factTableIds);

  const factTables = await getFactTablesByIds(context, factTableIds);
  const factTableMap: Record<string, FactTableInterface> = factTables.reduce(
    (map, factTable) => Object.assign(map, { [factTable.id]: factTable }),
    {},
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
    settingsKeys,
  );

  const projectObj = project
    ? (await context.models.projects.getById(project)) || undefined
    : undefined;
  const _project: ProjectInterface | undefined = projectObj
    ? (pick(projectObj, ["name", "id", "settings"]) as ProjectInterface)
    : undefined;
  const projectMap = _project?.id ? { [_project.id]: _project } : {};

  // Generate fact metric slices for fact metrics with slice analysis enabled
  const factMetricSlices: Record<
    string,
    Array<{
      id: string;
      name: string;
      description: string;
      baseMetricId: string;
      sliceLevels: SliceLevelsData[];
      allSliceLevels: string[];
    }>
  > = {};
  for (const factMetric of factMetrics) {
    if (factMetric.metricAutoSlices?.length) {
      const factTableId = factMetric.numerator.factTableId;
      const factTable = factTableId ? factTableMap[factTableId] : undefined;
      if (factTable) {
        const dimensionColumns = factTable.columns.filter(
          (col: ColumnInterface) =>
            col.isAutoSliceColumn &&
            !col.deleted &&
            factMetric.metricAutoSlices?.includes(col.column),
        );
        if (dimensionColumns.length > 0) {
          const sliceMetrics: Array<{
            id: string;
            name: string;
            description: string;
            baseMetricId: string;
            sliceLevels: SliceLevelsData[];
            allSliceLevels: string[];
          }> = [];

          dimensionColumns.forEach((col: ColumnInterface) => {
            const autoSlices = col.autoSlices || [];

            // Create a metric for each auto slice
            autoSlices.forEach((value: string) => {
              const dimensionString = generateSliceString({
                [col.column]: value,
              });
              sliceMetrics.push({
                id: `${factMetric.id}?${dimensionString}`,
                name: `${factMetric.name} (${col.name || col.column}: ${value})`,
                description: `Slice analysis of ${factMetric.name} for ${col.name || col.column} = ${value}`,
                baseMetricId: factMetric.id,
                sliceLevels: [
                  {
                    column: col.column,
                    datatype: col.datatype === "boolean" ? "boolean" : "string",
                    levels: [value],
                  },
                ],
                allSliceLevels: col.autoSlices || [],
              });
            });

            // Create an "other" metric for values not in autoSlices
            if (autoSlices.length > 0) {
              const dimensionString = generateSliceString({
                [col.column]: "",
              });
              sliceMetrics.push({
                id: `${factMetric.id}?${dimensionString}`,
                name: `${factMetric.name} (${col.name || col.column}: other)`,
                description: `Slice analysis of ${factMetric.name} for ${col.name || col.column} = other`,
                baseMetricId: factMetric.id,
                sliceLevels: [
                  {
                    column: col.column,
                    datatype: col.datatype === "boolean" ? "boolean" : "string",
                    levels: [], // Empty array for "other" slice
                  },
                ],
                allSliceLevels: col.autoSlices || [],
              });
            }
          });

          factMetricSlices[factMetric.id] = sliceMetrics;
        }
      }
    }
  }

  // Ensure we show slices if the org has access
  // For public pages, we need to check against the org and not the user
  const publicRelevantFeatures: CommercialFeature[] = ["metric-slices"];
  const allFeatures = accountFeatures[getEffectiveAccountPlan(context.org)];
  const commercialFeatures = publicRelevantFeatures.filter((f) =>
    allFeatures.has(f),
  );

  return {
    metrics: metricMap,
    metricGroups,
    factTables: factTableMap,
    factMetricSlices,
    settings: orgSettings,
    projects: projectMap,
    dimensions,
    commercialFeatures,
  };
}
