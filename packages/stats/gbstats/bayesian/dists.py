from abc import ABC, abstractmethod
from warnings import warn
import numpy as np
from scipy.stats import beta, norm, rv_continuous
from scipy.special import digamma, polygamma, roots_hermitenorm
from .orthogonal import roots_sh_jacobi
from gbstats.bayesian.constants import EPSILON


class BayesABDist(ABC):
    dist: rv_continuous

    @staticmethod
    @abstractmethod
    def posterior(prior, data):
        """
        :type prior: Iterable
        :type data: Iterable
        :rtype: Tuple[ndarray, ndarray]
        """
        raise NotImplementedError

    @staticmethod
    @abstractmethod
    def moments(par1, par2, log=False):
        """
        :type par1: float or ndarray
        :type par2: float or ndarray
        :type log: bool
        :rtype: Tuple[float or ndarray, float or ndarray]
        """
        raise NotImplementedError

    @staticmethod
    @abstractmethod
    def gq(n, par1, par2):
        """
        :type n: int
        :type par1: float
        :type par2: float
        :rtype: Tuple[ndarray, ndarray]
        """
        raise NotImplementedError

    # todo: @vectorize
    @classmethod
    def risk(cls, a_par1, a_par2, b_par1, b_par2, n=24):
        """
        :type a_par1: float
        :type a_par2: float
        :type b_par1: float
        :type b_par2: float
        :type n: int
        :rtype: ndarray
        """
        a_nodes, a_weights = cls.gq(n, a_par1, a_par2)
        b_nodes, b_weights = cls.gq(n, b_par1, b_par2)

        gq = sum(a_nodes * cls.dist.cdf(a_nodes, b_par1, b_par2) * a_weights) + sum(
            b_nodes * cls.dist.cdf(b_nodes, a_par1, a_par2) * b_weights
        )
        out = gq - cls.dist.mean((a_par1, b_par1), (a_par2, b_par2))

        return np.maximum(out, 0)


class Beta(BayesABDist):
    dist = beta

    @staticmethod
    def posterior(prior, data):
        a = prior[0] + data[0]
        b = prior[1] + data[1] - data[0]
        return a, b

    @staticmethod
    def moments(par1, par2, log=False):
        if np.sum(par2 < 0) + np.sum(par1 < 0):
            raise RuntimeError("params of beta distribution cannot be negative")

        if log:
            mean = digamma(par1) - digamma(par1 + par2)
            var = polygamma(1, par1) - polygamma(1, par1 + par2)
        else:
            mean = par1 / (par1 + par2)
            var = par1 * par2 / (np.power(par1 + par2, 2) * (par1 + par2 + 1))
        return mean, var

    @staticmethod
    def gq(n, par1, par2):
        x, w = roots_sh_jacobi(int(n), par1 + par2 - 1, par1, False)
        return x, w


class Norm(BayesABDist):
    dist = norm

    @staticmethod
    def posterior(prior, data):
        inv_var_0 = prior[2] / np.power(prior[1], 2)
        inv_var_d = data[2] / np.power(data[1], 2)
        var = 1 / (inv_var_0 + inv_var_d)

        loc = var * (inv_var_0 * prior[0] + inv_var_d * data[0])
        scale = np.sqrt(var)
        return loc, scale

    @staticmethod
    def moments(par1, par2, log=False):
        if np.sum(par2 < 0):
            raise RuntimeError("got negative standard deviation.")

        if log:
            if np.sum(par1 <= 0):
                raise RuntimeError("got mu <= 0. cannot use log approximation.")

            max_prob = np.max(norm.cdf(0, par1, par2))
            if max_prob > EPSILON:
                warn(
                    f"probability of being negative is higher than {EPSILON} (={max_prob}). "
                    f"log approximation is in-exact",
                    RuntimeWarning,
                )

            mean = np.log(par1)
            var = np.power(par2 / par1, 2)
        else:
            mean = par1
            var = np.power(par2, 2)
        return mean, var

    @staticmethod
    def gq(n, par1, par2):
        if par2 <= 0:
            raise RuntimeError("got negative standard deviation.")

        x, w, m = roots_hermitenorm(int(n), True)
        x = par2 * x + par1
        w /= m
        return x, w
