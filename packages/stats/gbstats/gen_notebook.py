from .gbstats import process_metric_rows, run_analysis, check_srm
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
):
    cells = [
        # Intro
        nbf.new_markdown_cell(
            f"# {name}\n"
            f"[View on GrowthBook]({url})\n\n"
            f"**Hypothesis:** {hypothesis}\n\n"
            "## Notebook Setup"
        ),
        # Notebook Setup
        nbf.new_code_cell(
            "from gbstats.gbstats import check_srm, process_metric_rows, run_analysis\n\n"
            "# Mapping of variation id to index\n"
            f"var_id_map = {str(var_id_map)}\n\n"
            "# Display names of variations\n"
            f"var_names = {str(var_names)}\n\n"
            "# Expected traffic split between variations\n"
            f"weights = {str(weights)}"
        ),
        # runQuery definition
        nbf.new_code_cell("# User defined runQuery function\n" f"{run_query}"),
    ]

    for i, metric in enumerate(metrics):
        name = metric["name"]
        cells.append(nbf.new_markdown_cell(f"## Metric - {name}\n" "### Query"))
        sql = metric["sql"]
        cells.append(
            code_cell_df(
                df=metric["rows"],
                source=(
                    "# Get aggregate metric values per variation\n"
                    f'm{i}_sql = """{sql}"""\n\n'
                    f"m{i}_rows = runQuery(m{i}_sql)\n"
                    f"display(m{i}_rows)"
                ),
            )
        )
        cells.append(nbf.new_markdown_cell("### Processing and Data Quality Checks"))

        type = metric["type"]
        ignore_nulls = metric["ignore_nulls"]
        inverse = metric["inverse"]
        processed, unknown_var_ids = process_metric_rows(
            rows=metric["rows"],
            var_id_map=var_id_map,
            ignore_nulls=ignore_nulls,
            type=type,
        )

        srm_p = check_srm(processed["users"].tolist(), weights)

        cells.append(
            code_cell_df(
                df=processed,
                source=(
                    "# Sort rows, correct means and stddevs, identify unknown variation ids\n"
                    f"m{i}, unknown_var_ids = process_metric_rows(\n"
                    f"    rows=m{i}_rows,\n"
                    f"    var_id_map=var_id_map,\n"
                    f"    ignore_nulls={ignore_nulls},\n"
                    f'    type="{type}"\n'
                    f")\n"
                    f"display(m{i})"
                ),
            )
        )

        cells.append(
            code_cell_plain(
                source=(
                    "# Any variation ids returned from the query that we were not expecting\n"
                    'print("Unknown variation ids:", unknown_var_ids)'
                ),
                text=("Unknown variation ids:" + (str(unknown_var_ids))),
            )
        )

        cells.append(
            code_cell_plain(
                source=(
                    "# Sample Ratio Mismatch (SRM) Check\n"
                    f"srm_p = check_srm(m{i}['users'].tolist(), weights)\n\n"
                    'print("SRM P-value:", srm_p)\n\n'
                    'print("***WARNING: SRM Detected***" if srm_p < 0.001 else "Ok, no SRM detected")'
                ),
                text=(
                    f"SRM P-value: {srm_p}\n"
                    + (
                        "***WARNING: SRM Detected***"
                        if srm_p < 0.001
                        else "Ok, no SRM detected"
                    )
                ),
            )
        )

        cells.append(nbf.new_markdown_cell("### Result"))

        result = run_analysis(
            metric=processed, var_names=var_names, type=type, inverse=inverse
        )

        cells.append(
            code_cell_df(
                df=result,
                source=(
                    f"m{i}_result = run_analysis(\n"
                    f"    metric=m{i},\n"
                    f"    var_names=var_names,\n"
                    f'    type="{type}",\n'
                    f"    inverse={inverse}\n"
                    f")\n"
                    f"display(m{i}_result)"
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
