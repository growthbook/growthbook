import numpy as np
from scipy.stats import norm
from .dists import Beta, Norm


"""
Medium article inspiration:
    https://towardsdatascience.com/how-to-do-bayesian-a-b-testing-fast-41ee00d55be8

Original code:
    https://github.com/itamarfaran/public-sandbox/tree/master/bayesian_blog
"""


BETA_PRIOR = 1, 1
NORM_PRIOR = 0, 1, 0


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
    mu_a, sd_a = Norm.posterior(NORM_PRIOR, [m_a, s_a, n_a])
    mu_b, sd_b = Norm.posterior(NORM_PRIOR, [m_b, s_b, n_b])

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
