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

type Result = {
  variation: string;
  users: number;
  total: number;
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

function getMarkdown(source: string): MarkdownCell {
  return {
    cell_type: "markdown",
    source,
    metadata: {},
  };
}

function getCodeCell(source: string, output: CodeOutput = null): CodeCell {
  return {
    source: source.trim(),
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
    getMarkdown(`# ${experiment.name}
[View on GrowthBook](${APP_ORIGIN}/experiment/${experiment.id})

**Hypothesis:** ${experiment.hypothesis}`)
  );

  // Map of variation key to index
  const vars: { [key: string]: number } = {};
  experiment.variations.forEach((v, i) => {
    if (datasource.settings?.variationIdFormat === "key") {
      vars[v.key || i + ""] = i;
    } else {
      vars[i + ""] = i;
    }
  });

  // Variation weights
  const weights =
    experiment.phases[snapshot.phase]?.variationWeights ||
    Array(experiment.variations.length).fill(1 / experiment.variations.length);

  nb.cells.push(getMarkdown(`## Notebook Setup`));

  // Python imports
  nb.cells.push(
    getCodeCell(
      `
from gbstats.gbstats import process_user_rows, check_srm, process_metric_rows, run_analysis

# Mapping of variation key to index
vars = ${JSON.stringify(vars)}

# Display names of variations
var_names = ${JSON.stringify(experiment.variations.map((v) => v.name))}

# Expected traffic split between variations
weights = ${JSON.stringify(weights)}
`
    )
  );

  // The runQuery definition for the datasource
  nb.cells.push(
    getCodeCell(
      `# User defined runQuery function\n` +
        datasource.settings.notebookRunQuery
    )
  );

  // Users
  nb.cells.push(getMarkdown(`## Users in Experiment`));
  const users = queries.get("users");
  nb.cells.push(
    getCodeCell(
      `
users_sql = """${users.query}"""
user_rows = runQuery(users_sql)
display(user_rows)`,
      users.rawResult ? getDataFrameOutput(users.rawResult.slice(0, 5)) : null
    )
  );
  nb.cells.push(
    getCodeCell(
      `
# Process raw user rows
users, unknown_vars = process_user_rows(
  rows=user_rows, 
  vars=vars
)

# Users in each variation
print("Users in each variation:", users)

# Any variation keys returned from the query that we weren't expecting
print("Unknown variation ids:", unknown_vars)`,
      getHTMLOutput(
        `<div>Users in each variation: ${JSON.stringify(
          snapshot.results[0].variations.map((v) => v.users)
        )}</div>\n<div>Unknown variation ids: ${JSON.stringify(
          snapshot.unknownVariations || []
        )}</div>`
      )
    )
  );
  nb.cells.push(
    getCodeCell(
      `
# Sample Ratio Mismatch Check
srm_p = check_srm(users, weights)

print("SRM P-value:", srm_p)

if srm_p < 0.001:
  print("***WARNING: Sample Ratio Mismatch Detected***")`,
      getHTMLOutput(
        `<div>SRM P-value: ${snapshot.results[0]?.srm}</div>${
          snapshot.results[0]?.srm < 0.001
            ? "\n<div>***WARNING: Sample Ratio Mismatch Detected***</div>"
            : ""
        }`
      )
    )
  );

  // Each Metric
  snapshot.queries.forEach((q, i) => {
    if (q.name === "users") return;

    const metric = metrics.get(q.name);
    if (!metric) return;

    const data = queries.get(q.name);

    nb.cells.push(
      getMarkdown(`## Metric - ${metrics.get(q.name)?.name || q.name}`)
    );

    nb.cells.push(getMarkdown(`### Query`));

    nb.cells.push(
      getCodeCell(
        `
# Get aggregate metric values per variation
m${i}_sql = """${data.query}"""
  
m${i}_rows = runQuery(m${i}_sql)
display(m${i}_rows)`,
        data.rawResult ? getDataFrameOutput(data.rawResult.slice(0, 5)) : null
      )
    );

    nb.cells.push(getMarkdown(`### Preparation`));

    const processed_rows = experiment.variations.map((v, i) => {
      const metrics: unknown = snapshot.results[0].variations[i].metrics;
      const metricValue = (metrics as Map<string, SnapshotMetric>).get(
        metric.id
      );
      return {
        users: metricValue?.users || 0,
        count: metricValue?.stats?.count,
        mean: metricValue?.stats?.mean,
        stddev: metricValue?.stats?.stddev,
      };
    });

    nb.cells.push(
      getCodeCell(
        `
# Prepare SQL rows for analysis
m${i} = process_metric_rows(
  rows=m${i}_rows, 
  vars=vars, 
  users=users, 
  ignore_nulls=${metric?.ignoreNulls ? "True" : "False"}
)
display(m${i})`,
        getDataFrameOutput(processed_rows, ["users", "count", "mean", "stddev"])
      )
    );

    nb.cells.push(getMarkdown(`### Result`));

    // Render results as a table
    const results: Result[] = [];
    const cols = [
      "variation",
      "users",
      "total",
      "per_user",
      "chance_to_beat_control",
      "risk_of_choosing",
      "uplift_mean",
    ];
    snapshot.results[0].variations.forEach((variation, i) => {
      const metrics: unknown = variation.metrics;
      const metricValue = (metrics as Map<string, SnapshotMetric>).get(
        metric.id
      );
      results.push({
        variation: experiment.variations[i]?.name || i + "",
        users: metricValue?.users || 0,
        total: metricValue?.value || 0,
        per_user: metricValue?.cr || 0,
        chance_to_beat_control: metricValue?.chanceToWin || 0,
        risk_of_choosing: metricValue?.risk?.[1] || 0,
        uplift_mean: metricValue?.uplift?.mean || 0,
      });
    });

    nb.cells.push(
      getCodeCell(
        `
res = run_analysis(
  metric=m${i}, 
  var_names=var_names, 
  type=${JSON.stringify(metric.type)}, 
  inverse=${metric.inverse ? "True" : "False"}
)
display(res)`,
        results?.length ? getDataFrameOutput(results, cols) : null
      )
    );

    nb.cells.push(
      getCodeCell(`# TODO: check for min sample size and suspicious uplifts`)
    );
  });

  addExecutionCounts(nb);

  return nb;
}
