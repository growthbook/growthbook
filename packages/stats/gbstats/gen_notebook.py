from .gbstats import (
    detect_unknown_variations,
    analyze_metric_df,
    get_metric_df,
    reduce_dimensionality,
)
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


def create_notebook(
    url="",
    hypothesis="",
    name="",
    var_id_map={},
    var_names=[],
    weights=[],
    run_query="",
    metrics=[],
    needs_correction=False,
):
    summary_cols = [
        "dimension",
        "baseline_name",
        "baseline_users",
        "baseline_cr",
        "baseline_risk",
    ]
    for i in range(1, len(var_names)):
        summary_cols.append(f"v{i}_name")
        summary_cols.append(f"v{i}_users")
        summary_cols.append(f"v{i}_cr")
        summary_cols.append(f"v{i}_risk")
        summary_cols.append(f"v{i}_expected")
        summary_cols.append(f"v{i}_ci")
        summary_cols.append(f"v{i}_prob_beat_baseline")

    cells = [
        nbf.new_markdown_cell(
            f"# {name}\n"
            f"[View on GrowthBook]({url})\n\n"
            f"**Hypothesis:** {hypothesis}"
        ),
        nbf.new_markdown_cell("## Notebook Setup"),
        nbf.new_code_cell(
            "# Requires gbstats version 0.4.0 or higher\n"
            "from gbstats.gbstats import (\n"
            "  detect_unknown_variations,\n"
            "  analyze_metric_df,\n"
            "  get_metric_df,\n"
            "  reduce_dimensionality\n"
            ")\n\n"
            "# Mapping of variation id to index\n"
            f"var_id_map = {str(var_id_map)}\n\n"
            "# Display names of variations\n"
            f"var_names = {str(var_names)}\n\n"
            "# Expected traffic split between variations\n"
            f"weights = {str(weights)}\n"
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
        cells.append(nbf.new_markdown_cell("### Data Quality Checks / Preparation"))

        inverse = metric["inverse"]

        unknown_var_ids = detect_unknown_variations(metric["rows"], var_id_map)
        cells.append(
            code_cell_plain(
                source=(
                    "# Identify any variation ids returned from SQL that we aren't expecting\n"
                    f"unknown_var_ids = detect_unknown_variations(\n"
                    f"    rows=m{i}_rows,\n"
                    f"    var_id_map=var_id_map\n"
                    f")\n"
                    'print("Unexpected variation ids: ", unknown_var_ids)'
                ),
                text=("Unexpected variation ids:" + (str(unknown_var_ids))),
            )
        )

        df = get_metric_df(
            rows=metric["rows"],
            var_id_map=var_id_map,
            var_names=var_names,
        )
        cells.append(
            code_cell_df(
                df=df,
                source=(
                    "# Process raw SQL rows into a usable dataframe for analysis\n"
                    f"m{i} = get_metric_df(\n"
                    f"    rows=m{i}_rows,\n"
                    f"    var_id_map=var_id_map,\n"
                    f"    var_names=var_names,\n"
                    f")\n"
                    f"display(m{i})"
                ),
            )
        )

        df = reduce_dimensionality(df, max=20)
        cells.append(
            code_cell_df(
                df=df,
                source=(
                    "# If there are too many dimensions, marge the smaller ones together\n"
                    f"m{i}_reduced = reduce_dimensionality(m{i}, max=20)\n"
                    f"display(m{i}_reduced)"
                ),
            )
        )

        cells.append(nbf.new_markdown_cell("### Result"))

        result = analyze_metric_df(
            df=df,
            weights=weights,
            inverse=inverse,
        )
        cells.append(
            code_cell_df(
                df=result[summary_cols].T,
                source=(
                    "# Run the analysis and show a summary of results\n"
                    f"m{i}_result = analyze_metric_df(\n"
                    f"    df=m{i}_reduced,\n"
                    f"    weights=weights,\n"
                    f"    inverse={inverse}\n"
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
