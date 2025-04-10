from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
from numpy.testing import assert_allclose
from scipy.stats import multinomial
import copy

from gbstats.utils import multinomial_covariance


class TestMultinomialCovariance(TestCase):
    def test_multinomial_covariance(self):
        # Set random seed for reproducibility
        seed = 20250407
        rng_nu = np.random.default_rng(seed=seed)
        rng_x = np.random.default_rng(seed=seed + 1)
        # Generate random probabilities
        nu = rng_nu.uniform(size=5)
        nu = nu / np.sum(nu)  # Normalize to sum to 1

        # Calculate theoretical covariance
        v_theoretical = multinomial_covariance(nu)

        # Calculate empirical covariance
        n_samples = 200000
        samples = rng_x.multinomial(n=1, pvals=nu, size=n_samples)
        v_empirical = np.cov(samples.T)
        assert_allclose(v_theoretical, v_empirical, atol=1e-3)
