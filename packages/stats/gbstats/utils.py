import importlib.metadata
from typing import List

import packaging.version
import numpy as np
from scipy.stats import truncnorm
from scipy.stats.distributions import chi2  # type: ignore
from scipy.stats import norm  # type: ignore


def check_gbstats_compatibility(nb_version: str) -> None:
    gbstats_version = importlib.metadata.version("gbstats")
    if packaging.version.parse(nb_version) > packaging.version.parse(gbstats_version):
        raise ValueError(
            f"""Current gbstats version: {gbstats_version}. {nb_version} or later is needed.
                Use `pip install gbstats=={nb_version}` to install the needed version."""
        )


def truncated_normal_mean(mu, sigma, a, b) -> float:
    # parameterized in scipy.stats as number of sds from mu
    # rescaling for readability
    a, b = (a - mu) / sigma, (b - mu) / sigma
    mn, _, _, _ = truncnorm.stats(a, b, loc=mu, scale=sigma, moments="mvsk")
    return float(mn)


# given numerator random variable M (mean = mean_m, var = var_m),
# denominator random variable D (mean = mean_d, var = var_d),
# and covariance cov_m_d, what is the variance of M / D?
def variance_of_ratios(mean_m, var_m, mean_d, var_d, cov_m_d) -> float:
    return (
        var_m / mean_d**2
        + var_d * mean_m**2 / mean_d**4
        - 2 * cov_m_d * mean_m / mean_d**3
    )


# Run a chi-squared test to make sure the observed traffic split matches the expected one
def check_srm(users: List[int], weights: List[float]) -> float:
    # Convert count of users into ratios
    total_observed = sum(users)
    if not total_observed:
        return 1

    total_weight = sum(weights)
    x = 0
    for i, o in enumerate(users):
        if weights[i] <= 0:
            continue
        e = weights[i] / total_weight * total_observed
        x = x + ((o - e) ** 2) / e

    return chi2.sf(x, len(users) - 1)  # type: ignore


def gaussian_credible_interval(
    mean_diff: float, std_diff: float, alpha: float
) -> List[float]:
    ci = norm.ppf([alpha / 2, 1 - alpha / 2], mean_diff, std_diff)
    return ci.tolist()


def weighted_mean(
    n_0: np.ndarray, n_1: np.ndarray, mn_0: np.ndarray, mn_1: np.ndarray
) -> np.ndarray:
    n = n_0 + n_1
    positive_counts = n > 0
    mn = np.zeros((len(mn_0),))
    mn[positive_counts] = (
        n_0[positive_counts] * mn_0[positive_counts]
        + n_1[positive_counts] * mn_1[positive_counts]
    ) / (n_0[positive_counts] + n_1[positive_counts])
    return mn


# Remove when upgrading to Python 3.10
def isinstance_union(obj, union):
    if hasattr(union, "__args__"):
        return any(isinstance(obj, arg) for arg in union.__args__)
    return isinstance(obj, union)


def is_statistically_significant(ci: List[float]) -> bool:
    return ci[0] > 0 or ci[1] < 0


def chance_to_win(mean_diff: float, std_diff: float, inverse: bool) -> float:
    if inverse:
        return 1 - norm.sf(0, mean_diff, std_diff)  # type: ignore
    else:
        return norm.sf(0, mean_diff, std_diff)  # type: ignore
