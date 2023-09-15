from abc import abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Union

import numpy as np
from scipy.stats import norm  # type: ignore


from gbstats.messages import (
    BASELINE_VARIATION_ZERO_MESSAGE,
    LOG_APPROXIMATION_INEXACT_MESSAGE,
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    NO_UNITS_IN_VARIATION_MESSAGE,
)
from gbstats.bayesian.dists import Beta, Norm
from gbstats.shared.models import (
    BayesianTestResult,
    ProportionStatistic,
    RatioStatistic,
    SampleMeanStatistic,
    Statistic,
    Uplift,
)
from gbstats.shared.tests import BaseABTest


@dataclass
class GaussianPrior:
    mean: float = 0
    variance: float = 1
    pseudo_n: float = 0


@dataclass
class BetaPrior:
    alpha: float = 1
    beta: float = 1


@dataclass
class BayesianConfig:
    inverse: bool = False
    ccr: float = 0.05


@dataclass
class BinomialBayesianConfig(BayesianConfig):
    prior_a: BetaPrior = field(default_factory=BetaPrior)
    prior_b: BetaPrior = field(default_factory=BetaPrior)


@dataclass
class GaussianBayesianConfig(BayesianConfig):
    prior_a: GaussianPrior = field(default_factory=GaussianPrior)
    prior_b: GaussianPrior = field(default_factory=GaussianPrior)
    epsilon: float = 1e-4


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

    def _default_output(
        self, error_message: Optional[str] = None
    ) -> BayesianTestResult:
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
            error_message=error_message,
        )

    def has_empty_input(self):
        return self.stat_a.n == 0 or self.stat_b.n == 0

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
    def __init__(
        self,
        stat_a: ProportionStatistic,
        stat_b: ProportionStatistic,
        config: BinomialBayesianConfig = BinomialBayesianConfig(),
    ):
        super().__init__(stat_a, stat_b, config.inverse, config.ccr)
        self.prior_a = config.prior_a
        self.prior_b = config.prior_b

    def compute_result(self) -> BayesianTestResult:
        if self.stat_a.mean == 0:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        if self.has_empty_input():
            return self._default_output(NO_UNITS_IN_VARIATION_MESSAGE)

        alpha_a, beta_a = Beta.posterior(
            [self.prior_a.alpha, self.prior_a.beta], [self.stat_a.sum, self.stat_a.n]  # type: ignore
        )
        alpha_b, beta_b = Beta.posterior(
            [self.prior_b.alpha, self.prior_b.beta], [self.stat_b.sum, self.stat_b.n]  # type: ignore
        )

        mean_a, var_a = Beta.moments(alpha_a, beta_a, log=True)
        mean_b, var_b = Beta.moments(alpha_b, beta_b, log=True)

        mean_diff = mean_b - mean_a
        std_diff = np.sqrt(var_a + var_b)

        expected = np.exp(mean_diff) - 1
        risk = Beta.risk(alpha_a, beta_a, alpha_b, beta_b).tolist()

        relative_risk = self.relative_risk(risk, self.stat_b.mean)
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
    def __init__(
        self,
        stat_a: Union[SampleMeanStatistic, RatioStatistic],
        stat_b: Union[SampleMeanStatistic, RatioStatistic],
        config: GaussianBayesianConfig = GaussianBayesianConfig(),
    ):
        super().__init__(stat_a, stat_b, config.inverse, config.ccr)
        self.prior_a = config.prior_a
        self.prior_b = config.prior_b
        self.epsilon = config.epsilon

    def _is_log_approximation_inexact(
        self, mean_std_dev_pairs: Tuple[Tuple[float, float], Tuple[float, float]]
    ) -> bool:
        """Check if any mean-standard deviation pair yields an inexact approximation
        due to a high probability of being negative.

        :param Tuple[Tuple[float, float], Tuple[float, float]] mean_std_dev_pairs:
            A tuple of (mean, standard deviation) tuples.
        """
        return any(
            [
                norm.cdf(0, pair[0], pair[1]) > self.epsilon
                for pair in mean_std_dev_pairs
            ]
        )

    def compute_result(self) -> BayesianTestResult:
        if self.stat_a.mean == 0:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        if self.has_empty_input():
            return self._default_output(NO_UNITS_IN_VARIATION_MESSAGE)
        if self._has_zero_variance():
            return self._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE)

        mu_a, sd_a = Norm.posterior(
            [
                self.prior_a.mean,
                self.prior_a.variance,
                self.prior_a.pseudo_n,
            ],
            [
                self.stat_a.mean,
                self.stat_a.stddev,
                self.stat_a.n,
            ],
        )
        mu_b, sd_b = Norm.posterior(
            [
                self.prior_b.mean,
                self.prior_b.variance,
                self.prior_b.pseudo_n,
            ],
            [
                self.stat_b.mean,
                self.stat_b.stddev,
                self.stat_b.n,
            ],
        )

        if self._is_log_approximation_inexact(((mu_a, sd_a), (mu_b, sd_b))):
            return self._default_output(LOG_APPROXIMATION_INEXACT_MESSAGE)

        mean_a, var_a = Norm.moments(mu_a, sd_a, log=True, epsilon=self.epsilon)
        mean_b, var_b = Norm.moments(mu_b, sd_b, log=True, epsilon=self.epsilon)

        mean_diff = mean_b - mean_a
        std_diff = np.sqrt(var_a + var_b)
        expected = np.exp(mean_diff) - 1

        risk = Norm.risk(mu_a, sd_a, mu_b, sd_b).tolist()

        relative_risk = self.relative_risk(risk, self.stat_b.mean)
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
