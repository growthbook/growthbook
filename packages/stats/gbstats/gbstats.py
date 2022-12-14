import math

import pandas as pd
from scipy.stats.distributions import chi2

from gbstats.bayesian.tests import BinomialBayesianABTest, GaussianBayesianABTest
from gbstats.frequentist.tests import TwoSidedTTest
from gbstats.shared.constants import StatsEngine
from gbstats.shared.models import (
    BayesianTestResult,
    FrequentistTestResult,
    Statistic,
    TestResult,
)
from gbstats.shared.tests import BaseABTest


# Calculates a combined standard deviation of two sets of data
# From https://math.stackexchange.com/questions/2971315/how-do-i-combine-standard-deviations-of-two-groups
def correctStddev(n, x, sx, m, y, sy):
    if n + m <= 1:
        return 0

    return math.sqrt(
        ((n - 1) * (sx ** 2) + (m - 1) * (sy ** 2)) / (n + m - 1)
        + (n * m * ((x - y) ** 2)) / ((n + m) * (n + m - 1))
    )


# Combines two means together with proper weighting
def correctMean(n, x, m, y):
    return (n * x + m * y) / (n + m) if (n + m >= 1) else 0


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
    ignore_nulls=False,
    type="binomial",
    needs_correction=True,
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
                dimensions[dim][f"{prefix}_mean"] = 0
                dimensions[dim][f"{prefix}_stddev"] = 0
                dimensions[dim][f"{prefix}_total"] = 0

        # Add this SQL result row into the dimension dict if we recognize the variation
        key = str(row.variation)
        if key in var_id_map:
            i = var_id_map[key]

            stats = {
                "users": row.users,
                "count": row.count,
                "mean": row.mean,
                "stddev": row.stddev,
                "total": row.mean * row.count,
            }

            # Legacy usage of this library required mean/stddev correction
            if needs_correction:
                # Mean/stddev in SQL results are only based on converting users
                # If we need to add in unconverting users, we need to correct the values
                stats = get_adjusted_stats(
                    x=row.mean,
                    sx=row.stddev,
                    c=row.count,
                    n=row.users,
                    ignore_nulls=ignore_nulls,
                    type=type,
                )

            dimensions[dim]["total_users"] += stats["users"]
            prefix = f"v{i}" if i > 0 else "baseline"
            dimensions[dim][f"{prefix}_users"] = stats["users"]
            dimensions[dim][f"{prefix}_count"] = stats["count"]
            dimensions[dim][f"{prefix}_mean"] = stats["mean"]
            dimensions[dim][f"{prefix}_stddev"] = stats["stddev"]
            dimensions[dim][f"{prefix}_total"] = stats["total"]

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
                n = current[f"{prefix}_count"]
                x = current[f"{prefix}_mean"]
                sx = current[f"{prefix}_stddev"]
                m = row[f"{prefix}_count"]
                y = row[f"{prefix}_mean"]
                sy = row[f"{prefix}_stddev"]

                current[f"{prefix}_users"] += row[f"{prefix}_users"]
                current[f"{prefix}_total"] += row[f"{prefix}_total"]
                current[f"{prefix}_count"] += m
                # For mean/stddev, instead of adding, we need to do a statistical correction
                current[f"{prefix}_mean"] = correctMean(n, x, m, y)
                current[f"{prefix}_stddev"] = correctStddev(n, x, sx, m, y, sy)

    return pd.DataFrame(newrows)


# Run A/B test analysis for each variation and dimension
def analyze_metric_df(
    df, weights, type="binomial", inverse=False, engine=StatsEngine.BAYESIAN
):
    num_variations = df.at[0, "variations"]

    # Add new columns to the dataframe with placeholder values
    df["srm_p"] = 0
    df["engine"] = engine.value
    for i in range(num_variations):
        if i == 0:
            df["baseline_cr"] = 0
            df["baseline_risk"] = None
        else:
            df[f"v{i}_cr"] = 0
            df[f"v{i}_expected"] = 0
            df[f"v{i}_p_value"] = None
            df[f"v{i}_rawrisk"] = None
            df[f"v{i}_risk"] = None
            df[f"v{i}_prob_beat_baseline"] = None
            df[f"v{i}_uplift"] = None

    def analyze_row(s):
        s = s.copy()
        # Baseline values
        stat_a = Statistic(
            value=s["baseline_mean"],
            stddev=s["baseline_stddev"],
            n=s["baseline_users"],
            count=s["baseline_count"],
        )
        s["baseline_cr"] = stat_a.value

        # List of users in each variation (used for SRM check)
        users = [0] * num_variations
        users[0] = stat_a.n

        # Loop through each non-baseline variation and run an analysis
        baseline_risk = 0
        for i in range(1, num_variations):
            # Variation values
            stat_b = Statistic(
                value=s[f"v{i}_mean"],
                stddev=s[f"v{i}_stddev"],
                n=s[f"v{i}_users"],
                count=s[f"v{i}_count"],
            )

            s[f"v{i}_cr"] = stat_b.value
            s[f"v{i}_expected"] = (
                (stat_b.value / stat_a.value) - 1 if stat_a.value > 0 else 0
            )

            users[i] = stat_b.n

            # Run the A/B test analysis of baseline vs variation
            if engine == StatsEngine.BAYESIAN:
                if type == "binomial":
                    # TODO consider refactor so binomial test just takes proportions
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
            s.at[f"v{i}_uplift"] = res.uplift.__dict__

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
                        "value": row[f"{prefix}_total"],
                        "users": row[f"{prefix}_users"],
                        "denominator": row[f"{prefix}_count"],
                        "stats": stats,
                    }
                )
            else:
                dim["variations"].append(
                    {
                        "cr": row[f"{prefix}_cr"],
                        "value": row[f"{prefix}_total"],
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


# Adjust metric stats to account for unconverted users
def get_adjusted_stats(x, sx, c, n, ignore_nulls=False, type="binomial"):
    # Binomial metrics always have mean=1 and stddev=0, no need to correct
    if type == "binomial":
        p = c / n if n > 0 else 0
        return {
            "users": n,
            "count": n,
            "mean": p,
            "stddev": math.sqrt(p * (1 - p)),
            "total": c,
        }
    # Ignore unconverted users
    elif ignore_nulls:
        return {"users": c, "count": c, "mean": x, "stddev": sx, "total": c * x}
    # Add in unconverted users and correct the mean/stddev
    else:
        m = n - c
        return {
            "users": n,
            "count": n,
            "mean": correctMean(c, x, m, 0),
            "stddev": correctStddev(c, x, sx, m, 0, 0),
            "total": c * x,
        }


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
