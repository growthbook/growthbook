from abc import ABC, abstractmethod
from typing import Tuple
from warnings import warn
import numpy as np
from numpy import vectorize, ndarray
from scipy.stats import rv_continuous, beta, norm
from scipy.special import digamma, polygamma, roots_hermitenorm
from orthogonal import roots_sh_jacobi


EPSILON = 1e-04


class BayesABDist(ABC):
    dist: rv_continuous

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
    def risk(cls, par_a1, par_a2, par_b1, par_b2, n=24):
        """
        :type par_a1: float
        :type par_a2: float
        :type par_b1: float
        :type par_b2: float
        :type n: int
        :rtype: ndarray
        """
        nodes_a, weights_a = cls.gq(n, par_a1, par_a2)
        nodes_b, weights_b = cls.gq(n, par_b1, par_b2)

        gq = sum(nodes_a * cls.dist.cdf(nodes_a, par_b1, par_b2) * weights_a) + \
            sum(nodes_b * cls.dist.cdf(nodes_b, par_a1, par_a2) * weights_b)
        out = gq - cls.dist.mean((par_a1, par_b1), (par_a2, par_b2))

        return out


class Beta(BayesABDist):
    dist = beta

    @staticmethod
    def moments(par1, par2, log=False):
        if log:
            mean = par1 / (par1 + par2)
            var = par1 * par2 / (np.power(par1 + par2, 2) * (par1 + par2 + 1))
        else:
            mean = digamma(par1) - digamma(par1 + par2)
            var = polygamma(1, par1) - polygamma(1, par1 + par2)
        return mean, var

    @staticmethod
    def gq(n, par1, par2):
        x, w = roots_sh_jacobi(int(n), par1 + par2 - 1, par1, False)
        return x, w


class Norm(BayesABDist):
    dist = norm

    @staticmethod
    def moments(par1, par2, log=False):
        if log:
            if np.sum(norm.cdf(0, par1, par2) > EPSILON):
                warn(f'probability of being negative is higher than {EPSILON}. log approximation is in-exact')
            mean = np.log(par1)
            var = np.power(par2 / par1, 2)
        else:
            mean = par1
            var = np.power(par2, 2)
        return mean, var

    @staticmethod
    def gq(n, par1, par2):
        x, w, m = roots_hermitenorm(int(n), True)
        x = par2 * x + par1
        w /= m
        return x, w
