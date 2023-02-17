from dataclasses import asdict

import pandas as pd
from scipy.stats.distributions import chi2

from gbstats.bayesian.tests import BinomialBayesianABTest, GaussianBayesianABTest
from gbstats.frequentist.tests import TwoSidedTTest
from gbstats.shared.constants import StatsEngine
from gbstats.shared.models import (
    ProportionStatistic,
    SampleMeanStatistic,
    RatioStatistic,
    Statistic,
    TestResult,
)
from gbstats.shared.tests import BaseABTest


# Looks for any variation ids that are not in the provided map
def detect_unknown_variations(rows, var_id_map, ignore_ids={"__multiple__"}):
    unknown_var_ids = []
    for row in rows.itertuples(index=False):
        id = str(row.variation)
        if id not in ignore_ids and id not in var_id_map:
            unknown_var_ids.append(id)
    return set(unknown_var_ids)


# Transform raw SQL result for metrics into a dataframe of dimensions
def get_metric_df(
    rows,
    var_id_map,
    var_names,
):
    dimensions = {}
    # Each row in the raw SQL result is a dimension/variation combo
    # We want to end up with one row per dimension
    for row in rows.itertuples(index=False):
        dim = row.dimension

        # If this is the first time we're seeing this dimension, create an empty dict
        if dim not in dimensions:
            # Overall columns
            dimensions[dim] = {
                "dimension": dim,
                "variations": len(var_names),
                "statistic_type": row.statistic_type,
                "main_metric_type": row.main_metric_type,
                "denominator_metric_type": getattr(
                    row, "denominator_metric_type", None
                ),
                "total_users": 0,
            }
            # Add columns for each variation (including baseline)
            for key in var_id_map:
                i = var_id_map[key]
                prefix = f"v{i}" if i > 0 else "baseline"
                dimensions[dim][f"{prefix}_id"] = key
                dimensions[dim][f"{prefix}_name"] = var_names[i]
                dimensions[dim][f"{prefix}_users"] = 0
                dimensions[dim][f"{prefix}_count"] = 0
                dimensions[dim][f"{prefix}_main_sum"] = 0
                dimensions[dim][f"{prefix}_main_sum_squares"] = 0
                dimensions[dim][f"{prefix}_denominator_sum"] = 0
                dimensions[dim][f"{prefix}_denominator_sum_squares"] = 0
                dimensions[dim][f"{prefix}_main_denominator_sum_product"] = 0

        # Add this SQL result row into the dimension dict if we recognize the variation
        key = str(row.variation)
        if key in var_id_map:
            i = var_id_map[key]

            dimensions[dim]["total_users"] += row.users
            prefix = f"v{i}" if i > 0 else "baseline"
            dimensions[dim][f"{prefix}_users"] = row.users
            dimensions[dim][f"{prefix}_count"] = row.count
            dimensions[dim][f"{prefix}_main_sum"] = row.main_sum
            dimensions[dim][f"{prefix}_main_sum_squares"] = row.main_sum_squares
            dimensions[dim][f"{prefix}_denominator_sum"] = getattr(
                row, "denominator_sum", 0
            )
            dimensions[dim][f"{prefix}_denominator_sum_squares"] = getattr(
                row, "denominator_sum_squares", 0
            )
            dimensions[dim][f"{prefix}_main_denominator_sum_product"] = getattr(
                row, "main_denominator_sum_product", 0
            )

    return pd.DataFrame(dimensions.values())


