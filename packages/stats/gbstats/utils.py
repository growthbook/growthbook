import importlib.metadata
from typing import List

import packaging.version
from scipy.stats import truncnorm
from scipy.stats.distributions import chi2  # type: ignore


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
