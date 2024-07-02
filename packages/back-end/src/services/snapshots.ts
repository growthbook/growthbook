import { orgHasPremiumFeature } from "enterprise";
import { hoursBetween } from "shared/dates";
import { MetricPriorSettings } from "@back-end/types/fact-table";
import { promiseAllChunks } from "../util/promise";
import { updateExperiment } from "../models/ExperimentModel";

export async function getManualSnapshotData(
  experiment: ExperimentInterface,
  snapshotSettings: ExperimentSnapshotSettings,
  analysisSettings: ExperimentSnapshotAnalysisSettings,
  phaseIndex: number,
  users: number[],
  metrics: {
    [key: string]: MetricStats[];
  },
  metricMap: Map<string, ExperimentMetricInterface>
) {
  const phase = experiment.phases[phaseIndex];

  // Default variation values, override from SQL results if available
  const variations: SnapshotVariation[] = experiment.variations.map((v, i) => ({
    users: users[i],
    metrics: {},
  }));

  const metricSettings: Record<string, MetricSettingsForStatsEngine> = {};
  const queryResults: QueryResultsForStatsEngine[] = [];
  Object.keys(metrics).forEach((m) => {
    const stats = metrics[m];
    const metric = metricMap.get(m);
    if (!metric) return null;
    metricSettings[m] = {
      ...getMetricSettingsForStatsEngine(metric, metricMap, snapshotSettings),
      // no ratio or regression adjustment for manual snapshots
      statistic_type: "mean",
    };
    queryResults.push({
      rows: stats.map((s, i) => {
        return {
          dimension: "All",
          variation: experiment.variations[i].key || i + "",
          users: s.count,
          count: s.count,
          main_sum: s.mean * s.count,
          main_sum_squares: sumSquaresFromStats(
            s.mean * s.count,
            Math.pow(s.stddev, 2),
            s.count
          ),
        };
      }),
      metrics: [m],
    });
  });

  const result = await runSnapshotAnalysis({
    id: experiment.id,
    variations: getReportVariations(experiment, phase),
    phaseLengthHours: Math.max(
      hoursBetween(phase.dateStarted, phase.dateEnded ?? new Date()),
      1
    ),
    coverage: experiment.phases?.[phaseIndex]?.coverage ?? 1,
    analyses: [{ ...analysisSettings, regressionAdjusted: false }], // no RA for manual snapshots
    metrics: metricSettings,
    queryResults: queryResults,
  });

  result.forEach(({ metric, analyses }) => {
    const res = analyses[0];
    const data = res.dimensions[0];
    if (!data) return;
    data.variations.map((v, i) => {
      variations[i].metrics[metric] = v;
    });
  });

  const srm = checkSrm(users, phase.variationWeights);

  return {
    srm,
    variations,
  };
}

export function getDefaultExperimentAnalysisSettings(
  statsEngine: StatsEngine,
  experiment: ExperimentInterface,
  organization: OrganizationInterface,
  regressionAdjustmentEnabled?: boolean,
  dimension?: string
): ExperimentSnapshotAnalysisSettings {
  const hasRegressionAdjustmentFeature = organization
    ? orgHasPremiumFeature(organization, "regression-adjustment")
    : false;
  const hasSequentialTestingFeature = organization
    ? orgHasPremiumFeature(organization, "sequential-testing")
    : false;
  return {
    statsEngine,
    dimensions: dimension ? [dimension] : [],
    regressionAdjusted:
      hasRegressionAdjustmentFeature &&
      (regressionAdjustmentEnabled !== undefined
        ? regressionAdjustmentEnabled
        : organization.settings?.regressionAdjustmentEnabled ?? false),
    sequentialTesting:
      hasSequentialTestingFeature &&
      statsEngine === "frequentist" &&
      (experiment?.sequentialTestingEnabled ??
        !!organization.settings?.sequentialTestingEnabled),
    sequentialTestingTuningParameter:
      experiment?.sequentialTestingTuningParameter ??
      organization.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    baselineVariationIndex: 0,
    differenceType: "relative",
    pValueThreshold:
      organization.settings?.pValueThreshold ?? DEFAULT_P_VALUE_THRESHOLD,
  };
}

