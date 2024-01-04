from dataclasses import dataclass
from typing import Dict, List, Union
from .gbstats import (
    DataForStatsEngine,
    analyze_metric_df,
    detect_unknown_variations,
    diff_for_daily_time_series,
    get_metric_df,
    reduce_dimensionality,
)
from gbstats.shared.constants import StatsEngine
import nbformat
from nbformat import v4 as nbf
from nbformat.v4.nbjson import from_dict


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
    
        
def create_metric_chunks(prefix, metric, params: NotebookParams, time_series: str, summary_cols: List[str]):
    cells = [nbf.new_markdown_cell("### Data Quality Checks / Preparation")]
    if params.dimension == "pre:datedaily":
        df = diff_for_daily_time_series(metric["rows"])
        cells.append(
            code_cell_df(
                df=df.sort_values(["variation", "dimension"]),
                source=(
                    "# Diff values for daily time series\n"
                    f"{prefix}_diffed = diff_for_daily_time_series({prefix}_rows)\n"
                    f'display({prefix}_diffed.sort_values(["variation", "dimension"]))'
                ),
            )
        )
        metric_df_name = f"{prefix}_diffed"
        final_df_name = f"{prefix}"
    elif params.dimension == "pre:datecumulative":
        df = metric["rows"].copy()
        metric_df_name = f"{prefix}_rows"
        final_df_name = f"{prefix}"
    else:
        df = metric["rows"].copy()
        metric_df_name = f"{prefix}_rows"
        final_df_name = f"{prefix}_reduced"

    inverse = metric["inverse"]

    unknown_var_ids = detect_unknown_variations(df, params.var_id_map)
    cells.append(
        code_cell_plain(
            source=(
                "# Identify any variation ids returned from SQL that we aren't expecting\n"
                f"unknown_var_ids = detect_unknown_variations(\n"
                f"    rows={metric_df_name},\n"
                f"    var_id_map=var_id_map\n"
                f")\n"
                'print("Unexpected variation ids: ", unknown_var_ids)'
            ),
            text=("Unexpected variation ids:" + (str(unknown_var_ids))),
        )
    )

    df_metric = get_metric_df(
        rows=df,
        var_id_map=params.var_id_map,
        var_names=params.var_names,
    )
    cells.append(
        code_cell_df(
            df=df_metric,
            source=(
                "# Process raw SQL rows into a usable dataframe for analysis\n"
                f"{prefix} = get_metric_df(\n"
                f"    rows={metric_df_name},\n"
                f"    var_id_map=var_id_map,\n"
                f"    var_names=var_names,\n"
                f")\n"
                f"display({prefix})"
            ),
        )
    )

    if not time_series:
        df_metric = reduce_dimensionality(df_metric, max=20)
        cells.append(
            code_cell_df(
                df=df_metric,
                source=(
                    "# If there are too many dimensions, merge the smaller ones together\n"
                    f"{prefix}_reduced = reduce_dimensionality({prefix}, max=20)\n"
                    f"display({prefix}_reduced)"
                ),
            )
        )

    cells.append(nbf.new_markdown_cell("### Result"))

    result = analyze_metric_df(
        df=df_metric,
        weights=params.weights,
        inverse=inverse,
        engine=params.stats_engine,
        engine_config=params.engine_config,
    )
    cells.append(
        code_cell_df(
            df=result[summary_cols].T,
            source=(
                "# Run the analysis and show a summary of results\n"
                f"{prefix}_result = analyze_metric_df(\n"
                f"    df={final_df_name},\n"
                f"    weights=weights,\n"
                f"    inverse={inverse},\n"
                f"    engine=stats_engine,\n"
                f"    engine_config=engine_config,\n"
                f")\n"
                f"display({prefix}_result[summary_cols].T)"
            ),
        )
    )
    return cells    
    

