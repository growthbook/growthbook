from abc import abstractmethod
from dataclasses import field
from typing import List, Optional, Tuple, Union

import numpy as np
from pydantic.dataclasses import dataclass
from scipy.stats import norm  # type: ignore

from gbstats.messages import (
    BASELINE_VARIATION_ZERO_MESSAGE,
    LOG_APPROXIMATION_INEXACT_MESSAGE,
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    ZERO_SCALED_VARIATION_MESSAGE,
    NO_UNITS_IN_VARIATION_MESSAGE,
)
from gbstats.bayesian.dists import Beta, Norm
from gbstats.models.tests import BaseABTest, BaseConfig, TestResult, Uplift
from gbstats.models.statistics import (
    ProportionStatistic,
    RatioStatistic,
    SampleMeanStatistic,
    TestStatistic,
    QuantileStatistic,
    QuantileClusteredStatistic,
)
from gbstats.frequentist.tests import frequentist_diff, frequentist_variance
from gbstats.utils import truncated_normal_mean

# Configs


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
class BayesianConfig(BaseConfig):
    inverse: bool = False
    alpha: float = 0.05


@dataclass
class BinomialBayesianConfig(BayesianConfig):
    prior_a: BetaPrior = field(default_factory=BetaPrior)
    prior_b: BetaPrior = field(default_factory=BetaPrior)


@dataclass
class GaussianBayesianConfig(BayesianConfig):
    prior_a: GaussianPrior = field(default_factory=GaussianPrior)
    prior_b: GaussianPrior = field(default_factory=GaussianPrior)
    epsilon: float = 1e-4


@dataclass
class EffectBayesianConfig(BayesianConfig):
    prior_effect: GaussianPrior = field(default_factory=GaussianPrior)


# Results
@dataclass
class BayesianTestResult(TestResult):
    chance_to_win: float
    risk: List[float]
    error_message: Optional[str] = None


"""
Medium article inspiration:
    https://towardsdatascience.com/how-to-do-bayesian-a-b-testing-fast-41ee00d55be8

Original code:
    https://github.com/itamarfaran/public-sandbox/tree/master/bayesian_blog
"""


class BayesianABTest(BaseABTest):
    def __init__(
        self,
        stat_a: TestStatistic,
        stat_b: TestStatistic,
        config: BayesianConfig = BayesianConfig(),
    ):
        super().__init__(stat_a, stat_b)
        self.alpha = config.alpha
        self.inverse = config.inverse
        self.relative = config.difference_type == "relative"
        self.scaled = config.difference_type == "scaled"
        self.traffic_proportion_b = config.traffic_proportion_b
        self.phase_length_days = config.phase_length_days

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
            error_message=error_message,
        )

    def has_empty_input(self):
        return self.stat_a.n == 0 or self.stat_b.n == 0

    def credible_interval(
        self, mean_diff: float, std_diff: float, alpha: float, log: bool
    ) -> List[float]:
        ci = norm.ppf([alpha / 2, 1 - alpha / 2], mean_diff, std_diff)

        if log:
            return (np.exp(ci) - 1).tolist()
        return ci.tolist()

    def chance_to_win(self, mean_diff: float, std_diff: float) -> float:
        if self.inverse:
            return 1 - norm.sf(0, mean_diff, std_diff)  # type: ignore
        else:
            return norm.sf(0, mean_diff, std_diff)  # type: ignore

    def scale_result(
        self, result: BayesianTestResult, p: float, d: float
    ) -> BayesianTestResult:
        if result.uplift.dist != "normal":
            raise ValueError("Cannot scale relative results.")
        if p == 0:
            return self._default_output(ZERO_SCALED_VARIATION_MESSAGE)
        adjustment = self.stat_b.n / p / d
        return BayesianTestResult(
            chance_to_win=result.chance_to_win,
            expected=result.expected * adjustment,
            ci=[result.ci[0] * adjustment, result.ci[1] * adjustment],
            uplift=Uplift(
                dist=result.uplift.dist,
                mean=result.uplift.mean * adjustment,
                stddev=result.uplift.stddev * adjustment,
            ),
            risk=result.risk,
        )


class BinomialBayesianABTest(BayesianABTest):
    def __init__(
        self,
        stat_a: ProportionStatistic,
        stat_b: ProportionStatistic,
        config: BinomialBayesianConfig = BinomialBayesianConfig(),
    ):
        super().__init__(stat_a, stat_b, config)
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
        mean_a, var_a = Beta.moments(alpha_a, beta_a, log=self.relative)
        mean_b, var_b = Beta.moments(alpha_b, beta_b, log=self.relative)

        mean_diff = mean_b - mean_a
        std_diff = np.sqrt(var_a + var_b)

        risk = Beta.risk(alpha_a, beta_a, alpha_b, beta_b).tolist()
        # Flip risk and chance to win for inverse metrics
        risk = [risk[0], risk[1]] if not self.inverse else [risk[1], risk[0]]

        if self.relative:
            expected = np.exp(mean_diff) - 1
        else:
            expected = mean_diff

        ci = self.credible_interval(mean_diff, std_diff, self.alpha, self.relative)
        ctw = self.chance_to_win(mean_diff, std_diff)

        result = BayesianTestResult(
            chance_to_win=ctw,
            expected=expected,
            ci=ci,
            uplift=Uplift(
                dist="lognormal" if self.relative else "normal",
                mean=mean_diff,
                stddev=std_diff,
            ),
            risk=risk,
        )
        if self.scaled:
            result = self.scale_result(
                result, self.traffic_proportion_b, self.phase_length_days
            )
        return result


