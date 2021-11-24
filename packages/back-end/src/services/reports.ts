import { MetricInterface } from "../../types/metric";
import { ExperimentReportVariation, ReportInterface } from "../../types/report";
import { getMetricsByOrganization } from "../models/MetricModel";
import { getSourceIntegrationObject } from "./datasource";
import { getExperimentMetric, getExperimentResults, startRun } from "./queries";
import { QueryDocument } from "../models/QueryModel";
import { SegmentModel } from "../models/SegmentModel";
import { SegmentInterface } from "../../types/segment";
import { getDataSourceById } from "../models/DataSourceModel";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { parseDimensionId } from "./experiments";
import { updateReport } from "../models/ReportModel";
import { analyzeExperimentResults } from "./stats";

export async function startExperimentAnalysis({
  organization,
  datasource,
  activationMetric,
  metrics,
  guardrails,
  segment,
  startDate,
  endDate,
  variations,
  dimension,
  trackingKey,
  queryFilter,
  userIdType,
  skipPartialData,
}: {
  organization: string;
  datasource: string;
  activationMetric?: string;
  metrics: string[];
  guardrails?: string[];
  segment?: string;
  startDate: Date;
  endDate?: Date;
  variations: ExperimentReportVariation[];
  dimension?: string;
  trackingKey: string;
  queryFilter?: string;
  skipPartialData?: boolean;
  userIdType?: "user" | "anonymous";
}) {
  const metricObjs = await getMetricsByOrganization(organization);
  const metricMap = new Map<string, MetricInterface>();
  metricObjs.forEach((m) => {
    metricMap.set(m.id, m);
  });

  const datasourceObj = await getDataSourceById(datasource, organization);
  if (!datasourceObj) {
    throw new Error("Missing datasource for report");
  }

  const activationMetricObj = metricMap.get(activationMetric || "") || null;

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const selectedMetrics = Array.from(new Set(metrics.concat(guardrails || [])))
    .map((m) => metricMap.get(m))
    .filter((m) => m) as MetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  let segmentObj: SegmentInterface | null = null;
  if (segment) {
    segmentObj =
      (await SegmentModel.findOne({
        id: segment,
        organization,
      })) || null;
  }

  const integration = getSourceIntegrationObject(datasourceObj);

  const queryDocs: { [key: string]: Promise<QueryDocument> } = {};

  const experimentPhaseObj: ExperimentPhase = {
    dateStarted: startDate,
    dateEnded: endDate,
    phase: "main",
    coverage: 1,
    reason: "",
    variationWeights: variations.map((v) => v.weight),
  };
  const experimentObj: ExperimentInterface = {
    userIdType,
    organization,
    skipPartialData,
    trackingKey,
    datasource,
    segment,
    queryFilter,
    activationMetric,
    metrics,
    guardrails,
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
    variations: variations.map((v) => {
      return {
        name: v.name,
        key: v.id,
        screenshots: [],
      };
    }),
  };
  const dimensionObj = await parseDimensionId(dimension, organization);

  // Run it as a single synchronous task (non-sql datasources and legacy code)
  if (!integration.getSourceProperties().separateExperimentResultQueries) {
    queryDocs["results"] = getExperimentResults(
      integration,
      experimentObj,
      experimentPhaseObj,
      selectedMetrics,
      activationMetricObj,
      dimensionObj?.type === "user" ? dimensionObj.dimension : null
    );
  }
  // Run as multiple async queries (new way for sql datasources)
  else {
    selectedMetrics.forEach((m) => {
      queryDocs[m.id] = getExperimentMetric(integration, {
        metric: m,
        experiment: experimentObj,
        dimension: dimensionObj,
        activationMetric: activationMetricObj,
        phase: experimentPhaseObj,
        segment: segmentObj,
      });
    });
  }

  const { queries, result: results } = await startRun(
    queryDocs,
    async (queryData) =>
      analyzeExperimentResults(organization, variations, dimension, queryData)
  );
  return { queries, results };
}

export async function runReport(report: ReportInterface) {
  const updates: Partial<ReportInterface> = {};

  if (report.type === "experiment") {
    const { queries, results } = await startExperimentAnalysis({
      organization: report.organization,
      ...report.args,
    });
    updates.queries = queries;
    updates.results = results || report.results;
    updates.runStarted = new Date();
    updates.error = "";
  } else {
    throw new Error("Unsupported report type");
  }

  await updateReport(report.organization, report.id, updates);
}
