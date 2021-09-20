import { ExperimentInterface } from "../../types/experiment";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import { APP_ORIGIN } from "../util/secrets";
import { DataSourceInterface } from "../../types/datasource";
import { ExperimentSnapshotModel } from "../models/ExperimentSnapshotModel";
import { ExperimentModel } from "../models/ExperimentModel";
import { getMetricsByDatasource } from "../models/MetricModel";
import { getDataSourceById } from "../models/DataSourceModel";
import { MetricInterface } from "../../types/metric";
import { getQueryData } from "./queries";
import { promisify } from "util";
import { PythonShell } from "python-shell";

async function getNotebookObjects(snapshotId: string, organization: string) {
  // Get snapshot
  const snapshot: ExperimentSnapshotInterface = await ExperimentSnapshotModel.findOne(
    {
      id: snapshotId,
      organization,
    }
  );
  if (!snapshot) {
    throw new Error("Cannot find snapshot");
  }
  if (!snapshot.queries?.length) {
    throw new Error("Snapshot does not have queries");
  }
  if (!snapshot.results?.[0]?.variations?.[0]) {
    throw new Error("Snapshot does not have data");
  }

  // Get experiment
  const experiment: ExperimentInterface = await ExperimentModel.findOne({
    id: snapshot.experiment,
    organization,
  });
  if (!experiment) {
    throw new Error("Cannot find snapshot");
  }
  if (!experiment.datasource) {
    throw new Error("Experiment must use a datasource");
  }

  // Get datasource
  const datasource: DataSourceInterface = await getDataSourceById(
    experiment.datasource,
    organization
  );
  if (!datasource) {
    throw new Error("Cannot find snapshot");
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
  const queries = await getQueryData(snapshot.queries, organization);

  return {
    experiment,
    snapshot,
    datasource,
    metrics: metricMap,
    queries,
  };
}

export async function generateExperimentNotebook(
  snapshotId: string,
  organization: string
): Promise<string> {
  const {
    experiment,
    snapshot,
    datasource,
    metrics,
    queries,
  } = await getNotebookObjects(snapshotId, organization);

  const var_id_map: Record<string, number> = {};
  experiment.variations.forEach((v, i) => {
    if (datasource.settings?.variationIdFormat === "key" && v.key) {
      var_id_map[v.key] = i;
    } else {
      var_id_map[i + ""] = i;
    }
  });

  const data = JSON.stringify({
    metrics: experiment.metrics
      .map((m) => {
        const q = queries.get(m);
        const metric = metrics.get(m);
        if (!q || !metric) return null;
        return {
          rows: q.rawResult,
          name: metric.name,
          sql: q.query,
          inverse: metric.inverse,
          ignore_nulls: metric.ignoreNulls,
          type: metric.type,
        };
      })
      .filter(Boolean),
    url: `${APP_ORIGIN}/experiment/${experiment.id}`,
    hypothesis: experiment.hypothesis,
    name: experiment.name,
    var_id_map,
    var_names: experiment.variations.map((v) => v.name),
    weights: experiment.phases[snapshot.phase].variationWeights,
    run_query: datasource.settings.notebookRunQuery,
    users_sql: queries.get("users").query,
    user_rows: queries.get("users").rawResult,
  });

  const result = await promisify(PythonShell.runString)(
    `
from gbstats.gen_notebook import create_notebook
import pandas as pd
import json

data = json.loads("""${data}""", strict=False)

user_rows=pd.DataFrame(data['user_rows'])
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
    user_rows=user_rows,
    metrics=metrics,
    url=data['url'],
    hypothesis=data['hypothesis'],
    name=data['name'],
    var_id_map=data['var_id_map'],
    var_names=data['var_names'],
    weights=data['weights'],
    run_query=data['run_query'],
    users_sql=data['users_sql']
))`,
    {}
  );

  return result.join("\n");
}