export function getAdditionalExperimentAnalysisSettings(
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings
): ExperimentSnapshotAnalysisSettings[] {
  const additionalAnalyses: ExperimentSnapshotAnalysisSettings[] = [];

  // for default baseline, get difference types
  additionalAnalyses.push({
    ...defaultAnalysisSettings,
    differenceType: "absolute",
  });
  additionalAnalyses.push({
    ...defaultAnalysisSettings,
    differenceType: "scaled",
  });

  return additionalAnalyses;
}

export function getSnapshotSettings({
  experiment,
  phaseIndex,
  settings,
  orgPriorSettings,
  settingsForSnapshotMetrics,
  metricMap,
}: {
  experiment: ExperimentInterface;
  phaseIndex: number;
  settings: ExperimentSnapshotAnalysisSettings;
  orgPriorSettings: MetricPriorSettings | undefined;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
}): ExperimentSnapshotSettings {
  const phase = experiment.phases[phaseIndex];
  if (!phase) {
    throw new Error("Invalid snapshot phase");
  }

  const defaultPriorSettings = orgPriorSettings ?? {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };
  const metricSettings = [
    // Combine goals, guardrails, and activation metric and de-dupe the list
    ...new Set([
      ...experiment.metrics,
      ...(experiment.guardrails || []),
      ...(experiment.activationMetric ? [experiment.activationMetric] : []),
    ]),
  ]
    .map((m) =>
      getMetricForSnapshot(
        m,
        metricMap,
        settingsForSnapshotMetrics,
        experiment.metricOverrides
      )
    )
    .filter(isDefined);

  return {
    manual: !experiment.datasource,
    activationMetric: experiment.activationMetric || null,
    attributionModel: experiment.attributionModel || "firstExposure",
    skipPartialData: !!experiment.skipPartialData,
    segment: experiment.segment || "",
    queryFilter: experiment.queryFilter || "",
    datasourceId: experiment.datasource || "",
    dimensions: settings.dimensions.map((id) => ({ id })),
    startDate: phase.dateStarted,
    endDate: phase.dateEnded || new Date(),
    experimentId: experiment.trackingKey || experiment.id,
    goalMetrics: experiment.metrics,
    guardrailMetrics: experiment.guardrails || [],
    regressionAdjustmentEnabled: !!settings.regressionAdjusted,
    defaultMetricPriorSettings: defaultPriorSettings,
    exposureQueryId: experiment.exposureQueryId,
    metricSettings: metricSettings,
    variations: experiment.variations.map((v, i) => ({
      id: v.key || i + "",
      weight: phase.variationWeights[i] || 0,
    })),
    coverage: phase.coverage ?? 1,
  };
}

export async function createManualSnapshot({
  experiment,
  phaseIndex,
  users,
  metrics,
  orgPriorSettings,
  analysisSettings,
  metricMap,
  context,
}: {
  experiment: ExperimentInterface;
  phaseIndex: number;
  users: number[];
  metrics: {
    [key: string]: MetricStats[];
  };
  orgPriorSettings: MetricPriorSettings | undefined;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  context: Context;
}) {
  const snapshotSettings = getSnapshotSettings({
    experiment,
    phaseIndex,
    orgPriorSettings: orgPriorSettings,
    settings: analysisSettings,
    settingsForSnapshotMetrics: [],
    metricMap,
  });

  const { srm, variations } = await getManualSnapshotData(
    experiment,
    snapshotSettings,
    analysisSettings,
    phaseIndex,
    users,
    metrics,
    metricMap
  );

  const data: ExperimentSnapshotInterface = {
    id: uniqid("snp_"),
    organization: experiment.organization,
    experiment: experiment.id,
    dimension: null,
    phase: phaseIndex,
    queries: [],
    runStarted: new Date(),
    dateCreated: new Date(),
    status: "success",
    settings: snapshotSettings,
    unknownVariations: [],
    multipleExposures: 0,
    analyses: [
      {
        dateCreated: new Date(),
        status: "success",
        settings: analysisSettings,
        results: [
          {
            name: "All",
            srm,
            variations,
          },
        ],
      },
    ],
  };

  const snapshot = await createExperimentSnapshotModel({ data, context });

  return snapshot;
}

