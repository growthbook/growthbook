import pandas as pd
import math
from .bayesian.main import binomial_ab_test, gaussian_ab_test
from scipy.stats.distributions import chi2


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
def detect_unknown_variations(rows, var_id_map, ignore_delimiter="||"):
    unknown_var_ids = []
    for row in rows.itertuples(index=False):
        id = str(row.variation)
        if ignore_delimiter not in id and id not in var_id_map:
            unknown_var_ids.append(id)
    return set(unknown_var_ids)


# Looks for rows with multiple variations and sums up the number of users
def detect_multiple_exposures(rows, delimiter="||"):
    multiple_exposures = 0
    for row in rows.itertuples(index=False):
        id = str(row.variation)
        if delimiter in id:
            multiple_exposures = multiple_exposures + row.users
    return multiple_exposures


# Transform raw SQL result for metrics into a dataframe of dimensions
def get_metric_df(rows, var_id_map, var_names, ignore_nulls=False, type="binomial"):
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
def analyze_metric_df(df, weights, type="binomial", inverse=False):
    num_variations = df.at[0, "variations"]

    # Add new columns to the dataframe with placeholder values
    df["srm_p"] = 0
    for i in range(num_variations):
        if i == 0:
            df["baseline_cr"] = 0
            df["baseline_risk"] = 0
        else:
            df[f"v{i}_cr"] = 0
            df[f"v{i}_expected"] = 0
            df[f"v{i}_risk"] = 0
            df[f"v{i}_prob_beat_baseline"] = 0
            df[f"v{i}_uplift"] = None

    def analyze_row(s):
        s = s.copy()
        # Baseline values
        n_a = s["baseline_users"]
        m_a = s["baseline_mean"]
        x_a = s["baseline_count"]
        s_a = s["baseline_stddev"]
        cr_a = s["baseline_total"] / n_a if n_a > 0 else 0

        s["baseline_cr"] = cr_a

        # List of users in each variation (used for SRM check)
        users = [0] * num_variations
        users[0] = n_a

        # Loop through each non-baseline variation and run an analysis
        baseline_risk = 0
        for i in range(1, num_variations):
            # Variation values
            n_b = s[f"v{i}_users"]
            m_b = s[f"v{i}_mean"]
            x_b = s[f"v{i}_count"]
            s_b = s[f"v{i}_stddev"]
            cr_b = s[f"v{i}_total"] / n_b if n_b > 0 else 0

            s[f"v{i}_cr"] = cr_b
            s[f"v{i}_expected"] = (cr_b / cr_a) - 1 if cr_a > 0 else 0

            users[i] = n_b

            # Run the A/B test analysis of baseline vs variation
            if type == "binomial":
                res = binomial_ab_test(x_a, n_a, x_b, n_b)
            else:
                res = gaussian_ab_test(m_a, s_a, n_a, m_b, s_b, n_b)

            # Flip risk and chance to win for inverse metrics
            risk0 = res["risk"][0] if not inverse else res["risk"][1]
            risk1 = res["risk"][1] if not inverse else res["risk"][0]
            ctw = res["chance_to_win"] if not inverse else 1 - res["chance_to_win"]

            # Turn risk into relative risk
            risk0 = risk0 / cr_b if cr_b > 0 else 0
            risk1 = risk1 / cr_b if cr_b > 0 else 0

            # The baseline risk is the max risk of any of the variation A/B tests
            if risk0 > baseline_risk:
                baseline_risk = risk0

            s[f"v{i}_risk"] = risk1
            s[f"v{i}_prob_beat_baseline"] = ctw
            s.at[f"v{i}_ci"] = res["ci"]
            s.at[f"v{i}_rawrisk"] = res["risk"]
            s.at[f"v{i}_uplift"] = res["uplift"]

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
                        "stats": stats,
                    }
                )
            else:
                dim["variations"].append(
                    {
                        "cr": row[f"{prefix}_cr"],
                        "value": row[f"{prefix}_total"],
                        "users": row[f"{prefix}_users"],
                        "expected": row[f"{prefix}_expected"],
                        "chanceToWin": row[f"{prefix}_prob_beat_baseline"],
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
        return {"users": n, "count": c, "mean": 1, "stddev": 0, "total": c}
    # Ignore unconverted users
    elif ignore_nulls:
        return {"users": c, "count": c, "mean": x, "stddev": sx, "total": c * x}
    # Add in unconverted users and correct the mean/stddev
    else:
        m = n - c
        return {
            "users": n,
            "count": c,
            "mean": correctMean(c, x, m, 0),
            "stddev": correctStddev(c, x, sx, m, 0, 0),
            "total": c * x,
        }


# @deprecated
# Transform raw SQL result for metrics into a list of stats per variation
def process_metric_rows(rows, var_id_map, users, ignore_nulls=False, type="binomial"):
    stats = [{"users": 0, "count": 0, "mean": 0, "stddev": 0, "total": 0}] * len(
        var_id_map.keys()
    )
    for row in rows.itertuples(index=False):
        id = str(row.variation)
        if id in var_id_map:
            variation = var_id_map[id]
            stats[variation] = get_adjusted_stats(
                x=row.mean,
                sx=row.stddev,
                c=row.count,
                n=users[variation],
                ignore_nulls=ignore_nulls,
                type=type,
            )
    return pd.DataFrame(stats)


# @deprecated
# Transform raw SQL result for users into a list of num_users per variation
def process_user_rows(rows, var_id_map):
    users = [0] * len(var_id_map.keys())
    unknown_var_ids = []
    for row in rows.itertuples(index=False):
        id = str(row.variation)
        if id in var_id_map:
            variation = var_id_map[id]
            users[variation] = row.users
        else:
            unknown_var_ids.append(id)
    return users, unknown_var_ids


# @deprecated
# Run A/B test analysis for a metric
def run_analysis(metric, var_names, type="binomial", inverse=False):
    vars = iter(metric.itertuples(index=False))
    baseline = next(vars)

    # baseline users, mean, count, stddev, and value
    n_a = baseline.users
    m_a = baseline.mean
    x_a = baseline.count
    s_a = baseline.stddev
    v_a = baseline.total

    cr_a = v_a / n_a

    ret = pd.DataFrame(
        [
            {
                "variation": var_names[0],
                "users": n_a,
                "total": v_a,
                "per_user": cr_a,
                "chance_to_beat_control": None,
                "risk_of_choosing": None,
                "percent_change": None,
                "uplift_dist": None,
                "uplift_mean": None,
                "uplift_stddev": None,
            }
        ]
    )

    baseline_risk = 0
    for i, row in enumerate(vars):
        # variation users, mean, count, stddev, and value
        n_b = row.users
        m_b = row.mean
        x_b = row.count
        s_b = row.stddev
        v_b = row.total
        cr_b = v_b / n_b

        if type == "binomial":
            res = binomial_ab_test(x_a, n_a, x_b, n_b)
        else:
            res = gaussian_ab_test(m_a, s_a, n_a, m_b, s_b, n_b)

        # Flip risk and chance to win for inverse metrics
        risk0 = res["risk"][0] if not inverse else res["risk"][1]
        risk1 = res["risk"][1] if not inverse else res["risk"][0]
        ctw = res["chance_to_win"] if not inverse else 1 - res["chance_to_win"]

        # Turn risk into relative risk
        risk0 = risk0 / cr_b
        risk1 = risk1 / cr_b

        if risk0 > baseline_risk:
            baseline_risk = risk0

        s = pd.Series(
            {
                "variation": var_names[i + 1],
                "users": n_b,
                "total": v_b,
                "per_user": cr_b,
                "chance_to_beat_control": ctw,
                "risk_of_choosing": risk1,
                "percent_change": res["expected"],
                "uplift_dist": res["uplift"]["dist"],
                "uplift_mean": res["uplift"]["mean"],
                "uplift_stddev": res["uplift"]["stddev"],
            }
        )

        ret = ret.append(s, ignore_index=True)

    ret.at[0, "risk_of_choosing"] = baseline_risk

    # Rename columns for binomial metrics
    if type == "binomial":
        ret.rename(
            columns={"total": "conversions", "per_user": "conversion_rate"},
            inplace=True,
        )

    return ret


# Run a chi-squared test to make sure the observed traffic split matches the expected one
def check_srm(users, weights):
    # Convert count of users into ratios
    total_observed = sum(users)
    if not total_observed:
        return 1

    x = 0
    for i, o in enumerate(users):
        e = weights[i] * total_observed
        x = x + ((o - e) ** 2) / e

    return chi2.sf(x, len(users) - 1)
