import numpy as np
from scipy import linalg
from scipy.special import betaln, eval_jacobi


"""
see scipy.special.orthogonal.
copied source code and implemented log trick to avoid OverflowError
"""


def _gen_roots_and_weights(n, log_mu0, an_func, bn_func, f, df, mu):
    """
    see _gen_roots_and_weights in scipy.special.orthogonal
    """
    k = np.arange(n, dtype="d")
    c = np.zeros((2, n))
    c[0, 1:] = bn_func(k[1:])
    c[1, :] = an_func(k)
    x = linalg.eigvals_banded(c, overwrite_a_band=True)

    # improve roots by one application of Newton's method
    y = f(n, x)
    dy = df(n, x)
    x -= y / dy

    fm = f(n - 1, x)
    fm /= np.abs(fm).max()
    dy /= np.abs(dy).max()
    w = 1.0 / (fm * dy)

    log_w = np.log(w) + log_mu0 - np.log(w.sum())

    if mu:
        return x, log_w, log_mu0
    else:
        return x, log_w


def roots_jacobi(n, alpha, beta):
    """
    Gauss-Jacobi quadrature.
    see scipy.special.root_jacobi
    """

    def an_func(k):
        if a + b == 0.0:
            return np.where(k == 0, (b - a) / (2 + a + b), 0.0)
        return np.where(
            k == 0,
            (b - a) / (2 + a + b),
            (b * b - a * a) / ((2.0 * k + a + b) * (2.0 * k + a + b + 2)),
        )

    def bn_func(k):
        return (
            2.0
            / (2.0 * k + a + b)
            * np.sqrt((k + a) * (k + b) / (2 * k + a + b + 1))
            * np.where(k == 1, 1.0, np.sqrt(k * (k + a + b) / (2.0 * k + a + b - 1)))
        )

    def f(n, x):
        return eval_jacobi(n, a, b, x)

    def df(n, x):
        return 0.5 * (n + a + b + 1) * eval_jacobi(n - 1, a + 1, b + 1, x)

    m = int(n)
    if n < 1 or n != m:
        raise ValueError("n must be a positive integer.")
    if alpha <= -1 or beta <= -1:
        raise ValueError("alpha and beta must be greater than -1.")

    log_mu0 = (alpha + beta + 1) * np.log(2.0) + betaln(alpha + 1, beta + 1)
    a = alpha
    b = beta

    return _gen_roots_and_weights(m, log_mu0, an_func, bn_func, f, df, True)


def roots_sh_jacobi(n, p1, q1, mu=False):
    """
    Gauss-Jacobi (shifted) quadrature.
    see scipy.special.roots_sh_jacobi
    used the log trick to integrate over large values of a,b
    """
    if (p1 - q1) <= -1 or q1 <= 0:
        raise ValueError(
            "(p - q) must be greater than -1, and q must be greater than 0."
        )
    x, log_w, log_m = roots_jacobi(n, p1 - q1, q1 - 1)
    x = (x + 1) / 2
    w = np.exp(log_w - log_m)
    if mu:
        return x, w, 1
    else:
        return x, w
