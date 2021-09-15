import { ExperimentInterface } from "../../types/experiment";
import {
  ExperimentSnapshotInterface,
  SnapshotMetric,
} from "../../types/experiment-snapshot";
import {
  CodeCell,
  CodeOutput,
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

type BinomialResult = {
  variation: string;
  users: number;
  conversions: number;
  conversion_rate: number;
  chance_to_beat_control: number;
  risk_of_choosing: number;
  uplift_mean: number;
};
type GaussianResult = {
  variation: string;
  users: number;
  total_value: number;
  per_user: number;
  chance_to_beat_control: number;
  risk_of_choosing: number;
  uplift_mean: number;
};

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

// eslint-disable-next-line
function getPlainTextOutput(value: string): CodeOutputDisplayData {
  return {
    output_type: "execute_result",
    execution_count: 0,
    data: {
      "text/plain": value,
    },
    metadata: {},
  };
}

function getHTMLOutput(html: string): CodeOutputDisplayData {
  return {
    output_type: "execute_result",
    execution_count: 0,
    data: {
      "text/html": html,
    },
    metadata: {},
  };
}

function getDataFrameOutput(
  rows: Record<string, string | number | boolean>[],
  cols?: string[]
): CodeOutputDisplayData {
  if (!rows[0]) {
    return getHTMLOutput("<em>empty</em>");
  }

  if (!cols) {
    cols = Object.keys(rows[0]);
  }

  const html = `<div>
<style>
.dataframe tbody tr th {
  vertical-align: top;
}
</style>
<table border="1" class="dataframe">
<thead>
<tr style="text-align: right;">
  <th></th>
  ${cols
    .map((k) => {
      return `<th>${k}</th>`;
    })
    .join("")}
</tr>
</thead>
<tbody>
${rows
  .map((row, i) => {
    return `<tr>
  <th>${i}</th>
  ${cols
    .map((k) => {
      return `<td>${row[k]}</td>`;
    })
    .join("")}
</tr>`;
  })
  .join("")}
</tbody>
</table>`;

  return getHTMLOutput(html);
}

// eslint-disable-next-line
function getJSONOutput(data: any): CodeOutputDisplayData {
  return {
    output_type: "execute_result",
    execution_count: 0,
    data: {
      "application/json": data,
    },
    metadata: {},
  };
}

function getMarkdown(source: string): MarkdownCell {
  return {
    cell_type: "markdown",
    source,
    metadata: {},
  };
}

function getCodeCell(source: string, output: CodeOutput = null): CodeCell {
  return {
    source,
    cell_type: "code",
    execution_count: 0,
    outputs: output ? [output] : [],
    metadata: {},
  };
}

function addExecutionCounts(notebook: Notebook) {
  let e = 1;
  notebook.cells.forEach((cell) => {
    if (cell.cell_type === "code") {
      const i = e++;
      cell.execution_count = i;

      cell.outputs.forEach((output) => {
        if (
          (output as CodeOutputDisplayData).output_type === "execute_result"
        ) {
          (output as CodeOutputDisplayData).execution_count = i;
        }
      });
    }
  });
}

export async function generateExperimentNotebook(
  snapshotId: string,
  organization: string
): Promise<Notebook> {
  const {
    experiment,
    snapshot,
    datasource,
    metrics,
    queries,
  } = await getNotebookObjects(snapshotId, organization);

  // Create the notebook
  const nb = getEmptyNotebook();

  // Markdown field with the experiment name, hypothesis, link to GrowthBook results
  // TODO: more info like date range, goals/guardrail/activation metric, phase, screenshots
  nb.cells.push(
    getMarkdown(`## ${experiment.name}
[View on GrowthBook](${APP_ORIGIN}/experiment/${experiment.id})

**Hypothesis:** ${experiment.hypothesis}`)
  );

  // Python imports
  // TODO: import GrowthBook stats engine as a library
  nb.cells.push(
    getCodeCell(
      `import numpy as np
import pandas`
    )
  );

  nb.cells.push(getMarkdown(`## Queries`));

  // The runQuery definition for the datasource
  nb.cells.push(getCodeCell(datasource.settings.notebookRunQuery));

  // Run SQL queries (number of users plus one for each metric)
  snapshot.queries.forEach((q) => {
    const data = queries.get(q.name);

    if (q.name === "users") {
      nb.cells.push(getMarkdown(`### Number of Users in Experiment`));
    } else {
      nb.cells.push(
        getMarkdown(`### Metric Values: ${metrics.get(q.name)?.name || q.name}`)
      );
    }

    nb.cells.push(
      getCodeCell(
        `sql_${q.name} = """${data.query}"""
  rows_${q.name} = runQuery(sql_${q.name})
  rows_${q.name}.head()`,
        data.rawResult ? getDataFrameOutput(data.rawResult.slice(0, 5)) : null
      )
    );
  });

  // Clean up the raw SQL rows and get the data ready for the stats engine
  nb.cells.push(
    getCodeCell(
      `# TODO: clean up the raw SQL and get data ready for the stats engine`
    )
  );

  nb.cells.push(getMarkdown(`## Analysis`));

  nb.cells.push(getCodeCell("# TODO: prep the data for the stats engine"));

  // Call the stats engine for each metric/variation
  nb.cells.push(getCodeCell(`# TODO: call the stats engine`));

  // Post-process the stats results
  nb.cells.push(getCodeCell(`# TODO: post-process the stats results`));

  // Experiment results
  nb.cells.push(getMarkdown(`## Results`));

  // Display any warnings (e.g. SRM)
  nb.cells.push(
    getCodeCell(
      `# TODO: SRM check`,
      snapshot.results[0].srm < 0.001
        ? getHTMLOutput(
            `<div style="color:red;">Sample Ratio Mismatch (SRM) detected with p-value of <code>${snapshot.results[0].srm}</code></div>`
          )
        : null
    )
  );

  // Render results for each metric
  experiment.metrics.forEach((m) => {
    const metric = metrics.get(m);
    if (!metric) return;

    nb.cells.push(getMarkdown(`### Metric: ${metric.name}`));

    // Render results as a table
    const results: (BinomialResult | GaussianResult)[] = [];
    const cols =
      metric.type === "binomial"
        ? [
            "variation",
            "users",
            "conversions",
            "conversion_rate",
            "chance_to_beat_control",
            "risk_of_choosing",
            "uplift_mean",
          ]
        : [
            "variation",
            "users",
            "total_value",
            "per_user",
            "chance_to_beat_control",
            "risk_of_choosing",
            "uplift_mean",
          ];
    snapshot.results[0].variations.forEach((variation, i) => {
      const metrics: unknown = variation.metrics;
      const metricValue = (metrics as Map<string, SnapshotMetric>).get(m);

      if (metric.type === "binomial") {
        results.push({
          variation: experiment.variations[i]?.name || i + "",
          users: metricValue?.users || 0,
          conversions: metricValue?.value || 0,
          conversion_rate: metricValue?.cr || 0,
          chance_to_beat_control: metricValue?.chanceToWin || 0,
          risk_of_choosing: metricValue?.risk?.[1] || 0,
          uplift_mean: metricValue?.uplift?.mean || 0,
        });
      } else {
        results.push({
          variation: experiment.variations[i]?.name || i + "",
          users: metricValue?.users || 0,
          total_value: metricValue?.value || 0,
          per_user: metricValue?.cr || 0,
          chance_to_beat_control: metricValue?.chanceToWin || 0,
          risk_of_choosing: metricValue?.risk?.[1] || 0,
          uplift_mean: metricValue?.uplift?.mean || 0,
        });
      }
    });

    nb.cells.push(
      getCodeCell(
        `result_${m}.head(${experiment.variations.length})`,
        results?.length ? getDataFrameOutput(results, cols) : null
      )
    );
  });

  addExecutionCounts(nb);

  return nb;
}
