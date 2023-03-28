from dataclasses import asdict
from typing import Any, Dict, List, Union

import pandas as pd
from scipy.stats.distributions import chi2

from gbstats.bayesian.tests import (
    BayesianConfig,
    BinomialBayesianABTest,
    GaussianBayesianABTest,
)
from gbstats.frequentist.tests import (
    FrequentistConfig,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
)
from gbstats.shared.constants import StatsEngine
from gbstats.shared.models import (
    compute_theta,
    ProportionStatistic,
    SampleMeanStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
    Statistic,
    TestResult,
)
from gbstats.shared.tests import BaseABTest
from gbstats.messages import raise_error_if_bayesian_ra


SUM_COLS = [
    "users",
    "count",
    "main_sum",
    "main_sum_squares",
    "denominator_sum",
    "denominator_sum_squares",
    "main_denominator_sum_product",
    "covariate_sum",
    "covariate_sum_squares",
    "main_covariate_sum_product",
]


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
                "covariate_metric_type": getattr(row, "covariate_metric_type", None),
                "total_users": 0,
            }
            # Add columns for each variation (including baseline)
            for key in var_id_map:
                i = var_id_map[key]
                prefix = f"v{i}" if i > 0 else "baseline"
                dimensions[dim][f"{prefix}_id"] = key
                dimensions[dim][f"{prefix}_name"] = var_names[i]
                for col in SUM_COLS:
                    dimensions[dim][f"{prefix}_{col}"] = 0

        # Add this SQL result row into the dimension dict if we recognize the variation
        key = str(row.variation)
        if key in var_id_map:
            i = var_id_map[key]

            dimensions[dim]["total_users"] += row.users
            prefix = f"v{i}" if i > 0 else "baseline"
            for col in SUM_COLS:
                dimensions[dim][f"{prefix}_{col}"] = getattr(row, col, 0)

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
                for col in SUM_COLS:
                    current[f"{prefix}_{col}"] += row[f"{prefix}_{col}"]

    return pd.DataFrame(newrows)


# Run A/B test analysis for each variation and dimension
def analyze_metric_df(
    df: pd.DataFrame,
    weights: List[float],
    inverse: bool = False,
    engine: StatsEngine = StatsEngine.BAYESIAN,
    engine_config: Dict[str, Any] = {},
) -> pd.DataFrame:

    config = build_config_from_dict(
        engine, engine_config
    )
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
        raise_error_if_bayesian_ra(stat_a, engine)
        s["baseline_cr"] = stat_a.unadjusted_mean
        s["baseline_mean"] = stat_a.unadjusted_mean
        s["baseline_stddev"] = stat_a.stddev

        # List of users in each variation (used for SRM check)
        users = [0] * num_variations
        users[0] = stat_a.n

        # Loop through each non-baseline variation and run an analysis
        baseline_risk = 0
        for i in range(1, num_variations):
            stat_b: Statistic = variation_statistic_from_metric_row(s, f"v{i}")
            raise_error_if_bayesian_ra(stat_b, engine)

            if isinstance(stat_b, RegressionAdjustedStatistic) and isinstance(
                stat_a, RegressionAdjustedStatistic
            ):
                theta = compute_theta(stat_a, stat_b)
                if theta == 0:
                    # revert to non-RA under the hood if no variance in a time period
                    stat_a = stat_a.post_statistic
                    stat_b = stat_b.post_statistic
                else:
                    stat_a.theta = theta
                    stat_b.theta = theta

            s[f"v{i}_cr"] = stat_b.unadjusted_mean
            s[f"v{i}_expected"] = (
                (stat_b.mean - stat_a.mean) / stat_a.unadjusted_mean
                if stat_a.unadjusted_mean > 0
                else 0
            )
            s[f"v{i}_mean"] = stat_b.unadjusted_mean
            s[f"v{i}_stddev"] = stat_b.stddev

            users[i] = stat_b.n

            # Run the A/B test analysis of baseline vs variation
            if engine == StatsEngine.BAYESIAN:
                if isinstance(stat_a, ProportionStatistic) and isinstance(
                    stat_b, ProportionStatistic
                ):
                    test: BaseABTest = BinomialBayesianABTest(
                        stat_a, stat_b, config=config, inverse=inverse
                    )
                else:
                    test: BaseABTest = GaussianBayesianABTest(
                        stat_a, stat_b, config=config, inverse=inverse
                    )

                res: TestResult = test.compute_result()

                # The baseline risk is the max risk of any of the variation A/B tests
                if res.relative_risk[0] > baseline_risk:
                    baseline_risk = res.relative_risk[0]

                s.at[f"v{i}_rawrisk"] = res.risk
                s[f"v{i}_risk"] = res.relative_risk[1]
                s[f"v{i}_prob_beat_baseline"] = res.chance_to_win
            else:
                if config.sequential:
                    test: BaseABTest = SequentialTwoSidedTTest(
                        stat_a, stat_b, config=config
                    )
                else:
                    test: BaseABTest = TwoSidedTTest(stat_a, stat_b, config=config)
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
                        "denominator": row[f"{prefix}_denominator_sum"],
                        "stats": stats,
                    }
                )
            else:
                dim["variations"].append(
                    {
                        "cr": row[f"{prefix}_cr"],
                        "value": row[f"{prefix}_main_sum"],
                        "users": row[f"{prefix}_users"],
                        "denominator": row[f"{prefix}_denominator_sum"],
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


def variation_statistic_from_metric_row(row: pd.Series, prefix: str) -> Statistic:
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
    elif statistic_type == "mean_ra":
        return RegressionAdjustedStatistic(
            post_statistic=base_statistic_from_metric_row(row, prefix, "main"),
            pre_statistic=base_statistic_from_metric_row(row, prefix, "covariate"),
            post_pre_sum_of_products=row[f"{prefix}_main_covariate_sum_product"],
            n=row[f"{prefix}_users"],
            # Theta should be overriden with correct value later
            theta=0,
        )
    else:
        raise ValueError(
            f"Unexpected statistic_type {statistic_type}' found in experiment data."
        )


def base_statistic_from_metric_row(
    row: pd.Series, prefix: str, component: str
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


def build_config_from_dict(engine, config_dict):
    if engine == StatsEngine.BAYESIAN:
        return BayesianConfig(**config_dict)
    elif engine == StatsEngine.FREQUENTIST:
        return FrequentistConfig(**config_dict)
    else:
        raise ValueError("Impossible stats engine set {engine}")


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
