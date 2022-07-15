from abc import ABC, abstractmethod
from typing import Tuple
from warnings import warn

import numpy as np
from scipy.stats import beta, norm, rv_continuous
from scipy.special import digamma, polygamma, roots_hermitenorm

from .orthogonal import roots_sh_jacobi
from gbstats.bayesian.constants import EPSILON, NORM_PRIOR


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

        return out


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

    def __init__(self, mean: float, std_dev: float, num_observations: int) -> None:
        self.mean = mean
        self.std_dev = std_dev
        self.num_observations = num_observations
        self.posterior_mean = None
        self.posterior_std_dev = None

    def get_posterior(self, prior) -> Tuple[float, float]:
        """Get the posterior by updating the prior with the collected data"""
        inv_var_0 = prior[2] / np.power(prior[1], 2)
        inv_var_d = self.num_observations / np.power(self.std_dev, 2)
        var = 1 / (inv_var_0 + inv_var_d)

        self.posterior_mean = var * (inv_var_0 * prior[0] + inv_var_d * self.mean)
        self.posterior_std_dev = np.sqrt(var)
        return self.posterior_mean, self.posterior_std_dev

    @staticmethod
    def posterior():
        pass

    @staticmethod
    def moments():
        pass

    @staticmethod
    def gq(n, par1, par2):
        if par2 <= 0:
            raise RuntimeError("got negative standard deviation.")

        x, w, m = roots_hermitenorm(int(n), True)
        x = par2 * x + par1
        w /= m
        return x, w
