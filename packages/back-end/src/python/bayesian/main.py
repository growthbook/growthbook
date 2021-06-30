import sys
import json
import numpy as np
from scipy.stats import norm, beta
from scipy.special import digamma, polygamma, roots_hermitenorm
from orthogonal import roots_sh_jacobi


"""
Medium article inspiration: 
    https://towardsdatascience.com/how-to-do-bayesian-a-b-testing-fast-41ee00d55be8
Original code:
    https://github.com/itamarfaran/public-sandbox/tree/master/bayesian_blog
"""


def log_beta_mean(a, b): return digamma(a) - digamma(a + b)
def var_beta_mean(a, b): return polygamma(1, a) - polygamma(1, a + b)


def beta_gq(n, a, b):
    x, w, m = roots_sh_jacobi(n, a + b - 1, a, True)
    w /= m
    return x, w


def norm_gq(n, loc, scale):
    x, w, m = roots_hermitenorm(n, True)
    x = scale * x + loc
    w /= m
    return x, w


def binomial_ab_test(x_a, n_a, x_b, n_b):
    # Uninformative prior
    alpha_0, beta_0 = 1, 1

    # Updating prior with data
    alpha_a = alpha_0 + x_a
    beta_a = beta_0 + n_a - x_a

    alpha_b = alpha_0 + x_b
    beta_b = beta_0 + n_b - x_b

    # Chance to win
    d1_beta = norm(
        loc=beta.mean(alpha_b, beta_b) - beta.mean(alpha_a, beta_a),
        scale=np.sqrt(beta.var(alpha_b, beta_b) + beta.var(alpha_a, beta_a))
    )

    # Credible Interval
    ci_mean = log_beta_mean(alpha_b, beta_b) - log_beta_mean(alpha_a, beta_a)
    ci_std = np.sqrt(var_beta_mean(alpha_b, beta_b) +
                     var_beta_mean(alpha_a, beta_a))
    d2_beta = norm(
        loc=ci_mean,
        scale=ci_std
    )

    # Risk
    nodes_a, weights_a = beta_gq(24, alpha_a, beta_a)
    nodes_b, weights_b = beta_gq(24, alpha_b, beta_b)
    gq = sum(nodes_a * beta.cdf(nodes_a, alpha_b, beta_b) * weights_a) + \
        sum(nodes_b * beta.cdf(nodes_b, alpha_a, beta_a) * weights_b)
    risk_beta = gq - beta.mean((alpha_a, alpha_b), (beta_a, beta_b))

    return {
        "chance_to_win": d1_beta.sf(0),
        "expected": (np.exp(d2_beta.ppf(0.5)) - 1),
        "ci": (np.exp(d2_beta.ppf((.025, .975))) - 1).tolist(),
        "uplift": {
            "dist": "lognormal",
            "mean": ci_mean,
            "stddev": ci_std,
        },
        "risk": risk_beta.tolist()
    }


def gaussian_ab_test(n_a, m_a, s_a, n_b, m_b, s_b):
    # Uninformative prior
    mu0, s0, n0 = 0, 1, 0

    # Update the prior
    inv_vars = n0 / np.power(s0, 2), n_a / np.power(s_a, 2)
    mu_a = np.average((mu0, m_a), weights=inv_vars)
    sd_a = 1 / np.sqrt(np.sum(inv_vars))

    inv_vars = n0 / np.power(s0, 2), n_b / np.power(s_b, 2)
    mu_b = np.average((mu0, m_b), weights=inv_vars)
    sd_b = 1 / np.sqrt(np.sum(inv_vars))

    # Chance to win
    d1_norm = norm(loc=mu_b - mu_a, scale=np.sqrt(sd_a ** 2 + sd_b ** 2))

    # Credible interval
    ci_mean = np.log(mu_b) - np.log(mu_a)
    ci_std = np.sqrt((sd_a / mu_a)**2 + (sd_b / mu_b)**2)
    d2_norm = norm(loc=ci_mean, scale=ci_std)

    # Risk
    nodes_a, weights_a = norm_gq(24, mu_a, sd_a)
    nodes_b, weights_b = norm_gq(24, mu_b, sd_b)

    gq = sum(nodes_a * norm.cdf(nodes_a, mu_b, sd_b) * weights_a) + \
        sum(nodes_b * norm.cdf(nodes_b, mu_a, sd_a) * weights_b)
    risk_norm = gq - norm.mean((mu_a, mu_b))

    return {
        "chance_to_win": d1_norm.sf(0),
        "expected": (np.exp(d2_norm.ppf(0.5)) - 1),
        "ci": (np.exp(d2_norm.ppf((.025, .975))) - 1).tolist(),
        "uplift": {
            "dist": "lognormal",
            "mean": ci_mean,
            "stddev": ci_std,
        },
        "risk": risk_norm.tolist()
    }


# python main.py binomial \
#   '{"users":[1283,1321],"count":[254,289],"mean":[52.3,14.1],"stddev":[14.1,13.7]}'
# python main.py normal \
#   '{"users":[1283,1321],"count":[254,289],"mean":[52.3,14.1],"stddev":[14.1,13.7]}'
if __name__ == '__main__':
    metric = sys.argv[1]
    data = json.loads(sys.argv[2])

    x_a, x_b = data["count"]
    n_a, n_b = data["users"]
    m_a, m_b = data["mean"]
    s_a, s_b = data["stddev"]

    if metric == 'binomial':
        print(json.dumps(binomial_ab_test(
            x_a, n_a, x_b, n_b
        )))

    else:
        print(json.dumps(gaussian_ab_test(
            n_a, m_a, s_a, n_b, m_b, s_b
        )))
