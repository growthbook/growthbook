import { promisify } from "util";
import { PythonShell } from "python-shell";
import { getSnapshotAnalysis } from "shared/util";
import { hoursBetween } from "shared/dates";
import { expandAllSliceMetricsInMap } from "shared/experiments";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getReportById } from "back-end/src/models/ReportModel";
import { Queries } from "back-end/types/query";
import { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import { getQueriesByIds } from "back-end/src/models/QueryModel";
import { ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";
import { ExperimentInterface } from "back-end/types/experiment";
import { getSnapshotSettingsFromReportArgs } from "./reports";
import {
  DataForStatsEngine,
  getAnalysisSettingsForStatsEngine,
  getMetricsAndQueryDataForStatsEngine,
} from "./stats";

async function getQueryData(
  queries: Queries,
  organization: string,
  map?: QueryMap,
): Promise<QueryMap> {
  const docs = await getQueriesByIds(
    organization,
    queries.map((q) => q.query),
  );

  const res: QueryMap = map || new Map();
  docs.forEach((doc) => {
    const match = queries.filter((q) => q.query === doc.id)[0];
    if (!match) return;
    res.set(match.name, doc);
  });

  return res;
}

export async function generateReportNotebook(
  context: ReqContext | ApiReqContext,
  reportId: string,
): Promise<string> {
  const report = await getReportById(context.org.id, reportId);
  if (!report) {
    throw new Error("Could not find report");
  }

  if (report.type === "experiment") {
    // Get metrics
    const metricMap = await getMetricMap(context);
    const factTableMap = await getFactTableMap(context);
    const metricGroups = await context.models.metricGroups.getAll();

    const { snapshotSettings, analysisSettings } =
      getSnapshotSettingsFromReportArgs(
        report.args,
        metricMap,
        factTableMap,
        undefined,
        metricGroups,
      );
    return generateNotebook({
      context,
      queryPointers: report.queries,
      snapshotSettings,
      analysisSettings,
      variationNames: report.args.variations.map((v) => v.name),
      url: `/report/${report.id}`,
      name: report.title,
      description: "",
    });
  } else {
    return generateExperimentNotebook(context, report.snapshot);
  }
}

export async function generateExperimentNotebook(
  context: ReqContext,
  snapshotId: string,
): Promise<string> {
  // Get snapshot
  const snapshot = await findSnapshotById(context.org.id, snapshotId);
  if (!snapshot) {
    throw new Error("Cannot find snapshot");
  }

  if (!snapshot.queries?.length) {
    throw new Error("Snapshot does not have queries");
  }
  const analysis = getSnapshotAnalysis(snapshot);
  if (!analysis || !analysis.results?.[0]?.variations?.[0]) {
    throw new Error("Snapshot does not have data");
  }

  // Get experiment
  const experiment = await getExperimentById(context, snapshot.experiment);
  if (!experiment) {
    throw new Error("Cannot find snapshot");
  }
  if (!experiment.datasource) {
    throw new Error("Experiment must use a datasource");
  }

  return generateNotebook({
    context,
    queryPointers: snapshot.queries,
    snapshotSettings: snapshot.settings,
    analysisSettings: analysis.settings,
    variationNames: experiment.variations.map((v) => v.name),
    url: `/experiment/${experiment.id}`,
    name: experiment.name,
    description: experiment.hypothesis || "",
  });
}

export async function generateNotebook({
  context,
  queryPointers,
  snapshotSettings,
  analysisSettings,
  variationNames,
  url,
  name,
  description,
}: {
  context: ReqContext | ApiReqContext;
  queryPointers: Queries;
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  variationNames: string[];
  url: string;
  name: string;
  description: string;
}) {
  // Get datasource
  const datasource = await getDataSourceById(
    context,
    snapshotSettings.datasourceId,
  );
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }
  if (!datasource.settings?.notebookRunQuery) {
    throw new Error(
      "Must define a runQuery function for this data source before exporting as a notebook.",
    );
  }

  // Get metrics
  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);
  const metricGroups = await context.models.metricGroups.getAll();

  // Get experiment data to expand slice metrics
  let experiment: ExperimentInterface | null = null;
  if (snapshotSettings.experimentId) {
    experiment = await getExperimentById(
      context,
      snapshotSettings.experimentId,
    );
  }

  // Expand slice metrics if we have experiment data
  if (experiment) {
    expandAllSliceMetricsInMap({
      metricMap,
      factTableMap,
      experiment,
      metricGroups,
    });
  }

  // Get queries
  const queries = await getQueryData(queryPointers, context.org.id);

  // use min query run date as end date if missing (legacy reports)
  let createdAt = new Date();
  queries.forEach((q) => {
    if (q.createdAt < createdAt) {
      createdAt = q.createdAt;
    }
  });

  const phaseLengthDays =
    Math.max(
      hoursBetween(
        snapshotSettings.startDate,
        snapshotSettings.endDate || createdAt,
      ),
      1,
    ) / 24;

  const { queryResults, metricSettings } = getMetricsAndQueryDataForStatsEngine(
    queries,
    metricMap,
    snapshotSettings,
  );

  const data: DataForStatsEngine = {
    analyses: [
      getAnalysisSettingsForStatsEngine(
        analysisSettings,
        snapshotSettings.variations.map((v, i) => ({
          ...v,
          name: variationNames[i] || v.id,
        })),
        snapshotSettings.coverage ?? 1,
        phaseLengthDays,
      ),
    ],
    metrics: metricSettings,
    query_results: queryResults,
  };
  const datajson = JSON.stringify({
    data: data,
    url: `${APP_ORIGIN}${url}`,
    hypothesis: description,
    name,
    run_query: datasource.settings.notebookRunQuery,
  }).replace(/\\/g, "\\\\");

  const result = await promisify(PythonShell.runString)(
    `
from gbstats.gen_notebook import create_notebook, NotebookParams
from gbstats.gbstats import process_data_dict
import json

data = json.loads("""${datajson}""", strict=False)
print(create_notebook(
    data=process_data_dict(data['data']),
    params=NotebookParams(
      url=data['url'],
      hypothesis=data['hypothesis'],
      name=data['name'],
      run_query=data['run_query'],
    ),
))`,
    {},
  );

  if (!result) {
    throw new Error("Failed to generate notebook");
  }

  return result.join("\n");
}
