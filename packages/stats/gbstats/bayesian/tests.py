from abc import abstractmethod
from typing import Tuple, Dict, Union, List

import numpy as np
from scipy.stats import norm

from gbstats.bayesian.dists import Beta, Norm
from gbstats.bayesian.constants import BETA_PRIOR, NORM_PRIOR, EPSILON
from gbstats.shared.models import BayesianTestResult, Statistic, Uplift
from gbstats.shared.tests import BaseABTest

"""
Medium article inspiration:
    https://towardsdatascience.com/how-to-do-bayesian-a-b-testing-fast-41ee00d55be8

Original code:
    https://github.com/itamarfaran/public-sandbox/tree/master/bayesian_blog
"""


class BayesianABTest(BaseABTest):
    def __init__(
        self,
        stat_a: Statistic,
        stat_b: Statistic,
        inverse: bool = False,
        ccr: float = 0.05,
    ):
        super().__init__(stat_a, stat_b)
        self.ccr = ccr
        self.inverse = inverse

    @abstractmethod
    def compute_result(self) -> BayesianTestResult:
        pass

    def _default_output(self) -> BayesianTestResult:
        """Return uninformative output when AB test analysis can't be performed
        adequately
        """
        return BayesianTestResult(
            chance_to_win=0.5,
            expected=0,
            ci=[0, 0],
            uplift=Uplift(dist="lognormal", mean=0, stddev=0),
            risk=[0, 0],
            relative_risk=[0, 0],
        )

    def credible_interval(
        self, mean_diff: float, std_diff: float, ccr: float
    ) -> List[float]:
        return (
            np.exp(norm.ppf([ccr / 2, 1 - ccr / 2], mean_diff, std_diff)) - 1
        ).tolist()

    def chance_to_win(self, mean_diff: float, std_diff: float) -> float:
        if self.inverse:
            return 1 - norm.sf(0, mean_diff, std_diff)
        else:
            return norm.sf(0, mean_diff, std_diff)

    def relative_risk(self, risk, m_b):
        # Flip risk and chance to win for inverse metrics
        risk0 = risk[0] if not self.inverse else risk[1]
        risk1 = risk[1] if not self.inverse else risk[0]

        # Turn risk into relative risk
        risk0 = risk0 / m_b if m_b > 0 else 0
        risk1 = risk1 / m_b if m_b > 0 else 0

        return [risk0, risk1]


class BinomialBayesianABTest(BayesianABTest):
    def compute_result(self) -> BayesianTestResult:
        count_a = self.stat_a.value * self.stat_a.n
        count_b = self.stat_b.value * self.stat_b.n

        alpha_a, beta_a = Beta.posterior(BETA_PRIOR, [count_a, self.stat_a.n])
        alpha_b, beta_b = Beta.posterior(BETA_PRIOR, [count_b, self.stat_b.n])

        mean_a, var_a = Beta.moments(alpha_a, beta_a, log=True)
        mean_b, var_b = Beta.moments(alpha_b, beta_b, log=True)

        mean_diff = mean_b - mean_a
        std_diff = np.sqrt(var_a + var_b)

        expected = np.exp(mean_diff) - 1
        risk = Beta.risk(alpha_a, beta_a, alpha_b, beta_b).tolist()

        relative_risk = self.relative_risk(risk, self.stat_b.value)
        ci = self.credible_interval(mean_diff, std_diff, self.ccr)
        ctw = self.chance_to_win(mean_diff, std_diff)

        result = BayesianTestResult(
            chance_to_win=ctw,
            expected=expected,
            ci=ci,
            uplift=Uplift(dist="lognormal", mean=mean_diff, stddev=std_diff),
            risk=risk,
            relative_risk=relative_risk,
        )
        return result


class GaussianBayesianABTest(BayesianABTest):
    def compute_result(self) -> BayesianTestResult:
        if not _is_std_dev_positive((self.stat_a.stddev, self.stat_b.stddev)):
            return self._default_output()

        mu_a, sd_a = Norm.posterior(
            NORM_PRIOR,
            [
                self.stat_a.value,
                self.stat_a.stddev,
                self.stat_a.n,
            ],
        )
        mu_b, sd_b = Norm.posterior(
            NORM_PRIOR,
            [
                self.stat_b.value,
                self.stat_b.stddev,
                self.stat_b.n,
            ],
        )

        if _is_log_approximation_inexact(((mu_a, sd_a), (mu_b, sd_b))):
            return self._default_output()

        mean_a, var_a = Norm.moments(mu_a, sd_a, log=True)
        mean_b, var_b = Norm.moments(mu_b, sd_b, log=True)

        mean_diff = mean_b - mean_a
        std_diff = np.sqrt(var_a + var_b)
        expected = np.exp(mean_diff) - 1

        risk = Norm.risk(mu_a, sd_a, mu_b, sd_b).tolist()

        relative_risk = self.relative_risk(risk, self.stat_b.value)
        ci = self.credible_interval(mean_diff, std_diff, self.ccr)
        ctw = self.chance_to_win(mean_diff, std_diff)

        result = BayesianTestResult(
            chance_to_win=ctw,
            expected=expected,
            ci=ci,
            uplift=Uplift(dist="lognormal", mean=mean_diff, stddev=std_diff),
            risk=risk,
            relative_risk=relative_risk,
        )
        return result


def _is_std_dev_positive(std_devs: Tuple[float, float]) -> bool:
    """Check if all standard deviations are positive

    :param Tuple[float, float] std_devs: A tuple of standard deviations (s_a, s_b)
    """
    return all([std_dev > 0 for std_dev in std_devs])


def _is_log_approximation_inexact(
    mean_std_dev_pairs: Tuple[Tuple[float, float], Tuple[float, float]]
) -> bool:
    """Check if any mean-standard deviation pair yields an inexact approximation
    due to a high probability of being negative.

    :param Tuple[Tuple[float, float], Tuple[float, float]] mean_std_dev_pairs:
        A tuple of (mean, standard deviation) tuples.
    """
    return any([norm.cdf(0, pair[0], pair[1]) > EPSILON for pair in mean_std_dev_pairs])
