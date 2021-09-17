import pandas as pd
import math
from .bayesian.main import binomial_ab_test, gaussian_ab_test
from scipy.stats.distributions import chi2


# Adjust metric stats to account for unconverted users
def get_adjusted_stats(x, sx, c, n, ignore_nulls=False):
    # Ignore unconverted users
    if ignore_nulls:
        return {"users": c, "count": c, "mean": x, "stddev": sx}
    # Add in unconverted users and correct the mean/stddev
    else:
        mean = (x * c) / n
        varx = sx ** 2
        # From https://math.stackexchange.com/questions/2971315/how-do-i-combine-standard-deviations-of-two-groups
        stddev = math.sqrt(
            ((c - 1) * varx) / (n - 1) + (c * (n - c) * (x ** 2)) / (n * (n - 1))
        )

        return {"users": n, "count": c, "mean": mean, "stddev": stddev}


# Transform raw SQL result for metrics into a list of stats per variation
def process_metric_rows(rows, vars, users, ignore_nulls=False):
    stats = [{"users": 0, "count": 0, "mean": 0, "stddev": 0}] * len(vars.keys())
    for row in rows.itertuples(index=False):
        key = str(row.variation)
        if key in vars:
            variation = vars[key]
            stats[variation] = get_adjusted_stats(
                x=row.mean,
                sx=row.stddev,
                c=row.count,
                n=users[variation],
                ignore_nulls=ignore_nulls,
            )
    return pd.DataFrame(stats)


# Transform raw SQL result for users into a list of num_users per variation
def process_user_rows(rows, vars):
    users = [0] * len(vars.keys())
    unknown_vars = []
    for row in rows.itertuples(index=False):
        key = str(row.variation)
        if key in vars:
            variation = vars[key]
            users[variation] = row.users
        else:
            unknown_vars.append(key)
    return users, unknown_vars


# Run A/B test analysis for a metric
def run_analysis(metric, var_names, type="binomial", inverse=False):
    vars = iter(metric.itertuples(index=False))
    baseline = next(vars)

    # baseline users, mean, count, stddev, and value
    n_a = baseline.users
    m_a = baseline.mean
    x_a = baseline.count
    s_a = baseline.stddev
    v_a = m_a * x_a

    ret = pd.DataFrame(
        [
            {
                "variation": var_names[0],
                "users": n_a,
                "total": v_a,
                "per_user": v_a / n_a,
                "chance_to_beat_control": None,
                "risk_of_choosing": None,
                "uplift_mean": None,
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
        v_b = m_b * x_b

        if type == "binomial":
            res = binomial_ab_test(x_a, n_a, x_b, n_b)
        else:
            res = gaussian_ab_test(m_a, s_a, n_a, m_b, s_b, n_b)

        if res["risk"][0] > baseline_risk:
            baseline_risk = res["risk"][0] if not inverse else res["risk"][1]

        s = pd.Series(
            {
                "variation": var_names[i + 1],
                "users": n_b,
                "total": v_b,
                "per_user": v_b / n_b,
                "chance_to_beat_control": res["chance_to_win"]
                if not inverse
                else 1 - res["chance_to_win"],
                "risk_of_choosing": res["risk"][1] if not inverse else res["risk"][0],
                "uplift_mean": res["expected"],
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
