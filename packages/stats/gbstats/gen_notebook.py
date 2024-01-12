from .gbstats import (
    analyze_metric_df,
    detect_unknown_variations,
    diff_for_daily_time_series,
    get_metric_df,
    reduce_dimensionality,
)
from gbstats.shared.constants import StatsEngine
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


def create_notebook(
    url="",
    hypothesis="",
    name="",
    dimension="",
    var_id_map={},
    var_names=[],
    weights=[],
    run_query="",
    metrics=[],
    stats_engine=StatsEngine.BAYESIAN,
    engine_config={},
):
    summary_cols = [
        "dimension",
        "baseline_name",
        "baseline_users",
        "baseline_cr",
    ]
    for i in range(1, len(var_names)):
        summary_cols.append(f"v{i}_name")
        summary_cols.append(f"v{i}_users")
        summary_cols.append(f"v{i}_cr")
        summary_cols.append(f"v{i}_expected")
        summary_cols.append(f"v{i}_ci")
        if stats_engine == StatsEngine.BAYESIAN:
            summary_cols.append(f"v{i}_prob_beat_baseline")
        elif stats_engine == StatsEngine.FREQUENTIST:
            summary_cols.append(f"v{i}_p_value")

    time_series: str = (
        dimension if dimension in ["pre:datedaily", "pre:datecumulative"] else ""
    )
    gbstats_version: str = "0.6.0" if time_series else "0.5.0"
    additional_import_statement = (
        ("    diff_for_daily_time_series,\n") if time_series else ""
    )
    cells = [
        nbf.new_markdown_cell(
            f"# {name}\n"
            f"[View on GrowthBook]({url})\n\n"
            f"**Hypothesis:** {hypothesis}"
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
            f"var_id_map = {str(var_id_map)}\n\n"
            "# Display names of variations\n"
            f"var_names = {str(var_names)}\n\n"
            "# Expected traffic split between variations\n"
            f"weights = {str(weights)}\n"
            "# Statistics engine to use\n"
            f"stats_engine = {str(stats_engine)}\n"
            "# Engine config\n"
            f"engine_config = {str(engine_config)}\n"
            f"# Columns to show in the result summary\n"
            f"summary_cols = {str(summary_cols)}"
        ),
        nbf.new_code_cell("# User defined runQuery function\n" f"{run_query}"),
    ]

    for i, metric in enumerate(metrics):
        name = metric["name"]
        cells.append(nbf.new_markdown_cell(f"## Metric - {name}"))
        cells.append(nbf.new_markdown_cell("### Query"))
        sql = metric["sql"]
        cells.append(
            code_cell_df(
                df=metric["rows"],
                source=(
                    "# Get aggregate metric values per dimension/variation\n"
                    f'm{i}_sql = """{sql}"""\n\n'
                    f"m{i}_rows = runQuery(m{i}_sql)\n"
                    f"display(m{i}_rows)"
                ),
            )
        )
        if len(metric["rows"]) == 0:
            cells.append(nbf.new_markdown_cell("No data for this metric"))
            continue

        cells.append(nbf.new_markdown_cell("### Data Quality Checks / Preparation"))

        if dimension == "pre:datedaily":
            df = diff_for_daily_time_series(metric["rows"])
            cells.append(
                code_cell_df(
                    df=df.sort_values(["variation", "dimension"]),
                    source=(
                        "# Diff values for daily time series\n"
                        f"m{i}_diffed = diff_for_daily_time_series(m{i}_rows)\n"
                        f'display(m{i}_diffed.sort_values(["variation", "dimension"]))'
                    ),
                )
            )
            metric_df_name = f"m{i}_diffed"
            final_df_name = f"m{i}"
        elif dimension == "pre:datecumulative":
            df = metric["rows"].copy()
            metric_df_name = f"m{i}_rows"
            final_df_name = f"m{i}"
        else:
            df = metric["rows"].copy()
            metric_df_name = f"m{i}_rows"
            final_df_name = f"m{i}_reduced"

        inverse = metric["inverse"]

        unknown_var_ids = detect_unknown_variations(df, var_id_map)
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
            var_id_map=var_id_map,
            var_names=var_names,
        )
        cells.append(
            code_cell_df(
                df=df_metric,
                source=(
                    "# Process raw SQL rows into a usable dataframe for analysis\n"
                    f"m{i} = get_metric_df(\n"
                    f"    rows={metric_df_name},\n"
                    f"    var_id_map=var_id_map,\n"
                    f"    var_names=var_names,\n"
                    f")\n"
                    f"display(m{i})"
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
                        f"m{i}_reduced = reduce_dimensionality(m{i}, max=20)\n"
                        f"display(m{i}_reduced)"
                    ),
                )
            )

        cells.append(nbf.new_markdown_cell("### Result"))

        result = analyze_metric_df(
            df=df_metric,
            weights=weights,
            inverse=inverse,
            engine=stats_engine,
            engine_config=engine_config,
        )
        cells.append(
            code_cell_df(
                df=result[summary_cols].T,
                source=(
                    "# Run the analysis and show a summary of results\n"
                    f"m{i}_result = analyze_metric_df(\n"
                    f"    df={final_df_name},\n"
                    f"    weights=weights,\n"
                    f"    inverse={inverse},\n"
                    f"    engine=stats_engine,\n"
                    f"    engine_config=engine_config,\n"
                    f")\n"
                    f"display(m{i}_result[summary_cols].T)"
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