# Limit to the top X dimensions with the most users
# Merge the rest into an "(other)" dimension
def reduce_dimensionality(df, max=20):
    num_variations = df.at[0, "variations"]

    rows = df.to_dict("records")
    rows.sort(key=lambda i: i["total_users"], reverse=True)

    newrows = []

    for i, row in enumerate(rows):
        # For the first few dimensions, keep them as-is
        if i < max:
            newrows.append(row)
        # For the rest, merge them into the last dimension
        else:
            current = newrows[max - 1]
            current["dimension"] = "(other)"
            current["total_users"] += row["total_users"]
            for v in range(num_variations):
                prefix = f"v{v}" if v > 0 else "baseline"
                current[f"{prefix}_users"] += row[f"{prefix}_users"]
                current[f"{prefix}_count"] += row[f"{prefix}_count"]
                current[f"{prefix}_main_sum"] += row[f"{prefix}_main_sum"]
                current[f"{prefix}_main_sum_squares"] += row[
                    f"{prefix}_main_sum_squares"
                ]
                current[f"{prefix}_denominator_sum"] += row[f"{prefix}_denominator_sum"]
                current[f"{prefix}_denominator_sum_squares"] += row[
                    f"{prefix}_denominator_sum_squares"
                ]
                current[f"{prefix}_main_denominator_sum_product"] += row[
                    f"{prefix}_main_denominator_sum_product"
                ]

    return pd.DataFrame(newrows)


# Run A/B test analysis for each variation and dimension
def analyze_metric_df(df, weights, inverse=False, engine=StatsEngine.BAYESIAN):
    num_variations = df.at[0, "variations"]

    # Add new columns to the dataframe with placeholder values
    df["srm_p"] = 0
    df["engine"] = engine.value
    for i in range(num_variations):
        if i == 0:
            df["baseline_cr"] = 0
            df["baseline_mean"] = None
            df["baseline_stddev"] = None
            df["baseline_risk"] = None
        else:
            df[f"v{i}_cr"] = 0
            df[f"v{i}_mean"] = None
            df[f"v{i}_stddev"] = None
            df[f"v{i}_expected"] = 0
            df[f"v{i}_p_value"] = None
            df[f"v{i}_rawrisk"] = None
            df[f"v{i}_risk"] = None
            df[f"v{i}_prob_beat_baseline"] = None
            df[f"v{i}_uplift"] = None

    def analyze_row(s):
        s = s.copy()
        # Baseline values
        stat_a: Statistic = variation_statistic_from_metric_row(s, "baseline")
        s["baseline_cr"] = stat_a.mean
        s["baseline_mean"] = stat_a.mean
        s["baseline_stddev"] = stat_a.stddev

        # List of users in each variation (used for SRM check)
        users = [0] * num_variations
        users[0] = stat_a.n

        # Loop through each non-baseline variation and run an analysis
        baseline_risk = 0
        for i in range(1, num_variations):
            # Variation values
            stat_b: Statistic = variation_statistic_from_metric_row(s, f"v{i}")

            s[f"v{i}_cr"] = stat_b.mean
            s[f"v{i}_expected"] = (
                (stat_b.mean / stat_a.mean) - 1 if stat_a.mean > 0 else 0
            )
            s[f"v{i}_mean"] = stat_b.mean
            s[f"v{i}_stddev"] = stat_b.stddev

            users[i] = stat_b.n

            # Run the A/B test analysis of baseline vs variation
            if engine == StatsEngine.BAYESIAN:
                if isinstance(stat_a, ProportionStatistic) and isinstance(
                    stat_b, ProportionStatistic
                ):
                    test: BaseABTest = BinomialBayesianABTest(
                        stat_a, stat_b, inverse=inverse
                    )
                else:
                    test: BaseABTest = GaussianBayesianABTest(
                        stat_a, stat_b, inverse=inverse
                    )

                res: TestResult = test.compute_result()

                # The baseline risk is the max risk of any of the variation A/B tests
                if res.relative_risk[0] > baseline_risk:
                    baseline_risk = res.relative_risk[0]

                s.at[f"v{i}_rawrisk"] = res.risk
                s[f"v{i}_risk"] = res.relative_risk[1]
                s[f"v{i}_prob_beat_baseline"] = res.chance_to_win
            else:
                test: BaseABTest = TwoSidedTTest(stat_a, stat_b)
                res: TestResult = test.compute_result()
                s[f"v{i}_p_value"] = res.p_value
                baseline_risk = None

            s.at[f"v{i}_ci"] = res.ci
            s.at[f"v{i}_uplift"] = asdict(res.uplift)

        s["baseline_risk"] = baseline_risk
        s["srm_p"] = check_srm(users, weights)
        return s

    return df.apply(analyze_row, axis=1)


