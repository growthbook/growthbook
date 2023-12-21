import { promisify } from "util";
import { PythonShell } from "python-shell";
import {
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { getSnapshotAnalysis } from "shared/util";
import { isBinomialMetric } from "shared/experiments";
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
import { reportArgsFromSnapshot } from "./reports";
import { ExperimentFactMetricsQueryResponseRows } from "../types/Integration";

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

  const var_id_map: Record<string, number> = {};
  args.variations.forEach((v, i) => {
    var_id_map[v.id] = i;
  });

  const groupData = [];
  queries.forEach((query, key) => {
    if (key.match(/group_/)) {
      // Multi-metric query
      const metrics = [];
      const rows = query.result as ExperimentFactMetricsQueryResponseRows;

      for (let i = 0; i < 100; i++) {
        const prefix = `m${i}_`;
        if (!rows[0]?.[prefix + "id"]) break;

        const metric = metricMap.get(rows[0][prefix + "id"] as string);
        if (!metric) continue;
        metrics.push({
          name: metric.name,
          inverse: !!metric.inverse,
          ignore_nulls: "ignoreNulls" in metric && !!metric.ignoreNulls,
          type: isBinomialMetric(metric) ? "binomial" : "count"
        });
      };
      groupData.push({
        rows: query.rawResult,
        name: key,
        sql: query.query,
        metrics: metrics
      });
    }
  });

  console.dir(groupData, {depth:null});
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
          ignore_nulls: "ignoreNulls" in metric && !!metric.ignoreNulls,
          type: isBinomialMetric(metric) ? "binomial" : "count",
        };
      })
      .filter(Boolean),
    groups: groupData,
    url: `${APP_ORIGIN}${url}`,
    hypothesis: description,
    dimension: args.dimension ?? "",
    name,
    var_id_map,
    var_names: args.variations.map((v) => v.name),
    weights: args.variations.map((v) => v.weight),
    run_query: datasource.settings.notebookRunQuery,
  }).replace(/\\/g, "\\\\");

  const statsEngine = args.statsEngine || DEFAULT_STATS_ENGINE;
  const configStrings: string[] = [];

  if (
    statsEngine === "frequentist" &&
    (args.sequentialTestingEnabled ?? false)
  ) {
    configStrings.push(`'sequential': True`);
    configStrings.push(
      `'sequential_tuning_parameter': ${Number(
        args.sequentialTestingTuningParameter ??
          DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER
      )}`
    );
  }
  if (statsEngine === "frequentist" && args.pValueThreshold !== undefined) {
    configStrings.push(`'alpha': ${Number(args.pValueThreshold)}`);
  }
  const configString = `{${
    configStrings.length ? configStrings.join(", ") : ""
  }}`;
  const result = await promisify(PythonShell.runString)(
    `
from gbstats.gen_notebook import create_notebook, NotebookParams
from gbstats.shared.constants import StatsEngine
import pandas as pd
import json

data = json.loads("""${data}""", strict=False)

metrics=[]
groups=[]
for metric in data['metrics']:
    metrics.append({
        'rows': pd.DataFrame(metric['rows']),
        'name': metric['name'],
        'sql': metric['sql'],
        'inverse': metric['inverse'],
        'ignore_nulls': metric['ignore_nulls'],
        'type': metric['type']
    })
for group in data['groups']:
    groups.append({
      'rows': pd.DataFrame(group['rows']),
      'name': group['name'],
      'sql': group['sql'],
      'metrics': group['metrics']
    })

print(create_notebook(
    params=NotebookParams(
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
    ),
    metrics=metrics,
    groups=groups,
))`,
    {}
  );

  if (!result) {
    throw new Error("Failed to generate notebook");
  }

  return result.join("\n");
}
