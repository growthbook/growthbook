from .gbstats import process_metric_rows, process_user_rows, run_analysis, check_srm
import pandas as pd
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
    users_sql="",
    user_rows=None,
    metrics=[],
):
    users, unknown_var_ids = process_user_rows(user_rows, var_id_map)
    srm_p = check_srm(users, weights)

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
            "from gbstats.gbstats import process_user_rows, "
            "check_srm, process_metric_rows, run_analysis\n\n"
            "# Mapping of variation id to index\n"
            f"var_id_map = {str(var_id_map)}\n\n"
            "# Display names of variations\n"
            f"var_names = {str(var_names)}\n\n"
            "# Expected traffic split between variations\n"
            f"weights = {str(weights)}"
        ),
        # runQuery definition
        nbf.new_code_cell("# User defined runQuery function\n" f"{run_query}"),
        # Users in Experiment
        nbf.new_markdown_cell("## Users in Experiment\n" "### Query"),
        # Users Query
        code_cell_df(
            user_rows,
            source=(
                f'users_sql = """{users_sql}"""\n'
                "user_rows = runQuery(users_sql)\n"
                "display(user_rows)"
            ),
        ),
        nbf.new_markdown_cell("### Data Quality Checks"),
        code_cell_plain(
            source=(
                "# Process raw user rows\n"
                "users, unknown_var_ids = process_user_rows(user_rows, var_id_map)\n\n"
                "# Users in each variation\n"
                'print("Users in each variation:", users)\n\n'
                "# Any variation ids returned from the query that we were not expecting\n"
                'print("Unknown variation ids:", unknown_var_ids)'
            ),
            text=(
                f"Users in each variation:"
                f"{str(users)}\n"
                "Unknown variation ids:"
                f"{str(unknown_var_ids)}"
            ),
        ),
        code_cell_plain(
            source=(
                "# Sample Ratio Mismatch (SRM) Check\n"
                "srm_p = check_srm(users, weights)\n\n"
                'print("SRM P-value:", srm_p)\n\n'
                "if srm_p < 0.001:\n"
                '    print("***WARNING: Sample Ratio Mismatch Detected***")\n'
                "else:\n"
                '    print("Ok, no SRM detected")'
            ),
            text=(
                f"SRM P-value: {srm_p}\n"
                f'{"***WARNING: Sample Ratio Mismatch Detected***" if srm_p < 0.001 else "Ok, no SRM detected"}'
            ),
        ),
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
        cells.append(nbf.new_markdown_cell("### Preparation"))

        type = metric["type"]
        ignore_nulls = metric["ignore_nulls"]
        inverse = metric["inverse"]
        processed = process_metric_rows(
            rows=metric["rows"],
            var_id_map=var_id_map,
            users=users,
            ignore_nulls=ignore_nulls,
            type=type,
        )

        cells.append(
            code_cell_df(
                df=processed,
                source=(
                    f"m{i} = process_metric_rows(\n"
                    f"    rows=m{i}_rows,\n"
                    f"    var_id_map=var_id_map,\n"
                    f"    users=users,\n"
                    f"    ignore_nulls={ignore_nulls},\n"
                    f'    type="{type}"\n'
                    f")\n"
                    f"display(m{i})"
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