export async function createSnapshot({
  experiment,
  context,
  phaseIndex,
  useCache = false,
  defaultAnalysisSettings,
  additionalAnalysisSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
}: {
  experiment: ExperimentInterface;
  context: ReqContext | ApiReqContext;
  phaseIndex: number;
  useCache?: boolean;
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings;
  additionalAnalysisSettings: ExperimentSnapshotAnalysisSettings[];
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
}): Promise<ExperimentResultsQueryRunner> {
  const { org: organization } = context;
  const dimension = defaultAnalysisSettings.dimensions[0] || null;

  const snapshotSettings = getSnapshotSettings({
    experiment,
    phaseIndex,
    orgPriorSettings: organization.settings?.metricDefaults?.priorSettings,
    settings: defaultAnalysisSettings,
    settingsForSnapshotMetrics,
    metricMap,
  });

  const data: ExperimentSnapshotInterface = {
    id: uniqid("snp_"),
    organization: experiment.organization,
    experiment: experiment.id,
    runStarted: new Date(),
    error: "",
    dateCreated: new Date(),
    phase: phaseIndex,
    queries: [],
    dimension: dimension || null,
    settings: snapshotSettings,
    unknownVariations: [],
    multipleExposures: 0,
    analyses: [
      {
        dateCreated: new Date(),
        results: [],
        settings: defaultAnalysisSettings,
        status: "running",
      },
      ...additionalAnalysisSettings
        .filter((a) => isAnalysisAllowed(snapshotSettings, a))
        .map((a) => {
          const analysis: ExperimentSnapshotAnalysis = {
            dateCreated: new Date(),
            results: [],
            settings: a,
            status: "running",
          };
          return analysis;
        }),
    ],
    status: "running",
  };

  const nextUpdate =
    determineNextDate(organization.settings?.updateSchedule || null) ||
    undefined;

  await updateExperiment({
    context,
    experiment,
    changes: {
      lastSnapshotAttempt: new Date(),
      nextSnapshotAttempt: nextUpdate,
      autoSnapshots: nextUpdate !== null,
    },
  });

  const snapshot = await createExperimentSnapshotModel({ data, context });

  const integration = await getIntegrationFromDatasourceId(
    context,
    experiment.datasource,
    true
  );

  const queryRunner = new ExperimentResultsQueryRunner(
    context,
    snapshot,
    integration,
    useCache
  );
  await queryRunner.startAnalysis({
    snapshotSettings: data.settings,
    variationNames: experiment.variations.map((v) => v.name),
    metricMap,
    queryParentId: snapshot.id,
    factTableMap,
  });

  return queryRunner;
}

export type SnapshotAnalysisParams = {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  snapshot: ExperimentSnapshotInterface;
};

