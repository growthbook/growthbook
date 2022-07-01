import numpy as np
from scipy.stats import norm
from typing import Tuple, Dict, Union, List
from .dists import Beta, Norm
from gbstats.bayesian.constants import BETA_PRIOR, NORM_PRIOR, EPSILON


"""
Medium article inspiration:
    https://towardsdatascience.com/how-to-do-bayesian-a-b-testing-fast-41ee00d55be8

Original code:
    https://github.com/itamarfaran/public-sandbox/tree/master/bayesian_blog
"""


def binomial_ab_test(x_a, n_a, x_b, n_b, ccr=0.05):
    alpha_a, beta_a = Beta.posterior(BETA_PRIOR, [x_a, n_a])
    alpha_b, beta_b = Beta.posterior(BETA_PRIOR, [x_b, n_b])

    mean_a, var_a = Beta.moments(alpha_a, beta_a, log=True)
    mean_b, var_b = Beta.moments(alpha_b, beta_b, log=True)

    mean_diff = mean_b - mean_a
    std_diff = np.sqrt(var_a + var_b)

    chance_to_win = norm.sf(0, mean_diff, std_diff)
    expected = np.exp(mean_diff) - 1
    ci = np.exp(norm.ppf([ccr / 2, 1 - ccr / 2], mean_diff, std_diff)) - 1
    risk_beta = Beta.risk(alpha_a, beta_a, alpha_b, beta_b)

    output = {
        "chance_to_win": chance_to_win,
        "expected": expected,
        "ci": ci.tolist(),
        "uplift": {"dist": "lognormal", "mean": mean_diff, "stddev": std_diff},
        "risk": risk_beta.tolist(),
    }

    return output


def gaussian_ab_test(m_a, s_a, n_a, m_b, s_b, n_b, ccr=0.05):
    # Hacky fix to avoid divide by zero errors
    if not _is_std_dev_positive((s_a, s_b)):
        return _default_output()

    mu_a, sd_a = Norm.posterior(NORM_PRIOR, [m_a, s_a, n_a])
    mu_b, sd_b = Norm.posterior(NORM_PRIOR, [m_b, s_b, n_b])

    if _is_log_approximation_inexact(((mu_a, sd_a), (mu_b, sd_b))):
        return _default_output()

    mean_a, var_a = Norm.moments(mu_a, sd_a, log=True)
    mean_b, var_b = Norm.moments(mu_b, sd_b, log=True)

    mean_diff = mean_b - mean_a
    std_diff = np.sqrt(var_a + var_b)

    chance_to_win = norm.sf(0, mean_diff, std_diff)
    expected = np.exp(mean_diff) - 1
    ci = np.exp(norm.ppf([ccr / 2, 1 - ccr / 2], mean_diff, std_diff)) - 1
    risk_norm = Norm.risk(mu_a, sd_a, mu_b, sd_b)

    output = {
        "chance_to_win": chance_to_win,
        "expected": expected,
        "ci": ci.tolist(),
        "uplift": {"dist": "lognormal", "mean": mean_diff, "stddev": std_diff},
        "risk": risk_norm.tolist(),
    }

    return output


def _is_std_dev_positive(std_devs: Tuple[float, float]) -> bool:
    """Check if all standard deviations are positive

    :param Tuple[float, float] std_devs: A tuple of standard deviations (s_a, s_b)
    """
    return all([std_dev > 0 for std_dev in std_devs])


def _is_log_approximation_inexact(
    mean_std_dev_pairs: Tuple[Tuple[float, float], Tuple[float, float]]
) -> bool:
    """Check if any mean-standard deviation pair yields an inexact approximation
    due to a high probability of being negative.

    :param Tuple[Tuple[float, float], Tuple[float, float]] mean_std_dev_pairs:
        A tuple of (mean, standard deviation) tuples.
    """
    return any([norm.cdf(0, pair[0], pair[1]) > EPSILON for pair in mean_std_dev_pairs])


def _default_output() -> Dict[str, Union[float, List, Dict]]:
    """Return uninformative output when AB test analysis can't be performed
    adequately
    """
    return {
        "chance_to_win": 0.5,
        "expected": 0,
        "ci": [0, 0],
        "uplift": {"dist": "lognormal", "mean": 0, "stddev": 0},
        "risk": [0, 0],
    }
