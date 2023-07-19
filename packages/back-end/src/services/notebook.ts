import { promisify } from "util";
import { PythonShell } from "python-shell";
import {
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { getSnapshotAnalysis } from "shared/util";
import { APP_ORIGIN } from "../util/secrets";
import { findSnapshotById } from "../models/ExperimentSnapshotModel";
import { getExperimentById } from "../models/ExperimentModel";
import { getMetricsByDatasource } from "../models/MetricModel";
import { getDataSourceById } from "../models/DataSourceModel";
import { MetricInterface } from "../../types/metric";
import { ExperimentReportArgs } from "../../types/report";
import { getReportById } from "../models/ReportModel";
import { Queries } from "../../types/query";
import { QueryMap } from "../queryRunners/QueryRunner";
import { getQueriesByIds } from "../models/QueryModel";
import { reportArgsFromSnapshot } from "./reports";

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
    dimension: args.dimension ?? "",
    name,
    var_id_map,
    var_names: args.variations.map((v) => v.name),
    weights: args.variations.map((v) => v.weight),
    run_query: datasource.settings.notebookRunQuery,
  }).replace(/\\/g, "\\\\");

  const statsEngine = args.statsEngine ?? DEFAULT_STATS_ENGINE;
  const configString =
    statsEngine === "frequentist" && (args.sequentialTestingEnabled ?? false)
      ? `{'sequential': True, 'sequential_tuning_parameter': ${
          args.sequentialTestingTuningParameter ??
          DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER
        }}`
      : "{}";
  const result = await promisify(PythonShell.runString)(
    `
from gbstats.gen_notebook import create_notebook
from gbstats.shared.constants import StatsEngine
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
    dimension=data['dimension'],
    name=data['name'],
    var_id_map=data['var_id_map'],
    var_names=data['var_names'],
    weights=data['weights'],
    run_query=data['run_query'],
    stats_engine=${
      statsEngine === "frequentist"
        ? "StatsEngine.FREQUENTIST"
        : "StatsEngine.BAYESIAN"
    },
    engine_config=${configString}
))`,
    {}
  );

  if (!result) {
    throw new Error("Failed to generate notebook");
  }

  return result.join("\n");
}
