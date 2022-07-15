from typing import Tuple, Dict, Union, List

import numpy as np
from numpy.random import normal
from scipy.stats import norm

# from .dists import Beta, Norm
from gbstats.bayesian.dists import Beta, Norm
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

    a_distribution = Norm(mean=m_a, std_dev=s_a, num_observations=n_a)
    b_distribution = Norm(mean=m_b, std_dev=s_b, num_observations=n_b)

    posterior_mean_a, posterior_std_dev_a = a_distribution.get_posterior(NORM_PRIOR)
    posterior_mean_b, posterior_std_dev_b = b_distribution.get_posterior(NORM_PRIOR)

    output = _calculate_output_kpis(
        posterior_mean_a,
        posterior_std_dev_a,
        posterior_mean_b,
        posterior_std_dev_b,
        ccr=ccr,
    )

    return output


def _calculate_output_kpis(
    posterior_mean_a: float,
    posterior_std_dev_a: float,
    posterior_mean_b: float,
    posterior_std_dev_b: float,
    ccr: float,
) -> dict:
    """Calculates the output KPIs either through log-approximation or MCMC simulation"""
    # We can't do log approximation with negative values so we do MCMC
    if posterior_mean_a <= 0 or posterior_mean_b <= 0:
        output = _get_mcmc_output(
            posterior_mean_a,
            posterior_std_dev_a,
            posterior_mean_b,
            posterior_std_dev_b,
            ccr,
        )
        return output

    # The posterior mean is positive, but we can't assure an appropriate
    # log approximation given how close it is to being negative
    if _is_log_approximation_inexact(
        (
            (posterior_mean_a, posterior_std_dev_a),
            (posterior_mean_b, posterior_std_dev_b),
        )
    ):
        return _default_output()

    # We have a positive mean that can be correctly log-approximated so we
    # do so as doing MCMC is computationally demanding
    output = _get_log_approximation_output(
        posterior_mean_a,
        posterior_std_dev_a,
        posterior_mean_b,
        posterior_std_dev_b,
        ccr,
    )
    return output


def _get_mcmc_output(
    posterior_mean_a: float,
    posterior_std_dev_a: float,
    posterior_mean_b: float,
    posterior_std_dev_b: float,
    ccr: float,
    num_draws: int = 20000,
) -> Dict[str, Union[float, List, Dict]]:
    """Calculate the output experiment KPIs through MCMC simulations"""
    simulation_a = normal(
        loc=posterior_mean_a, scale=posterior_std_dev_a, size=num_draws
    )
    simulation_b = normal(
        loc=posterior_mean_b, scale=posterior_std_dev_b, size=num_draws
    )

    relative_difference = (simulation_b - simulation_a) / np.abs(simulation_a)

    mean_diff = np.mean(relative_difference)
    std_diff = np.std(relative_difference)

    output = dict(
        chance_to_win=np.mean(simulation_b > simulation_a),
        expected=mean_diff.copy(),
        ci=np.exp(norm.ppf([ccr / 2, 1 - ccr / 2], mean_diff, std_diff)) - 1,
        uplift={"dist": "lognormal", "mean": mean_diff, "stddev": std_diff},
        risk=list(
            Norm.risk(
                posterior_mean_a,
                posterior_std_dev_a,
                posterior_mean_b,
                posterior_std_dev_b,
            )
        ),
    )

    return output


def _get_log_approximation_output(
    posterior_mean_a: float,
    posterior_std_dev_a: float,
    posterior_mean_b: float,
    posterior_std_dev_b: float,
    ccr: float,
) -> Dict[str, Union[float, List, Dict]]:
    mean_a, variance_a = _get_log_approximated_moments(
        posterior_mean_a, posterior_std_dev_a
    )
    mean_b, variance_b = _get_log_approximated_moments(
        posterior_mean_b, posterior_std_dev_b
    )

    mean_diff = mean_b - mean_a
    std_diff = np.sqrt(variance_a + variance_b)

    output = dict(
        chance_to_win=norm.sf(0, mean_diff, std_diff),
        expected=np.exp(mean_diff) - 1,
        ci=np.exp(norm.ppf([ccr / 2, 1 - ccr / 2], mean_diff, std_diff)) - 1,
        uplift={"dist": "lognormal", "mean": mean_diff, "stddev": std_diff},
        risk=list(
            Norm.risk(
                posterior_mean_a,
                posterior_std_dev_a,
                posterior_mean_b,
                posterior_std_dev_b,
            )
        ),
    )

    return output


def _get_log_approximated_moments(mean: float, std_dev: float) -> Tuple[float, float]:
    """Get posterior moments through log approximation"""
    log_approx_mean = np.log(mean)
    log_approx_variance = np.power(std_dev / mean, 2)

    return log_approx_mean, log_approx_variance


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
