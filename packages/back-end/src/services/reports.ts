import { DEFAULT_STATS_ENGINE } from "shared";
import { MetricInterface } from "../../types/metric";
import {
  ExperimentReportArgs,
  ExperimentReportVariation,
  ReportInterface,
} from "../../types/report";
import { getMetricsByOrganization } from "../models/MetricModel";
import { QueryDocument } from "../models/QueryModel";
import { findSegmentById } from "../models/SegmentModel";
import { SegmentInterface } from "../../types/segment";
import { getDataSourceById } from "../models/DataSourceModel";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { updateReport } from "../models/ReportModel";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import { expandDenominatorMetrics } from "../util/sql";
import { orgHasPremiumFeature } from "../util/organization.util";
import { OrganizationInterface } from "../../types/organization";
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

export function reportArgsFromSnapshot(
  experiment: ExperimentInterface,
  snapshot: ExperimentSnapshotInterface
): ExperimentReportArgs {
  const phase = experiment.phases[snapshot.phase];
  if (!phase) {
    throw new Error("Unknown experiment phase");
  }
  return {
    trackingKey: experiment.trackingKey,
    datasource: experiment.datasource,
    exposureQueryId: experiment.exposureQueryId,
    userIdType: experiment.userIdType,
    startDate: phase.dateStarted,
    endDate: phase.dateEnded || undefined,
    dimension: snapshot.dimension || undefined,
    variations: getReportVariations(experiment, phase),
    segment: snapshot.segment,
    metrics: experiment.metrics,
    metricOverrides: experiment.metricOverrides,
    guardrails: experiment.guardrails,
    activationMetric: snapshot.activationMetric,
    queryFilter: snapshot.queryFilter,
    skipPartialData: snapshot.skipPartialData,
    attributionModel: experiment.attributionModel || "firstExposure",
    statsEngine: snapshot.statsEngine || DEFAULT_STATS_ENGINE,
    regressionAdjustmentEnabled: snapshot.regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses:
      snapshot.metricRegressionAdjustmentStatuses || [],
    sequentialTestingEnabled: snapshot.sequentialTestingEnabled,
    sequentialTestingTuningParameter: snapshot.sequentialTestingTuningParameter,
  };
}

export async function startExperimentAnalysis(
  organization: OrganizationInterface,
  args: ExperimentReportArgs,
  useCache: boolean
) {
  const hasRegressionAdjustmentFeature = organization
    ? orgHasPremiumFeature(organization, "regression-adjustment")
    : false;
  const hasSequentialTestingFeature = organization
    ? orgHasPremiumFeature(organization, "sequential-testing")
    : false;
  const metricObjs = await getMetricsByOrganization(organization.id);
  const metricMap = new Map<string, MetricInterface>();
  metricObjs.forEach((m) => {
    metricMap.set(m.id, m);
  });

  const datasourceObj = await getDataSourceById(
    args.datasource,
    organization.id
  );
  if (!datasourceObj) {
    throw new Error("Missing datasource for report");
  }

  const activationMetrics: MetricInterface[] = [];
  if (args.activationMetric) {
    activationMetrics.push(
      ...expandDenominatorMetrics(args.activationMetric, metricMap)
        .map((m) => metricMap.get(m) as MetricInterface)
        .filter(Boolean)
    );
  }

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const selectedMetrics = Array.from(
    new Set(args.metrics.concat(args.guardrails || []))
  )
    .map((m) => metricMap.get(m))
    .filter((m) => m) as MetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  let segmentObj: SegmentInterface | null = null;
  if (args.segment) {
    segmentObj = await findSegmentById(args.segment, organization.id);
  }

  const integration = getSourceIntegrationObject(datasourceObj);
  if (integration.decryptionError) {
    throw new Error(
      "Could not decrypt data source credentials. View the data source settings for more info."
    );
  }

  const queryDocs: { [key: string]: Promise<QueryDocument> } = {};

  const experimentPhaseObj: ExperimentPhase = {
    name: "Report",
    dateStarted: args.startDate,
    dateEnded: args.endDate,
    coverage: 1,
    reason: "",
    variationWeights: args.variations.map((v) => v.weight),
    condition: "",
    namespace: {
      enabled: false,
      name: "",
      range: [0, 1],
    },
  };
  const experimentObj: ExperimentInterface = {
    exposureQueryId: args.exposureQueryId,
    userIdType: args.userIdType,
    hashAttribute: "",
    releasedVariationId: "",
    organization: organization.id,
    skipPartialData: args.skipPartialData,
    trackingKey: args.trackingKey,
    datasource: args.datasource,
    segment: args.segment,
    queryFilter: args.queryFilter,
    activationMetric: args.activationMetric,
    metrics: args.metrics,
    metricOverrides: args.metricOverrides,
    guardrails: args.guardrails,
    attributionModel: args.attributionModel || "firstExposure",
    id: "",
    name: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    tags: [],
    autoAssign: false,
    owner: "",
    implementation: "code",
    previewURL: "",
    status: "stopped",
    phases: [experimentPhaseObj],
    autoSnapshots: false,
    targetURLRegex: "",
    archived: false,
    variations: args.variations.map((v) => {
      return {
        id: v.id,
        name: v.name,
        key: v.id,
        screenshots: [],
      };
    }),
  };
  const dimensionObj = await parseDimensionId(args.dimension, organization.id);

  // Run it as a single synchronous task (non-sql datasources and legacy code)
  if (!integration.getSourceProperties().separateExperimentResultQueries) {
    queryDocs["results"] = getExperimentResults(
      integration,
      experimentObj,
      experimentPhaseObj,
      selectedMetrics,
      activationMetrics[0],
      dimensionObj?.type === "user" ? dimensionObj.dimension : null
    );
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
      const metricRegressionAdjustmentStatus = args?.metricRegressionAdjustmentStatuses?.find(
        (mras) => mras.metric === m.id
      );
      queryDocs[m.id] = getExperimentMetric(
        integration,
        {
          metric: m,
          experiment: experimentObj,
          dimension: dimensionObj,
          activationMetrics,
          denominatorMetrics,
          phase: experimentPhaseObj,
          segment: segmentObj,
          regressionAdjustmentEnabled:
            hasRegressionAdjustmentFeature &&
            !!args.regressionAdjustmentEnabled,
          metricRegressionAdjustmentStatus: metricRegressionAdjustmentStatus,
        },
        useCache
      );
    });
  }

  const { queries, result: results } = await startRun(
    queryDocs,
    async (queryData) => {
      return analyzeExperimentResults({
        organization: organization.id,
        variations: args.variations,
        dimension: args.dimension,
        queryData,
        statsEngine: args.statsEngine,
        sequentialTestingEnabled: hasSequentialTestingFeature
          ? args.sequentialTestingEnabled
          : false,
        sequentialTestingTuningParameter: args.sequentialTestingTuningParameter,
      });
    }
  );
  return { queries, results };
}

export async function runReport(
  org: OrganizationInterface,
  report: ReportInterface,
  useCache: boolean = true
) {
  const updates: Partial<ReportInterface> = {};

  if (report.type === "experiment") {
    const { queries, results } = await startExperimentAnalysis(
      org,
      report.args,
      useCache
    );

    if (results) {
      results.hasCorrectedStats = true;
    }

    updates.queries = queries;
    updates.results = results || report.results;
    updates.runStarted = new Date();
    updates.error = "";
  } else {
    throw new Error("Unsupported report type");
  }

  await updateReport(org.id, report.id, updates);
}
