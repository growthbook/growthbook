import { promisify } from "util";
import { PythonShell } from "python-shell";
import { APP_ORIGIN } from "../util/secrets";
import { ExperimentSnapshotModel } from "../models/ExperimentSnapshotModel";
import { ExperimentModel } from "../models/ExperimentModel";
import { getMetricsByDatasource } from "../models/MetricModel";
import { getDataSourceById } from "../models/DataSourceModel";
import { MetricInterface } from "../../types/metric";
import { ExperimentReportArgs } from "../../types/report";
import { getReportById } from "../models/ReportModel";
import { Queries } from "../../types/query";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import { reportArgsFromSnapshot } from "./reports";
import { getQueryData } from "./queries";

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
    "",
    !report.results?.hasCorrectedStats
  );
}

export async function generateExperimentNotebook(
  snapshotId: string,
  organization: string
): Promise<string> {
  // Get snapshot
  const snapshotDoc = await ExperimentSnapshotModel.findOne({
    id: snapshotId,
    organization,
  });
  if (!snapshotDoc) {
    throw new Error("Cannot find snapshot");
  }
  const snapshot: ExperimentSnapshotInterface = snapshotDoc.toJSON();

  if (!snapshot.queries?.length) {
    throw new Error("Snapshot does not have queries");
  }
  if (!snapshot.results?.[0]?.variations?.[0]) {
    throw new Error("Snapshot does not have data");
  }

  // Get experiment
  const experiment = await ExperimentModel.findOne({
    id: snapshot.experiment,
    organization,
  });
  if (!experiment) {
    throw new Error("Cannot find snapshot");
  }
  if (!experiment.datasource) {
    throw new Error("Experiment must use a datasource");
  }

  return generateNotebook(
    organization,
    snapshot.queries,
    reportArgsFromSnapshot(experiment, snapshot),
    `/experiment/${experiment.id}`,
    experiment.name,
    experiment.hypothesis || "",
    !snapshot.hasCorrectedStats
  );
}

export async function generateNotebook(
  organization: string,
  queryPointers: Queries,
  args: ExperimentReportArgs,
  url: string,
  name: string,
  description: string,
  needsCorrection: boolean
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
  const metrics = await getMetricsByDatasource(datasource.id, organization);
  const metricMap: Map<string, MetricInterface> = new Map();
  metrics.forEach((m: MetricInterface) => {
    metricMap.set(m.id, m);
  });

  // Get queries
  const queries = await getQueryData(queryPointers, organization);

  const var_id_map: Record<string, number> = {};
  args.variations.forEach((v, i) => {
    var_id_map[v.id] = i;
  });

  const data = JSON.stringify({
    metrics: args.metrics
      .map((m) => {
        const q = queries.get(m);
        const metric = metricMap.get(m);
        if (!q || !metric) return null;
        return {
          rows: q.rawResult,
          name: metric.name,
          sql: q.query,
          inverse: !!metric.inverse,
          ignore_nulls: !!metric.ignoreNulls,
          type: metric.type,
        };
      })
      .filter(Boolean),
    url: `${APP_ORIGIN}${url}`,
    hypothesis: description,
    name,
    var_id_map,
    var_names: args.variations.map((v) => v.name),
    weights: args.variations.map((v) => v.weight),
    run_query: datasource.settings.notebookRunQuery,
    needs_correction: needsCorrection,
  }).replace(/\\/g, "\\\\");

  const result = await promisify(PythonShell.runString)(
    `
from gbstats.gen_notebook import create_notebook
import pandas as pd
import json

data = json.loads("""${data}""", strict=False)

metrics=[]
for metric in data['metrics']:
    metrics.append({
        'rows': pd.DataFrame(metric['rows']),
        'name': metric['name'],
        'sql': metric['sql'],
        'inverse': metric['inverse'],
        'ignore_nulls': metric['ignore_nulls'],
        'type': metric['type']
    })

print(create_notebook(
    metrics=metrics,
    url=data['url'],
    hypothesis=data['hypothesis'],
    name=data['name'],
    var_id_map=data['var_id_map'],
    var_names=data['var_names'],
    weights=data['weights'],
    run_query=data['run_query'],
    needs_correction=data['needs_correction']
))`,
    {}
  );

  if (!result) {
    throw new Error("Failed to generate notebook");
  }

  return result.join("\n");
}