async function getSnapshotAnalyses(
  params: SnapshotAnalysisParams[],
  context: ReqContext
) {
  const analysisParamsMap = new Map<
    string,
    ExperimentAnalysisParamsContextData
  >();

  // get queryMap for all snapshots
  const queryMap = await getQueryMap(
    context.org.id,
    params.map((p) => p.snapshot.queries).flat()
  );

  const createAnalysisPromises: (() => Promise<void>)[] = [];
  params.forEach(
    (
      { experiment, organization, analysisSettings, metricMap, snapshot },
      i
    ) => {
      // check if analysis is possible
      if (!isAnalysisAllowed(snapshot.settings, analysisSettings)) {
        throw new Error("Analysis not allowed with this snapshot");
      }

      const totalQueries = snapshot.queries.length;
      const failedQueries = snapshot.queries.filter(
        (q) => q.status === "failed"
      );
      const runningQueries = snapshot.queries.filter(
        (q) => q.status === "running"
      );

      if (
        runningQueries.length > 0 ||
        failedQueries.length >= totalQueries / 2
      ) {
        throw new Error("Snapshot queries not available for analysis");
      }
      const analysis: ExperimentSnapshotAnalysis = {
        results: [],
        status: "running",
        settings: analysisSettings,
        dateCreated: new Date(),
      };

      // promise to add analysis to mongo record if it does not exist, overwrite if it does
      createAnalysisPromises.push(() =>
        addOrUpdateSnapshotAnalysis({
          organization: organization.id,
          id: snapshot.id,
          analysis,
          context,
        })
      );

      const mdat = getMetricsAndQueryDataForStatsEngine(
        queryMap,
        metricMap,
        snapshot.settings
      );
      const id = `${i}_${experiment.id}_${snapshot.id}`;
      const variationNames = experiment.variations.map((v) => v.name);
      const { queryResults, metricSettings, unknownVariations } = mdat;

      analysisParamsMap.set(id, {
        params: {
          id,
          coverage: snapshot.settings.coverage ?? 1,
          phaseLengthHours: Math.max(
            hoursBetween(
              snapshot.settings.startDate,
              snapshot.settings.endDate
            ),
            1
          ),
          variations: snapshot.settings.variations.map((v, i) => ({
            ...v,
            name: variationNames[i] || v.id,
          })),
          analyses: [analysisSettings],
          queryResults: queryResults,
          metrics: metricSettings,
        },
        context: {
          // extra settings for multiple experiment approach
          snapshotSettings: snapshot.settings,
          organization: organization.id,
          snapshot: snapshot.id,
        },
        data: {
          unknownVariations: unknownVariations,
          analysisObj: analysis,
        },
      });
    }
  );

  // write running snapshots to db
  if (createAnalysisPromises.length > 0) {
    await promiseAllChunks(createAnalysisPromises, 10);
  }

  return analysisParamsMap;
}

export async function createSnapshotAnalyses(
  params: SnapshotAnalysisParams[],
  context: ReqContext
): Promise<void> {
  // creates snapshot analyses in mongo and gets analysis parameters
  const analysisParamsMap = await getSnapshotAnalyses(params, context);

  // calls stats engine to run analyses
  const results = await runSnapshotAnalyses(
    Array.from(analysisParamsMap.values()).map((v) => v.params)
  );

  // parses results and writes to mongo
  await writeSnapshotAnalyses(results, analysisParamsMap, context);
}

export async function createSnapshotAnalysis(
  params: SnapshotAnalysisParams,
  context: Context
): Promise<void> {
  const {
    snapshot,
    analysisSettings,
    organization,
    experiment,
    metricMap,
  } = params;
  // check if analysis is possible
  if (!isAnalysisAllowed(snapshot.settings, analysisSettings)) {
    throw new Error("Analysis not allowed with this snapshot");
  }

  const totalQueries = snapshot.queries.length;
  const failedQueries = snapshot.queries.filter((q) => q.status === "failed");
  const runningQueries = snapshot.queries.filter((q) => q.status === "running");

  if (runningQueries.length > 0 || failedQueries.length >= totalQueries / 2) {
    throw new Error("Snapshot queries not available for analysis");
  }
  const analysis: ExperimentSnapshotAnalysis = {
    results: [],
    status: "running",
    settings: analysisSettings,
    dateCreated: new Date(),
  };
  // and analysis to mongo record if it does not exist, overwrite if it does
  addOrUpdateSnapshotAnalysis({
    organization: organization.id,
    id: snapshot.id,
    analysis,
    context,
  });

  // Format data correctly
  const queryMap: QueryMap = await getQueryMap(
    organization.id,
    snapshot.queries
  );

  // Run the analysis
  const results = await analyzeExperimentResults({
    queryData: queryMap,
    snapshotSettings: snapshot.settings,
    analysisSettings: [analysisSettings],
    variationNames: experiment.variations.map((v) => v.name),
    metricMap: metricMap,
  });
  analysis.results = results[0]?.dimensions || [];
  analysis.status = "success";
  analysis.error = undefined;

  updateSnapshotAnalysis({
    organization: organization.id,
    id: snapshot.id,
    analysis,
    context,
  });
}
