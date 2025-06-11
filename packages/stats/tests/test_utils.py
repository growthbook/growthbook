from unittest import TestCase, main as unittest_main
import numpy as np
from gbstats.utils import random_inverse_wishart, invert_symmetric_matrix
import numpy.testing as npt


class TestUtils(TestCase):
    def test_random_inverse_wishart(self):
        seed = 10
        df = 100
        p = 5
        target_mean = np.eye(p) + np.full((p, p), 0.5)
        nu = 100
        psi = target_mean * (nu - p - 1)

        target_variance = np.zeros((p, p))
        for i in range(p):
            for j in range(p):
                num = (nu - p + 1) * psi[i, j] ** 2 + (nu - p - 1) * psi[i, i] * psi[
                    j, j
                ]
                den = (nu - p) * (nu - p - 1) ** 2 * (nu - p - 3)
                target_variance[i, j] = num / den

        num_samples = 10000
        w_array = np.empty((num_samples, p, p))
        for i in range(num_samples):
            w_array[i, :, :] = random_inverse_wishart(nu, psi, seed=int(2 * i))
        # note that the number of samples is low, so we need to use a higher tolerance.
        # we tested offline with larger number of samples and smaller tolerance.
        a_tol = 1e-2
        r_tol = 1e-2
        npt.assert_allclose(
            np.mean(w_array, axis=0), target_mean, atol=a_tol, rtol=r_tol
        )
        npt.assert_allclose(
            np.var(w_array, axis=0, ddof=1), target_variance, atol=a_tol, rtol=r_tol
        )

    def test_invert_symmetric_matrix(self):
        a_mat = random_inverse_wishart(100, np.eye(6), seed=10)
        a_mat_inv = invert_symmetric_matrix(a_mat)
        a_tol = 1e-10
        npt.assert_allclose(a_mat_inv.dot(a_mat), np.eye(6), atol=a_tol)


if __name__ == "__main__":
    unittest_main()
