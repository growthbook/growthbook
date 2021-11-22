import { MetricInterface } from "../../types/metric";
import {
  ExperimentReportResults,
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  ReportInterface,
} from "../../types/report";
import { getMetricsByOrganization } from "../models/MetricModel";
import {
  ExperimentMetricQueryResponse,
  ExperimentResults,
} from "../types/Integration";
import { analyzeExperimentMetric, MAX_DIMENSIONS } from "./stats";
import { getSourceIntegrationObject } from "./datasource";
import {
  getExperimentMetric,
  getExperimentResults,
  QueryMap,
  startRun,
} from "./queries";
import { QueryDocument } from "../models/QueryModel";
import { promiseAllChunks } from "../util/promise";
import { SegmentModel } from "../models/SegmentModel";
import { SegmentInterface } from "../../types/segment";
import { getDataSourceById } from "../models/DataSourceModel";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { parseDimensionId } from "./experiments";
import { updateReport } from "../models/ReportModel";

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
    id: "",
    name: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    tags: [],
    autoAssign: false,
    organization: organization,
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
    trackingKey: trackingKey,
    datasource: datasource,
    segment: segment,
    queryFilter: queryFilter,
    activationMetric: activationMetric,
    metrics: metrics,
    guardrails: guardrails,
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
    updates.results = results;
    updates.runStarted = new Date();
  } else {
    throw new Error("Unsupported report type");
  }

  await updateReport(report.organization, report.id, updates);
}

export async function analyzeExperimentResults(
  organization: string,
  variations: ExperimentReportVariation[],
  dimension: string | undefined,
  queryData: QueryMap
): Promise<ExperimentReportResults> {
  const metrics = await getMetricsByOrganization(organization);
  const metricMap = new Map<string, MetricInterface>();
  metrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

  const metricRows: {
    metric: string;
    rows: ExperimentMetricQueryResponse;
  }[] = [];

  let unknownVariations: string[] = [];

  // Everything done in a single query (Mixpanel, Google Analytics)
  // Need to convert to the same format as SQL rows
  if (queryData.has("results")) {
    const results = queryData.get("results");
    if (!results) throw new Error("Empty experiment results");
    const data = results.result as ExperimentResults;

    unknownVariations = data.unknownVariations;

    const byMetric: { [key: string]: ExperimentMetricQueryResponse } = {};
    data.dimensions.forEach((row) => {
      row.variations.forEach((v) => {
        Object.keys(v.metrics).forEach((metric) => {
          const stats = v.metrics[metric];
          byMetric[metric] = byMetric[metric] || [];
          byMetric[metric].push({
            ...stats,
            dimension: row.dimension,
            variation: variations[v.variation].id,
          });
        });
      });
    });

    Object.keys(byMetric).forEach((metric) => {
      metricRows.push({
        metric,
        rows: byMetric[metric],
      });
    });
  }
  // One query for each metric, can just use the rows directly from the query
  else {
    queryData.forEach((query, key) => {
      const metric = metricMap.get(key);
      if (!metric) return;

      metricRows.push({
        metric: key,
        rows: query.result as ExperimentMetricQueryResponse,
      });
    });
  }

  const dimensionMap: Map<string, ExperimentReportResultDimension> = new Map();
  await promiseAllChunks(
    metricRows.map((data) => {
      const metric = metricMap.get(data.metric);
      return async () => {
        if (!metric) return;
        const result = await analyzeExperimentMetric(
          variations,
          metric,
          data.rows,
          dimension === "pre:date" ? 100 : MAX_DIMENSIONS
        );
        unknownVariations = unknownVariations.concat(result.unknownVariations);

        result.dimensions.forEach((row) => {
          const dim = dimensionMap.get(row.dimension) || {
            name: row.dimension,
            srm: row.srm,
            variations: [],
          };

          row.variations.forEach((v, i) => {
            const data = dim.variations[i] || {
              users: v.users,
              metrics: {},
            };
            data.metrics[metric.id] = {
              ...v,
              buckets: [],
            };
            dim.variations[i] = data;
          });

          dimensionMap.set(row.dimension, dim);
        });
      };
    }),
    3
  );

  const dimensions = Array.from(dimensionMap.values());
  if (!dimensions.length) {
    dimensions.push({
      name: "All",
      srm: 1,
      variations: [],
    });
  }

  return {
    unknownVariations: Array.from(new Set(unknownVariations)),
    dimensions,
  };
}
