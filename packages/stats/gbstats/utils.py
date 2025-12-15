import importlib.metadata
from typing import List, Optional

import packaging.version
import numpy as np
from scipy.stats import truncnorm
from scipy.stats.distributions import chi2  # type: ignore
from scipy.stats import norm  # type: ignore
import scipy.linalg as la
from dataclasses import dataclass


def check_gbstats_compatibility(nb_version: str) -> None:
    gbstats_version = importlib.metadata.version("gbstats")
    if packaging.version.parse(nb_version) > packaging.version.parse(gbstats_version):
        raise ValueError(
            f"""Current gbstats version: {gbstats_version}. {nb_version} or later is needed.
                Use `pip install gbstats=={nb_version}` to install the needed version."""
        )


def frequentist_diff(mean_a, mean_b, relative, mean_a_unadjusted=None) -> float:
    if not mean_a_unadjusted:
        mean_a_unadjusted = mean_a
    if relative:
        return (mean_b - mean_a) / mean_a_unadjusted
    else:
        return mean_b - mean_a


def frequentist_variance(var_a, mean_a, n_a, var_b, mean_b, n_b, relative) -> float:
    if relative:
        return variance_of_ratios(mean_b, var_b / n_b, mean_a, var_a / n_a, 0)
    else:
        return var_b / n_b + var_a / n_a


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
    if mean_d == 0:
        return 0
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


# given X ~ multinomial(1, nu), what is the covariance matrix of X?
def multinomial_covariance(nu: np.ndarray) -> np.ndarray:
    """
    Calculate the covariance matrix for a multinomial distribution.

    Args:
        nu: A numpy array of probabilities that sum to 1

    Returns:
        A numpy array representing the covariance matrix
    """
    return np.diag(nu) - np.outer(nu, nu)


def third_moments_matrix_vectorized(n_total: int, nu: np.ndarray) -> np.ndarray:
    """
    Calculate and normalize theoretical third moments matrix for a multinomial
    distribution using vectorization.

    The matrix M has elements M[i, j] = E[X[i] * X[j]**2] / n_total**3.

    Args:
        n_total: Total number of trials (n)
        nu: Array of probabilities (p_i) that sum to 1

    Returns:
        Normalized matrix of third moments
    """
    # 1. Prepare constants and basic arrays
    p = nu  # For brevity

    # Coefficients from the general formula for E[X_i X_j^2]
    n_term = n_total
    n_n_1 = n_total * (n_total - 1)
    n_n_1_n_2 = n_n_1 * (n_total - 2)

    # 2. Vectorize the non-diagonal case (i != j)
    # E[X_i X_j^2] where i != j:
    #   = n(n-1)(n-2) * p_i p_j^2 + n(n-1) * p_i p_j

    # Create the outer product matrix p_i * p_j
    # P_outer[i, j] = p_i * p_j
    p_outer = np.outer(p, p)

    # Create the p_j^2 vector (along the columns, representing the 'j' index squared)
    p_j_squared = p**2

    # Matrix of p_i * p_j^2 (broadcast p_i onto p_j^2)
    # P_i_P_j2[i, j] = p_i * p_j^2
    p_i_p_j_2 = np.outer(p, p_j_squared)

    # Calculate the full matrix, ignoring the i=j case for a moment
    # The term 3*n*p_i^2 is from the i=j case and is handled separately.
    moments_all_cases = (
        n_n_1_n_2 * p_i_p_j_2  # Term: n(n-1)(n-2) * p_i p_j^2
        + n_n_1 * p_outer  # Term: n(n-1) * p_i p_j
    )

    # 3. Handle the diagonal case (i = j)
    # E[X_i^3] = n(n-1)(n-2) * p_i^3 + 3 * n(n-1) * p_i^2 + n * p_i

    # The current `moments_all_cases` diagonal is:
    #   n(n-1)(n-2) * p_i^3 + n(n-1) * p_i^2
    # The diagonal elements are missing the following two terms:
    #   + 2 * n(n-1) * p_i^2 + n * p_i
    # (Because the term 3 * n(n-1) * p_i^2 in the formula is only represented by
    # n(n-1) * p_i^2 in the `moments_all_cases` calculation when i=j)

    p_i_squared = p**2
    p_i_term = p

    # Correction term to be added ONLY to the diagonal
    correction = (2 * n_n_1 * p_i_squared) + (n_term * p_i_term)

    # Use np.fill_diagonal to add the correction to the diagonal elements
    np.fill_diagonal(moments_all_cases, moments_all_cases.diagonal() + correction)

    # 4. Normalize by n_total^3
    nu_mat = moments_all_cases / (n_total**3)

    return nu_mat


@dataclass
class MatrixInversionResult:
    """
    Represents the result of a symmetric matrix inversion operation.
    """

    success: bool
    inverse: Optional[np.ndarray] = None
    error: Optional[str] = None


def invert_symmetric_matrix(v: np.ndarray) -> MatrixInversionResult:
    """
    Inverts a symmetric positive-definite matrix and returns a dataclass
    with the result or an error message.

    Args:
        v: A symmetric positive-definite matrix.

    Returns:
        A MatrixInversionResult object containing either the inverse and log_det
        (if successful) or an error message (if unsuccessful).
    """
    n = v.shape[0]
    if v.shape[1] != n:
        return MatrixInversionResult(
            success=False, error="Input matrix must be square."
        )

    try:
        # Compute the Cholesky factorization of v
        v_cholesky = la.cholesky(v, lower=True, check_finite=True)
        # Compute the inverse of v using the Cholesky factorization
        # cho_solve solves Ax=B for x. Here, A is v (via its Cholesky factor)
        # and B is the identity matrix, so x will be inv(v).
        v_inv = la.cho_solve((v_cholesky, True), np.identity(n))

        # Return a success object with the results
        return MatrixInversionResult(
            success=True,
            inverse=v_inv,
        )

    except la.LinAlgError as e:
        # Catch the specific error raised by the LAPACK routine for non-positive-definite matrices
        return MatrixInversionResult(
            success=False, error=f"Matrix is not positive-definite: {e}"
        )
    except Exception as e:
        # Catch any other unexpected errors during computation
        return MatrixInversionResult(
            success=False, error=f"An unexpected error occurred: {e}"
        )