# Convert final experiment results to a structure that can be easily
# serialized and used to display results in the GrowthBook front-end
def format_results(df):
    num_variations = df.at[0, "variations"]
    results = []
    rows = df.to_dict("records")
    for row in rows:
        dim = {"dimension": row["dimension"], "srm": row["srm_p"], "variations": []}
        for v in range(num_variations):
            prefix = f"v{v}" if v > 0 else "baseline"
            stats = {
                "users": row[f"{prefix}_users"],
                "count": row[f"{prefix}_count"],
                "stddev": row[f"{prefix}_stddev"],
                "mean": row[f"{prefix}_mean"],
            }
            if v == 0:
                dim["variations"].append(
                    {
                        "cr": row[f"{prefix}_cr"],
                        "value": row[f"{prefix}_main_sum"],
                        "users": row[f"{prefix}_users"],
                        "denominator": row[f"{prefix}_count"],
                        "stats": stats,
                    }
                )
            else:
                dim["variations"].append(
                    {
                        "cr": row[f"{prefix}_cr"],
                        "value": row[f"{prefix}_main_sum"],
                        "users": row[f"{prefix}_users"],
                        "denominator": row[f"{prefix}_count"],
                        "expected": row[f"{prefix}_expected"],
                        "chanceToWin": row[f"{prefix}_prob_beat_baseline"],
                        "pValue": row[f"{prefix}_p_value"],
                        "uplift": row[f"{prefix}_uplift"],
                        "ci": row[f"{prefix}_ci"],
                        "risk": row[f"{prefix}_rawrisk"],
                        "stats": stats,
                    }
                )
        results.append(dim)
    return results


def variation_statistic_from_metric_row(row: pd.DataFrame, prefix: str) -> Statistic:
    statistic_type = row["statistic_type"]
    if statistic_type == "ratio":
        return RatioStatistic(
            m_statistic=base_statistic_from_metric_row(row, prefix, "main"),
            d_statistic=base_statistic_from_metric_row(row, prefix, "denominator"),
            m_d_sum_of_products=row[f"{prefix}_main_denominator_sum_product"],
            n=row[f"{prefix}_users"],
        )
    elif statistic_type == "mean":
        return base_statistic_from_metric_row(row, prefix, "main")
    else:
        raise ValueError(
            f"Unexpected statistic_type {statistic_type}' found in experiment data."
        )


def base_statistic_from_metric_row(
    row: pd.DataFrame, prefix: str, component: str
) -> Statistic:
    metric_type = row[f"{component}_metric_type"]
    if metric_type == "binomial":
        return ProportionStatistic(
            sum=row[f"{prefix}_{component}_sum"], n=row[f"{prefix}_count"]
        )
    elif metric_type in ["count", "duration", "revenue"]:
        return SampleMeanStatistic(
            sum=row[f"{prefix}_{component}_sum"],
            sum_squares=row[f"{prefix}_{component}_sum_squares"],
            n=row[f"{prefix}_count"],
        )
    else:
        raise ValueError(
            f"Unexpected metric_type '{metric_type}' type for '{component}_type in experiment data."
        )


# Run a chi-squared test to make sure the observed traffic split matches the expected one
def check_srm(users, weights):
    # Convert count of users into ratios
    total_observed = sum(users)
    if not total_observed:
        return 1

    x = 0
    for i, o in enumerate(users):
        if weights[i] <= 0:
            continue
        e = weights[i] * total_observed
        x = x + ((o - e) ** 2) / e

    return chi2.sf(x, len(users) - 1)
