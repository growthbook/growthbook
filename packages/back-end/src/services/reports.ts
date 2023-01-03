import { MetricInterface } from "../../types/metric";
import {
  ExperimentReportArgs,
  ExperimentReportVariation,
  ReportInterface,
} from "../../types/report";
import { getMetricsByOrganization } from "../models/MetricModel";
import { QueryDocument } from "../models/QueryModel";
import { SegmentModel } from "../models/SegmentModel";
import { SegmentInterface } from "../../types/segment";
import { getDataSourceById } from "../models/DataSourceModel";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { OrganizationSettings } from "../../types/organization";
import { updateReport } from "../models/ReportModel";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import { expandDenominatorMetrics } from "../util/sql";
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
    removeMultipleExposures: !!experiment.removeMultipleExposures,
    attributionModel: experiment.attributionModel || "firstExposure",
  };
}

export async function startExperimentAnalysis(
  organization: string,
  args: ExperimentReportArgs,
  useCache: boolean,
  statsEngine: OrganizationSettings["statsEngine"]
) {
  const metricObjs = await getMetricsByOrganization(organization);
  const metricMap = new Map<string, MetricInterface>();
  metricObjs.forEach((m) => {
    metricMap.set(m.id, m);
  });

  const datasourceObj = await getDataSourceById(args.datasource, organization);
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
    segmentObj =
      (await SegmentModel.findOne({
        id: args.segment,
        organization,
      })) || null;
  }

  const integration = getSourceIntegrationObject(datasourceObj);
  if (integration.decryptionError) {
    throw new Error(
      "Could not decrypt data source credentials. View the data source settings for more info."
    );
  }

  const queryDocs: { [key: string]: Promise<QueryDocument> } = {};

  const experimentPhaseObj: ExperimentPhase = {
    dateStarted: args.startDate,
    dateEnded: args.endDate,
    phase: "main",
    coverage: 1,
    reason: "",
    variationWeights: args.variations.map((v) => v.weight),
  };
  const experimentObj: ExperimentInterface = {
    exposureQueryId: args.exposureQueryId,
    userIdType: args.userIdType,
    organization,
    skipPartialData: args.skipPartialData,
    trackingKey: args.trackingKey,
    datasource: args.datasource,
    segment: args.segment,
    queryFilter: args.queryFilter,
    activationMetric: args.activationMetric,
    metrics: args.metrics,
    metricOverrides: args.metricOverrides,
    guardrails: args.guardrails,
    removeMultipleExposures: !!args.removeMultipleExposures,
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
        name: v.name,
        key: v.id,
        screenshots: [],
      };
    }),
  };
  const dimensionObj = await parseDimensionId(args.dimension, organization);

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
        },
        useCache
      );
    });
  }

  const { queries, result: results } = await startRun(
    queryDocs,
    async (queryData) =>
      analyzeExperimentResults(
        organization,
        args.variations,
        args.dimension,
        queryData,
        statsEngine
      )
  );
  return { queries, results };
}

export async function runReport(
  report: ReportInterface,
  useCache: boolean = true,
  statsEngine: OrganizationSettings["statsEngine"]
) {
  const updates: Partial<ReportInterface> = {};

  if (report.type === "experiment") {
    const { queries, results } = await startExperimentAnalysis(
      report.organization,
      report.args,
      useCache,
      statsEngine
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

  await updateReport(report.organization, report.id, updates);
}