def create_notebook(
    data: DataForStatsEngine,
    params: NotebookParams
):
    # parse settings
    analysis = data.analyses[0] # only one analysis for notebooks
    time_series: str = (
        analysis.dimension if analysis.dimension in ["pre:datedaily", "pre:datecumulative"] else ""
    )
    gbstats_version: str = "0.6.0" if time_series else "0.5.0"
    additional_import_statement = (
        ("    diff_for_daily_time_series,\n") if time_series else ""
    )
    
    summary_cols = [
        "dimension",
        "baseline_name",
        "baseline_users",
        "baseline_cr",
    ]
    for i in range(1, len(analysis.var_names)):
        summary_cols.append(f"v{i}_name")
        summary_cols.append(f"v{i}_users")
        summary_cols.append(f"v{i}_cr")
        summary_cols.append(f"v{i}_expected")
        summary_cols.append(f"v{i}_ci")
        if analysis.stats_engine == StatsEngine.BAYESIAN:
            summary_cols.append(f"v{i}_prob_beat_baseline")
        elif analysis.stats_engine == StatsEngine.FREQUENTIST:
            summary_cols.append(f"v{i}_p_value")

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
            f"    raise ValueError('Upgrade gbstats to {gbstats_version} or later from PyPI using `pip install gbstats`')\n"
            "from gbstats.gbstats import (\n"
            "    analyze_metric_df,\n"
            "    detect_unknown_variations,\n"
            f"{additional_import_statement}"
            "    get_metric_df,\n"
            "    reduce_dimensionality,\n"
            ")\n"
            "from gbstats.shared.constants import StatsEngine\n\n"
            "# Mapping of variation id to index\n"
            f"var_id_map = {str(data.var_id_map)}\n\n"
            "# Display names of variations\n"
            f"var_names = {str(analysis.var_names)}\n\n"
            "# Expected traffic split between variations\n"
            f"weights = {str(analysis.weights)}\n"
            "# Statistics engine to use\n"
            f"stats_engine = {str(analysis.stats_engine)}\n"
            "# Engine config\n"
            f"engine_config = {str(analysis.engine_config)}\n"
            f"# Columns to show in the result summary\n"
            f"summary_cols = {str(summary_cols)}"
        ),
        nbf.new_code_cell("# User defined runQuery function\n" f"{params.run_query}"),
    ]

    for i, metric in enumerate(metrics):
        name = metric["name"]
        cells.append(nbf.new_markdown_cell(f"## Metric - {name}"))
        cells.append(nbf.new_markdown_cell("### Query"))
        sql = metric["sql"]
        prefix = "m{i}"
        cells.append(
            code_cell_df(
                df=metric["rows"],
                source=(
                    "# Get aggregate metric values per dimension/variation\n"
                    f'{prefix}_sql = """{sql}"""\n\n'
                    f"{prefix}_rows = runQuery({prefix}_sql)\n"
                    f"display({prefix}_rows)"
                ),
            )
        )
        if len(metric["rows"]) == 0:
            cells.append(nbf.new_markdown_cell("No data for this metric"))
            return cells

        cells += create_metric_chunks(
            prefix=prefix,
            metric=metric,
            params=params,
            time_series=time_series,
            summary_cols=summary_cols,
        )

    for i, group in enumerate(groups):
        name = group["name"]
        cells = [nbf.new_markdown_cell(f"## Fact Table - {name}")]
        cells.append(nbf.new_markdown_cell("### Query"))
        sql = group["sql"]
        prefix = "f{i}"
        cells.append(
            code_cell_df(
                df=group["rows"],
                source=(
                    "# Get aggregate metric values per dimension/variation for all metrics in fact table\n"
                    f'{prefix}_sql = """{sql}"""\n\n'
                    f"{prefix}_rows = runQuery({prefix}_sql)\n"
                    f"display({prefix}_rows)"
                ),
            )
        )
        if len(group["rows"]) == 0:
            cells.append(nbf.new_markdown_cell("No data for this group"))
            return cells


        cells.append(nbf.new_markdown_cell("### Reshape data for metric analysis"))
        
        groupcols = group["rows"].columns
        for mi in range(len(group["metrics"])):
            metric = group["metrics"][mi]
            metric_prefix = f"m{mi}"
            cells.append(nbf.new_markdown_cell(f"## Metric - {metric['name']}"))
            metric_cols = [col for col in groupcols if col.startswith(metric_prefix)]
            mdata = group["rows"][metric_cols + ["dimension", "variation", "users"]].copy()

            statistic_type = "mean"
            if f"{metric_prefix}_denominator_sum" in metric_cols:
                statistic_type = "ratio"
                mdata["denominator_metric_type"] = metric["type"] # TODO IS THIS RIGHT
            elif f"{metric_prefix}_covariate_sum" in metric_cols:
                statistic_type = "mean_ra"
                mdata["covariate_metric_type"] = metric["type"]
            mdata["statistic_type"] = statistic_type
            mdata["main_metric_type"] = metric["type"]
            mdata.columns = mdata.columns.str.replace(f"{metric_prefix}_", "")
            cells += create_metric_chunks(
                prefix="{prefix}_{metric_prefix}",
                metric={
                    "name": metric["name"],
                    "rows": mdata,
                    "inverse": metric["inverse"],
                    "type": metric["type"],
                    "ignore_nulls": metric["ignore_nulls"]
                },
                params=params,
                time_series=time_series,
                summary_cols=summary_cols,
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
