import { ExperimentInterface } from "../../types/experiment";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import {
  CodeOutputDisplayData,
  MarkdownCell,
  Notebook,
} from "../../types/notebook";
import { APP_ORIGIN } from "../util/secrets";
import { DataSourceInterface } from "../../types/datasource";
import { ExperimentSnapshotModel } from "../models/ExperimentSnapshotModel";
import { ExperimentModel } from "../models/ExperimentModel";
import { getMetricsByDatasource } from "../models/MetricModel";
import { getDataSourceById } from "../models/DataSourceModel";
import { MetricInterface } from "../../types/metric";
import { getQueryData } from "./queries";

function getEmptyNotebook(): Notebook {
  return {
    cells: [],
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: {
        name: "python",
        codemirror_mode: {
          name: "ipython",
          version: 3,
        },
        version: "3.7.4",
        file_extension: ".py",
        mimetype: "text/x-python",
        nbconvert_exporter: "python",
        pygments_lexer: "ipython3",
      },
    },
    nbformat: 4,
    nbformat_minor: 1,
  };
}

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
    metrics,
    queries,
  };
}

// eslint-disable-next-line
function getJSONOutput(data: any): CodeOutputDisplayData {
  return {
    output_type: "display_data",
    data: {
      "application/json": data,
    },
  };
}

function getMarkdown(source: string): MarkdownCell {
  return {
    cell_type: "markdown",
    source,
    metadata: {},
  };
}

export async function generateExperimentNotebook(
  snapshotId: string,
  organization: string
): Promise<Notebook> {
  const {
    experiment,
    snapshot,
    datasource,
    //metrics,
    queries,
  } = await getNotebookObjects(snapshotId, organization);

  // Create the notebook
  const nb = getEmptyNotebook();

  // Execution count
  let e = 1;

  // Markdown field with the experiment name, hypothesis, link to GrowthBook results
  // TODO: more info like date range, goals/guardrail/activation metric, phase, screenshots
  nb.cells.push(
    getMarkdown(`## ${experiment.name}
[View on GrowthBook](${APP_ORIGIN}/experiment/${experiment.id})

**Hypothesis:** ${experiment.hypothesis}`)
  );

  // Python imports
  // TODO: import GrowthBook stats engine as a library
  nb.cells.push({
    cell_type: "code",
    execution_count: e++,
    metadata: {},
    source: `import numpy as np
import scipy as sp`,
    outputs: [],
  });

  // The runQuery definition for the datasource
  nb.cells.push({
    cell_type: "code",
    execution_count: e++,
    metadata: {},
    source: datasource.settings.notebookRunQuery,
    outputs: [],
  });

  // Run SQL queries (number of users plus one for each metric)
  snapshot.queries.forEach((q) => {
    const data = queries.get(q.query);

    nb.cells.push({
      cell_type: "code",
      execution_count: e++,
      metadata: {},
      source: `sql_${q.name} = """${data.query}"""
  rows_${q.name} = runQuery(sql_${q.name})`,
      outputs: [
        // TODO: actual raw db result
        getJSONOutput(data.result),
      ],
    });
  });

  // Clean up the raw SQL rows and get the data ready for the stats engine
  nb.cells.push({
    cell_type: "code",
    execution_count: e++,
    metadata: {},
    source: `# TODO: clean up the raw SQL and get data ready for the stats engine`,
    outputs: [],
  });

  // Call the stats engine for each metric/variation
  nb.cells.push({
    cell_type: "code",
    execution_count: e++,
    metadata: {},
    source: `# TODO: call the stats engine`,
    outputs: [],
  });

  // Post-process the stats results
  nb.cells.push({
    cell_type: "code",
    execution_count: e++,
    metadata: {},
    source: `# TODO: post-process the stats results`,
    outputs: [],
  });

  nb.cells.push(getMarkdown(`## Results`));

  // Display any warnings (e.g. SRM)
  nb.cells.push({
    cell_type: "code",
    execution_count: e++,
    metadata: {},
    source: `# TODO: data quality checks like SRM`,
    outputs: [],
  });

  // Render the results output as a table
  nb.cells.push({
    cell_type: "code",
    execution_count: e++,
    metadata: {},
    source: `# TODO: print results in a table`,
    outputs: [],
  });

  return nb;
}