class GaussianBayesianABTest(BayesianABTest):
    def __init__(
        self,
        stat_a: Union[
            SampleMeanStatistic,
            RatioStatistic,
        ],
        stat_b: Union[
            SampleMeanStatistic,
            RatioStatistic,
        ],
        config: GaussianBayesianConfig = GaussianBayesianConfig(),
    ):
        super().__init__(stat_a, stat_b, config)
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

        if self.relative & self._is_log_approximation_inexact(
            ((mu_a, sd_a), (mu_b, sd_b))
        ):
            return self._default_output(LOG_APPROXIMATION_INEXACT_MESSAGE)

        mean_a, var_a = Norm.moments(
            mu_a, sd_a, log=self.relative, epsilon=self.epsilon
        )
        mean_b, var_b = Norm.moments(
            mu_b, sd_b, log=self.relative, epsilon=self.epsilon
        )

        mean_diff = mean_b - mean_a
        std_diff = np.sqrt(var_a + var_b)

        if self.relative:
            expected = np.exp(mean_diff) - 1
        else:
            expected = mean_diff

        risk = Norm.risk(mu_a, sd_a, mu_b, sd_b).tolist()

        ci = self.credible_interval(mean_diff, std_diff, self.alpha, self.relative)
        ctw = self.chance_to_win(mean_diff, std_diff)

        result = BayesianTestResult(
            chance_to_win=ctw,
            expected=expected,
            ci=ci,
            uplift=Uplift(
                dist="lognormal" if self.relative else "normal",
                mean=mean_diff,
                stddev=std_diff,
            ),
            risk=risk,
        )
        if self.scaled:
            result = self.scale_result(
                result, self.traffic_proportion_b, self.phase_length_days
            )
        return result


class GaussianEffectABTest(BayesianABTest):
    def __init__(
        self,
        stat_a: Union[
            SampleMeanStatistic,
            RatioStatistic,
            QuantileStatistic,
            QuantileClusteredStatistic,
        ],
        stat_b: Union[
            SampleMeanStatistic,
            RatioStatistic,
            QuantileStatistic,
            QuantileClusteredStatistic,
        ],
        config: EffectBayesianConfig,
    ):
        super().__init__(stat_a, stat_b, config)
        self.prior_effect = config.prior_effect
        self.stat_a = stat_a
        self.stat_b = stat_b

    def compute_result(self):
        if (
            self.stat_a.mean == 0 or self.stat_a.unadjusted_mean == 0
        ) and self.relative:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        if self.has_empty_input():
            return self._default_output(NO_UNITS_IN_VARIATION_MESSAGE)
        if self._has_zero_variance():
            return self._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE)

        self.construct_prior_by_variation()

        mu_a, sd_a = Norm.posterior(
            [
                self.prior_a.mean,
                np.sqrt(self.prior_a.variance),
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
                np.sqrt(self.prior_b.variance),
                self.prior_b.pseudo_n,
            ],
            [
                self.stat_b.mean,
                self.stat_b.stddev,
                self.stat_b.n,
            ],
        )
        self.var_diff = frequentist_variance(
            sd_a**2, mu_a, 1, sd_b**2, mu_b, 1, self.relative
        )
        self.std_diff = np.sqrt(self.var_diff)
        self.mean_diff = frequentist_diff(mu_a, mu_b, self.relative)

        # risk is always absolute in gbstats
        risk = self.getRisk(
            frequentist_diff(mu_a, mu_b, False),
            np.sqrt(
                frequentist_variance(sd_a**2, mu_a, 1, sd_b**2, mu_b, 1, False)
            ),
        )
        ctw = self.chance_to_win(self.mean_diff, self.std_diff)
        ci = self.credible_interval(
            self.mean_diff, self.std_diff, self.alpha, log=False
        )
        # probably better to tear these out of superclass, have this be standalone class
        result = BayesianTestResult(
            chance_to_win=ctw,
            expected=self.mean_diff,
            ci=ci,
            uplift=Uplift(
                dist="normal",
                mean=self.mean_diff,
                stddev=self.std_diff,
            ),
            risk=risk,
        )
        if self.scaled:
            result = self.scale_result(
                result, self.traffic_proportion_b, self.phase_length_days
            )
        return result

    def construct_prior_by_variation(self):
        mu_0 = self.stat_a.mean
        if self.relative:
            mu_1 = mu_0 * (1.0 + self.prior_effect.mean)
            v = (
                self.prior_effect.variance
                * mu_0**2
                / (1.0 + self.prior_effect.mean**2)
            )
        else:
            mu_1 = mu_0 + self.prior_effect.mean
            v = 0.5 * self.prior_effect.variance
        self.prior_a = GaussianPrior(
            mean=mu_0, variance=v, pseudo_n=self.prior_effect.pseudo_n
        )
        self.prior_b = GaussianPrior(
            mean=mu_1, variance=v, pseudo_n=self.prior_effect.pseudo_n
        )

    @staticmethod
    def getRisk(mu, sigma) -> List[float]:
        prob_ctrl_is_better = norm.cdf(0.0, loc=mu, scale=sigma)
        mn_neg = truncated_normal_mean(mu=mu, sigma=sigma, a=-np.inf, b=0.0)
        mn_pos = truncated_normal_mean(mu=mu, sigma=sigma, a=0, b=np.inf)
        risk_ctrl = float((1.0 - prob_ctrl_is_better) * mn_pos)
        risk_trt = -float(prob_ctrl_is_better * mn_neg)
        return [risk_ctrl, risk_trt]
