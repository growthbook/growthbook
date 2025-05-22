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


def random_inverse_wishart(df: float, sai: np.ndarray, seed: int) -> np.ndarray:
    """
    Draw an Inverse Wishart sample.  Uses 2 seeds.

    Args:
        n_row: The dimension of the random variable (e.g., if it's a 3x3 matrix, n_row is 3).
        df: Degrees of freedom (scalar).
        sai: The scale matrix (n_row x n_row, must be symmetric positive-definite).

    Returns:
        w: The random draw (n_row x n_row Inverse Wishart matrix).
    """
    n_row = sai.shape[0]
    if not isinstance(sai, np.ndarray) or sai.shape != (n_row, n_row):
        raise ValueError("sai must be an n_row x n_row numpy array.")
    if df <= n_row - 1:
        raise ValueError("Degrees of freedom (df) must be greater than n_row - 1.")
    if not np.allclose(sai, sai.T):
        raise ValueError("Scale matrix (sai) must be symmetric.")
    # Check for positive definiteness (using Cholesky decomposition as a check)
    try:
        np.linalg.cholesky(sai)
    except np.linalg.LinAlgError:
        raise ValueError("Scale matrix (sai) must be positive-definite.")

    # Invert sai
    sai_inv = np.linalg.inv(sai)

    # Cholesky decomposition of inverse sai
    # numpy.linalg.cholesky returns the lower-triangular Cholesky factor by default.
    sai_inv_chol = np.linalg.cholesky(sai_inv)

    # Construct Z matrix
    z_mat = np.zeros((n_row, n_row))
    gamma_shape = (df - np.arange(n_row)) / 2.0
    gamma_scale = 2.0
    rng = np.random.default_rng(seed)
    rows, cols = np.diag_indices(n_row)
    z_mat[rows, cols] = np.sqrt(rng.gamma(shape=gamma_shape, scale=gamma_scale))
    if n_row > 1:
        rng = np.random.default_rng(seed + 1)
        z_vec = rng.standard_normal(n_row * n_row)
        for i in range(1, n_row):
            for j in range(i):
                z_mat[i, j] = z_vec[i + n_row * j]

    # Matrix multiplication: w_temp = L_inv * Z
    # Where L_inv is sai_inv_chol
    w_temp = sai_inv_chol @ z_mat

    # The C code's `dpotri` inverts a symmetric positive-definite matrix
    # given its Cholesky factorization.
    # Here, `w_temp` is the Cholesky factor of the Wishart sample.
    # So, we need to compute inv(w_temp @ w_temp.T)
    w_wishart = w_temp @ w_temp.T

    # Invert W_wishart to get the Inverse Wishart sample
    w = np.linalg.inv(w_wishart)

    return w
