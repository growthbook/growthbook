from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
from scipy.stats import norm
import copy

from gbstats.utils import multinomial_covariance, third_moments_matrix_vectorized

DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


def multinomial_third_noncentral_moments(
    nu: np.ndarray, index_0: int, index_1: int, index_2: int, n_total: int
) -> float:
    """
    Third moments from multinomial distribution, e.g., E(x[index_0] * x[index_1] * x[index_2])
    from Quiment 2020 https://arxiv.org/pdf/2006.09059 Equation 3.3

    Args:
        nu: Array of probabilities that sum to 1
        index_0, index_1, index_2: Indices for the third moment calculation
        n_total: Total number of trials

    Returns:
        The third moment value
    """
    coef = n_total * (n_total - 1) * (n_total - 2)
    coef_one_diff = n_total * (n_total - 1)

    constant = coef * nu[index_0] * nu[index_1] * nu[index_2]

    if index_0 == index_1 and index_0 == index_2:
        return (
            constant
            + 3 * n_total * (n_total - 1) * nu[index_0] ** 2
            + n_total * nu[index_0]
        )
    elif index_0 == index_1 and index_0 != index_2:
        # case where i == j, but i != l
        return constant + coef_one_diff * nu[index_0] * nu[index_2]
    elif index_1 == index_2 and index_0 != index_2:
        # case where j == l, but i != j
        return constant + coef_one_diff * nu[index_0] * nu[index_1]
    elif index_0 == index_2 and index_0 != index_1:
        return constant + coef_one_diff * nu[index_1] * nu[index_2]
    else:
        return constant


def third_moments_matrix_slow(n: int, nu: np.ndarray) -> np.ndarray:
    """
    Calculate and normalize theoretical third moments matrix for a multinomial distribution.

    Args:
        n: Array of counts

    Returns:
        Normalized matrix of third moments
    """
    num_cells = len(nu)
    # Initialize matrix for theoretical moments
    moments_theoretical_y = np.empty((num_cells, num_cells))

    # Calculate third moments for each cell combination
    for i in range(num_cells):
        for j in range(num_cells):
            moments_theoretical_y[i, j] = multinomial_third_noncentral_moments(
                nu, i, j, j, n
            )

    # Normalize by n_total^3
    nu_mat = moments_theoretical_y / (n**3)

    return nu_mat


class TestMultinomial(TestCase):
    def setUp(self):
        self.seed = 20251204
        rng_nu = np.random.default_rng(seed=self.seed)
        self.num_cells = 5
        nu = rng_nu.uniform(size=self.num_cells)
        nu = nu / np.sum(nu)
        self.nu = nu
        self.size = 1000000
        self.n = 1000

    def test_multinomial_covariance(self):
        rng_data = np.random.default_rng(seed=self.seed + 1)
        data = rng_data.multinomial(n=1, pvals=self.nu, size=self.size)
        v_theoretical = multinomial_covariance(self.nu)
        v_empirical = np.cov(data, rowvar=False, ddof=1)
        self.assertTrue(np.allclose(v_theoretical, v_empirical, atol=1e-3))

    def test_multinomial_third_noncentral_moments(self):
        rng_data = np.random.default_rng(seed=self.seed + 2)
        data = rng_data.multinomial(n=self.n, pvals=self.nu, size=self.size)
        third_moments_theoretical = np.zeros(
            (self.num_cells, self.num_cells, self.num_cells)
        )
        third_moments_empirical = np.zeros(
            (self.num_cells, self.num_cells, self.num_cells)
        )
        for i in range(self.num_cells):
            for j in range(self.num_cells):
                for k in range(self.num_cells):
                    third_moments_theoretical[i, j, k] = (
                        multinomial_third_noncentral_moments(self.nu, i, j, k, self.n)
                    )
                    third_moments_empirical[i, j, k] = np.mean(
                        data[:, i] * data[:, j] * data[:, k]
                    )
        self.assertTrue(
            np.allclose(
                third_moments_theoretical / third_moments_empirical,
                np.ones_like(third_moments_theoretical),
                atol=1e-3,
            )
        )

    def test_third_moments_matrix(self):
        result_true = third_moments_matrix_slow(self.n, self.nu)
        result_fast = third_moments_matrix_vectorized(self.n, self.nu)
        self.assertTrue(np.allclose(result_true, result_fast, atol=1e-16))
