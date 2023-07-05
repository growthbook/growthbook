import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { MetricInterface } from "../../types/metric";
import {
  ExperimentReportArgs,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
  ReportInterface,
} from "../../types/report";
import { getMetricMap } from "../models/MetricModel";
import { QueryDocument } from "../models/QueryModel";
import { findSegmentById } from "../models/SegmentModel";
import { SegmentInterface } from "../../types/segment";
import { getDataSourceById } from "../models/DataSourceModel";
import {
  ExperimentInterface,
  ExperimentPhase,
  MetricOverride,
} from "../../types/experiment";
import { updateReport } from "../models/ReportModel";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "../../types/experiment-snapshot";
import { expandDenominatorMetrics } from "../util/sql";
import { OrganizationInterface } from "../../types/organization";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";
import { analyzeExperimentResults } from "./stats";
import { parseDimensionId } from "./experiments";
import { getExperimentMetric, getExperimentResults, startRun } from "./queries";
import { getSourceIntegrationObject } from "./datasource";

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

function getMetricRegressionAdjustmentStatusesFromSnapshot(
  snapshotSettings: ExperimentSnapshotSettings,
  analysisSettings: ExperimentSnapshotAnalysisSettings
): MetricRegressionAdjustmentStatus[] {
  return snapshotSettings.metricSettings.map((m) => {
    return {
      metric: m.id,
      reason: m.computedSettings?.regressionAdjustmentReason || "",
      regressionAdjustmentDays:
        m.computedSettings?.regressionAdjustmentDays ||
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled:
        (analysisSettings.regressionAdjusted &&
          m.computedSettings?.regressionAdjustmentEnabled) ||
        false,
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
    segment: snapshot.settings.segment,
    metrics: experiment.metrics,
    metricOverrides: experiment.metricOverrides,
    guardrails: experiment.guardrails,
    activationMetric: snapshot.settings.activationMetric || undefined,
    queryFilter: snapshot.settings.queryFilter,
    skipPartialData: snapshot.settings.skipPartialData,
    attributionModel: snapshot.settings.attributionModel,
    statsEngine: analysisSettings.statsEngine,
    regressionAdjustmentEnabled: analysisSettings.regressionAdjusted,
    metricRegressionAdjustmentStatuses: getMetricRegressionAdjustmentStatusesFromSnapshot(
      snapshot.settings,
      analysisSettings
    ),
    sequentialTestingEnabled: analysisSettings.sequentialTesting,
    sequentialTestingTuningParameter:
      analysisSettings.sequentialTestingTuningParameter,
  };
}

export function getSnapshotSettingsFromReportArgs(
  args: ExperimentReportArgs,
  metricMap: Map<string, MetricInterface>
): {
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
} {
  const snapshotSettings: ExperimentSnapshotSettings = {
    metricSettings: args.metrics
      .concat(args.guardrails || [])
      .concat(args.activationMetric ? [args.activationMetric] : [])
      .map((m) =>
        getMetricForSnapshot(
          m,
          metricMap,
          args.metricRegressionAdjustmentStatuses,
          args.metricOverrides
        )
      )
      .filter(Boolean) as MetricForSnapshot[],
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
    regressionAdjustmentEnabled: !!args.regressionAdjustmentEnabled,
    goalMetrics: args.metrics,
    guardrailMetrics: args.guardrails || [],
    dimensions: args.dimension ? [{ id: args.dimension }] : [],
    variations: args.variations.map((v) => ({
      id: v.id,
      weight: v.weight,
    })),
  };

  const analysisSettings: ExperimentSnapshotAnalysisSettings = {
    dimensions: args.dimension ? [args.dimension] : [],
    statsEngine: args.statsEngine || DEFAULT_STATS_ENGINE,
    regressionAdjusted: args.regressionAdjustmentEnabled,
    pValueCorrection: null,
    sequentialTesting: args.sequentialTestingEnabled,
    sequentialTestingTuningParameter: args.sequentialTestingTuningParameter,
  };

  return { snapshotSettings, analysisSettings };
}

export async function startExperimentAnalysis({
  organization,
  snapshotSettings,
  analysisSettings,
  variationNames,
  useCache,
  metricMap,
}: {
  organization: OrganizationInterface;
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  variationNames: string[];
  metricMap: Map<string, MetricInterface>;
  useCache: boolean;
}) {
  const datasourceObj = await getDataSourceById(
    snapshotSettings.datasourceId,
    organization.id
  );
  if (!datasourceObj) {
    throw new Error("Missing datasource for report");
  }

  const activationMetrics: MetricInterface[] = [];
  if (snapshotSettings.activationMetric) {
    activationMetrics.push(
      ...expandDenominatorMetrics(snapshotSettings.activationMetric, metricMap)
        .map((m) => metricMap.get(m) as MetricInterface)
        .filter(Boolean)
    );
  }

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const selectedMetrics = Array.from(
    new Set(
      snapshotSettings.goalMetrics.concat(snapshotSettings.guardrailMetrics)
    )
  )
    .map((m) => metricMap.get(m))
    .filter((m) => m) as MetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  let segmentObj: SegmentInterface | null = null;
  if (snapshotSettings.segment) {
    segmentObj = await findSegmentById(
      snapshotSettings.segment,
      organization.id
    );
  }

  const integration = getSourceIntegrationObject(datasourceObj);
  if (integration.decryptionError) {
    throw new Error(
      "Could not decrypt data source credentials. View the data source settings for more info."
    );
  }

  const queryDocs: { [key: string]: Promise<QueryDocument> } = {};
  const dimensionObj = await parseDimensionId(
    snapshotSettings.dimensions[0]?.id,
    organization.id
  );

  // Run it as a single synchronous task (non-sql datasources and legacy code)
  if (!integration.getSourceProperties().separateExperimentResultQueries) {
    queryDocs["results"] = getExperimentResults({
      integration,
      snapshotSettings,
      metrics: selectedMetrics,
      activationMetric: activationMetrics[0],
      dimension: dimensionObj?.type === "user" ? dimensionObj.dimension : null,
    });
  }
  // Run as multiple async queries (new way for sql datasources)
  else {
    selectedMetrics.forEach((m) => {
      const denominatorMetrics: MetricInterface[] = [];
      if (m.denominator) {
        denominatorMetrics.push(
          ...expandDenominatorMetrics(m.denominator, metricMap)
            .map((m) => metricMap.get(m) as MetricInterface)
            .filter(Boolean)
        );
      }
      queryDocs[m.id] = getExperimentMetric(
        integration,
        {
          metric: m,
          dimension: dimensionObj,
          activationMetrics,
          denominatorMetrics,
          segment: segmentObj,
          settings: snapshotSettings,
        },
        useCache
      );
    });
  }

  const { queries, result: results } = await startRun(
    queryDocs,
    async (queryData) => {
      return analyzeExperimentResults({
        analysisSettings,
        snapshotSettings,
        variationNames,
        metricMap,
        queryData,
      });
    }
  );

  return { queries, results };
}

export function getMetricForSnapshot(
  id: string | null | undefined,
  metricMap: Map<string, MetricInterface>,
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[],
  metricOverrides?: MetricOverride[]
): MetricForSnapshot | null {
  if (!id) return null;
  const metric = metricMap.get(id);
  if (!metric) return null;
  const overrides = metricOverrides?.find((o) => o.id === id);
  const regressionAdjustmentStatus = metricRegressionAdjustmentStatuses?.find(
    (s) => s.metric === id
  );
  return {
    id,
    settings: {
      datasource: metric.datasource,
      type: metric.type,
      aggregation: metric.aggregation || undefined,
      capping: metric.capping || null,
      capValue: metric.capValue || undefined,
      denominator: metric.denominator || undefined,
      sql: metric.sql || undefined,
      userIdTypes: metric.userIdTypes || undefined,
    },
    computedSettings: {
      conversionDelayHours:
        overrides?.conversionDelayHours ?? metric.conversionDelayHours ?? 0,
      conversionWindowHours:
        overrides?.conversionWindowHours ??
        metric.conversionWindowHours ??
        DEFAULT_CONVERSION_WINDOW_HOURS,
      regressionAdjustmentDays:
        regressionAdjustmentStatus?.regressionAdjustmentDays ??
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled:
        regressionAdjustmentStatus?.regressionAdjustmentEnabled ?? false,
      regressionAdjustmentReason: regressionAdjustmentStatus?.reason ?? "",
    },
  };
}

export async function runReport(
  organization: OrganizationInterface,
  report: ReportInterface,
  useCache: boolean = true
) {
  const updates: Partial<ReportInterface> = {};

  if (report.type === "experiment") {
    const metricMap = await getMetricMap(organization.id);

    const {
      snapshotSettings,
      analysisSettings,
    } = getSnapshotSettingsFromReportArgs(report.args, metricMap);

    const { queries, results } = await startExperimentAnalysis({
      organization,
      snapshotSettings,
      analysisSettings,
      variationNames: report.args.variations.map((v) => v.name),
      metricMap,
      useCache,
    });

    updates.queries = queries;
    updates.results = results || report.results;
    updates.runStarted = new Date();
    updates.error = "";
  } else {
    throw new Error("Unsupported report type");
  }

  await updateReport(organization.id, report.id, updates);
}
