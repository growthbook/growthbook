import { promisify } from "util";
import { PythonShell } from "python-shell";
import { getSnapshotAnalysis } from "shared/util";
import { hoursBetween } from "shared/dates";
import { APP_ORIGIN } from "../util/secrets";
import { findSnapshotById } from "../models/ExperimentSnapshotModel";
import { getExperimentById } from "../models/ExperimentModel";
import { getMetricMap } from "../models/MetricModel";
import { getDataSourceById } from "../models/DataSourceModel";
import { ExperimentReportArgs } from "../../types/report";
import { getReportById } from "../models/ReportModel";
import { Queries } from "../../types/query";
import { QueryMap } from "../queryRunners/QueryRunner";
import { getQueriesByIds } from "../models/QueryModel";
import {
  getAnalysisSettingsFromReportArgs,
  reportArgsFromSnapshot,
} from "./reports";
import {
  DataForStatsEngine,
  getAnalysisSettingsForStatsEngine,
  getMetricsAndQueryDataForStatsEngine,
} from "./stats";

async function getQueryData(
  queries: Queries,
  organization: string,
  map?: QueryMap
): Promise<QueryMap> {
  const docs = await getQueriesByIds(
    organization,
    queries.map((q) => q.query)
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
  reportId: string,
  organization: string
): Promise<string> {
  const report = await getReportById(organization, reportId);
  if (!report) {
    throw new Error("Could not find report");
  }

  return generateNotebook(
    organization,
    report.queries,
    report.args,
    `/report/${report.id}`,
    report.title,
    ""
  );
}

export async function generateExperimentNotebook(
  snapshotId: string,
  organization: string
): Promise<string> {
  // Get snapshot
  const snapshot = await findSnapshotById(organization, snapshotId);
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
  const experiment = await getExperimentById(organization, snapshot.experiment);
  if (!experiment) {
    throw new Error("Cannot find snapshot");
  }
  if (!experiment.datasource) {
    throw new Error("Experiment must use a datasource");
  }

  return generateNotebook(
    organization,
    snapshot.queries,
    reportArgsFromSnapshot(experiment, snapshot, analysis.settings),
    `/experiment/${experiment.id}`,
    experiment.name,
    experiment.hypothesis || ""
  );
}

export async function generateNotebook(
  organization: string,
  queryPointers: Queries,
  args: ExperimentReportArgs,
  url: string,
  name: string,
  description: string
) {
  // Get datasource
  const datasource = await getDataSourceById(args.datasource, organization);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }
  if (!datasource.settings?.notebookRunQuery) {
    throw new Error(
      "Must define a runQuery function for this data source before exporting as a notebook."
    );
  }

  // Get metrics
  const metricMap = await getMetricMap(organization);

  // Get queries
  const queries = await getQueryData(queryPointers, organization);

  // use min query run date as end date if missing (legacy reports)
  let createdAt = new Date();
  queries.forEach((q) => {
    if (q.createdAt < createdAt) {
      createdAt = q.createdAt;
    }
  });
  args.endDate = args.endDate || createdAt;

  const phaseLengthDays =
    Math.max(hoursBetween(args.startDate, args.endDate), 1) / 24;

  const { queryResults, metricSettings } = getMetricsAndQueryDataForStatsEngine(
    queries,
    metricMap,
    args.variations
  );

  const data: DataForStatsEngine = {
    analyses: [
      getAnalysisSettingsForStatsEngine(
        getAnalysisSettingsFromReportArgs(args),
        args.variations,
        args.coverage ?? 1,
        phaseLengthDays
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
    {}
  );

  if (!result) {
    throw new Error("Failed to generate notebook");
  }

  return result.join("\n");
}
