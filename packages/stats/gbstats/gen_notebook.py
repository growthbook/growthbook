from dataclasses import dataclass
from .gbstats import (
    DataForStatsEngine,
    filter_query_rows,
    get_var_id_map,
    process_analysis,
)
import pandas as pd
import nbformat
from nbformat import v4 as nbf
from nbformat import from_dict


def code_cell_df(df, source=""):
    return nbf.new_code_cell(
        source=source,
        outputs=[
            nbf.new_output(
                output_type="execute_result",
                data={"text/plain": df.to_string(), "text/html": df.to_html()},
            )
        ],
    )


def code_cell_plain(source="", text=""):
    return nbf.new_code_cell(
        source=source,
        outputs=[
            nbf.new_output(output_type="execute_result", data={"text/plain": text})
        ],
    )


@dataclass
class NotebookParams:
    url: str
    hypothesis: str
    name: str
    run_query: str


def create_notebook(data: DataForStatsEngine, params: NotebookParams):
    # parse settings
    analysis = data.analyses[0]  # only one analysis for notebooks
    var_id_map = get_var_id_map(analysis.var_ids)
    gbstats_version: str = "0.8.0"

    summary_cols = [
        "variation",
        "dimension",
        "users",
        "cr",
        "expected",
        "ci",
    ]
    if analysis.stats_engine == "bayesian":
        summary_cols.append("chanceToWin")
    elif analysis.stats_engine == "frequentist":
        summary_cols.append("pValue")

    cells = [
        nbf.new_markdown_cell(
            f"# {params.name}\n"
            f"[View on GrowthBook]({params.url})\n\n"
            f"**Hypothesis:** {params.hypothesis}"
        ),
        nbf.new_markdown_cell("## Notebook Setup"),
        nbf.new_code_cell(
            f"# This notebook requires gbstats version {gbstats_version} or later\n"
            "try:\n"
            "    import gbstats.utils\n"
            f"    gbstats.utils.check_gbstats_compatibility('{gbstats_version}')\n"
            "except ModuleNotFoundError:\n"
            f"    raise ValueError('Upgrade gbstats to {gbstats_version} or later from PyPI using `pip install gbstats`')\n\n"
            "from gbstats.gbstats import (\n"
            "    filter_query_rows,\n"
            "    process_analysis,\n"
            "    AnalysisSettingsForStatsEngine,\n"
            "    MetricSettingsForStatsEngine,\n"
            ")\n"
            "import pandas as pd\n\n"
            "# Mapping of variation id to index\n"
            f"var_id_map = {str(var_id_map)}\n\n"
            "# Analysis settings\n"
            f"analysis = {repr(analysis)}\n\n"
            f"# Columns to show in the result summary\n"
            f"summary_cols = {str(summary_cols)}"
        ),
        nbf.new_code_cell("# User defined runQuery function\n" f"{params.run_query}"),
    ]

    for i, query in enumerate(data.query_results):
        metrics = [
            data.metrics[m] if m in data.metrics else None for m in query.metrics
        ]
        if not any(metrics):
            continue
        cells.append(
            nbf.new_markdown_cell(
                f"## Query {i}\n\n"
                f"Metric(s): {', '.join([m.name for m in metrics if m])}\n\n"
            )
        )
        df = pd.DataFrame(query.rows)
        query_prefix = f"q{i}"
        cells.append(
            code_cell_df(
                df=df,
                source=(
                    "# Get aggregate metric values per dimension/variation\n"
                    f'{query_prefix}_sql = """{query.sql}"""\n\n'
                    f"{query_prefix}_rows = runQuery({query_prefix}_sql)\n"
                    f"display({query_prefix}_rows)"
                ),
            )
        )

        if len(df) == 0:
            cells.append(nbf.new_markdown_cell("No data for these metrics"))
            continue
        for j, metric in enumerate(metrics):
            if not metric:
                continue
            cells.append(nbf.new_markdown_cell(f"### Metric - {metric.name}"))
            metric_prefix = f"q{i}_m{j}"
            rows = pd.DataFrame(filter_query_rows(query.rows, j))
            cells.append(
                code_cell_df(
                    df=rows,
                    source=(
                        "# Process query to get rows for this metric\n"
                        f"{metric_prefix}_rows = pd.DataFrame(filter_query_rows({query_prefix}_rows.to_dict('records'), {j}))\n"
                        f"display({metric_prefix}_rows)"
                    ),
                )
            )
            cells.append(
                code_cell_plain(
                    source=(
                        "# Metric Settings\n"
                        f"{metric_prefix}_settings = {repr(metric)}"
                    ),
                )
            )
            cells.append(nbf.new_markdown_cell("#### Result"))

            result = process_analysis(
                rows=rows, metric=metric, analysis=analysis, var_id_map=var_id_map
            )

            result_df = pd.concat([x.to_df() for x in result])
            cells.append(
                code_cell_df(
                    df=result_df[summary_cols].T,
                    source=(
                        "# Run the analysis and show a summary of results\n"
                        f"{metric_prefix}_result = process_analysis(\n"
                        f"    rows={metric_prefix}_rows,\n"
                        f"    metric={metric_prefix}_settings,\n"
                        f"    analysis=analysis,\n"
                        f"    var_id_map=var_id_map,\n"
                        f")\n"
                        f"{metric_prefix}_result_df = pd.concat([x.to_df() for x in {metric_prefix}_result])\n"
                        f"display({metric_prefix}_result_df[summary_cols].T)"
                    ),
                )
            )

    nb = nbf.new_notebook(
        metadata=from_dict(
            {
                "kernelspec": {
                    "display_name": "Python 3",
                    "language": "python",
                    "name": "python3",
                },
                "language_info": {
                    "name": "python",
                    "codemirror_mode": {"name": "ipython", "version": 3},
                    "version": "3.7.4",
                    "file_extension": ".py",
                    "mimetype": "text/x-python",
                    "nbconvert_exporter": "python",
                    "pygments_lexer": "ipython3",
                },
            }
        ),
        cells=cells,
    )

    return nbformat.writes(
        nb=nb,
    )
