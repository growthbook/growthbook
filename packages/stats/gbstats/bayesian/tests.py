from abc import abstractmethod
from dataclasses import field
from typing import List, Literal, Optional, Tuple

import numpy as np
from pydantic.dataclasses import dataclass
from scipy.stats import norm

from gbstats.messages import (
    BASELINE_VARIATION_ZERO_MESSAGE,
    ZERO_SCALED_VARIATION_MESSAGE,
    NO_UNITS_IN_VARIATION_MESSAGE,
)
from gbstats.models.results import BayesianTestResult, Uplift
from gbstats.models.tests import (
    BaseConfig,
    BaseABTest,
    TestStatistic,
)
from gbstats.utils import (
    truncated_normal_mean,
    gaussian_credible_interval,
)


# Configs
@dataclass
class GaussianPrior:
    mean: float = 0
    variance: float = 1
    proper: bool = False


@dataclass
class BayesianConfig(BaseConfig):
    inverse: bool = False
    prior_type: Literal["relative", "absolute"] = "relative"


@dataclass
class EffectBayesianConfig(BayesianConfig):
    prior_effect: GaussianPrior = field(default_factory=GaussianPrior)


class BayesianABTest(BaseABTest):
    def __init__(
        self,
        stats: List[Tuple[TestStatistic, TestStatistic]],
        config: BayesianConfig = BayesianConfig(),
    ):
        super().__init__(stats, config)
        self.alpha = config.alpha
        self.inverse = config.inverse
        self.relative = config.difference_type == "relative"
        self.scaled = config.difference_type == "scaled"
        self.traffic_percentage = config.traffic_percentage
        self.total_users = config.total_users
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
            uplift=Uplift(dist="normal", mean=0, stddev=0),
            risk=[0, 0],
            error_message=error_message,
            risk_type="relative" if self.relative else "absolute",
        )

    def chance_to_win(self, mean_diff: float, std_diff: float) -> float:
        if self.inverse:
            return 1 - norm.sf(0, mean_diff, std_diff)  # type: ignore
        else:
            return norm.sf(0, mean_diff, std_diff)  # type: ignore

    def scale_result(self, result: BayesianTestResult) -> BayesianTestResult:
        if result.uplift.dist != "normal":
            raise ValueError("Cannot scale relative results.")
        if self.phase_length_days == 0 or self.traffic_percentage == 0:
            return self._default_output(ZERO_SCALED_VARIATION_MESSAGE)
        if self.scaled_impact_eligible:
            if self.total_users:
                daily_traffic = self.total_users / (
                    self.traffic_percentage * self.phase_length_days
                )
                return BayesianTestResult(
                    chance_to_win=result.chance_to_win,
                    expected=result.expected * daily_traffic,
                    ci=[result.ci[0] * daily_traffic, result.ci[1] * daily_traffic],
                    uplift=Uplift(
                        dist=result.uplift.dist,
                        mean=result.uplift.mean * daily_traffic,
                        stddev=result.uplift.stddev * daily_traffic,
                    ),
                    risk=result.risk,
                    risk_type=result.risk_type,
                    error_message=None,
                )
            else:
                return self._default_output(NO_UNITS_IN_VARIATION_MESSAGE)
        else:
            error_str = "For scaled impact the statistic must be of type ProportionStatistic, SampleMeanStatistic, or RegressionAdjustedStatistic"
            return self._default_output(error_str)


class EffectBayesianABTest(BayesianABTest):
    def __init__(
        self,
        stats: List[Tuple[TestStatistic, TestStatistic]],
        config: EffectBayesianConfig = EffectBayesianConfig(),
    ):
        super().__init__(stats, config)
        self.config = config

    @property
    def data_mean(self):
        return self.moments_result.point_estimate

    @property
    def data_variance(self):
        return self.moments_result.standard_error**2

    def compute_result(self):
        if self.moments_result.error_message is not None:
            return self._default_output(self.moments_result.error_message)

        scaled_prior_effect = self.config.prior_effect
        if self.relative and self.config == "absolute":
            scaled_prior_effect = GaussianPrior(
                self.config.prior_effect.mean / abs(self.stat_a.unadjusted_mean),
                self.config.prior_effect.variance / pow(self.stat_a.unadjusted_mean, 2),
                self.config.prior_effect.proper,
            )
        elif not self.relative and self.config.prior_type == "relative":
            if self.config.prior_effect.proper and self.stat_a.unadjusted_mean == 0:
                return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
            scaled_prior_effect = GaussianPrior(
                self.config.prior_effect.mean * abs(self.stat_a.unadjusted_mean),
                self.config.prior_effect.variance * pow(self.stat_a.unadjusted_mean, 2),
                self.config.prior_effect.proper,
            )
        if self.data_variance:
            post_prec = 1 / self.data_variance + (
                1 / scaled_prior_effect.variance if scaled_prior_effect.proper else 0
            )
            self.mean_diff = (
                (
                    self.data_mean / self.data_variance
                    + scaled_prior_effect.mean / scaled_prior_effect.variance
                )
                / post_prec
                if scaled_prior_effect.proper
                else self.data_mean
            )
        else:
            post_prec = (
                1 / scaled_prior_effect.variance if scaled_prior_effect.proper else 0
            )
            self.mean_diff = (
                scaled_prior_effect.mean if scaled_prior_effect.proper else 0
            )
        if post_prec == 0:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        self.std_diff = np.sqrt(1 / post_prec)

        ctw = self.chance_to_win(self.mean_diff, self.std_diff)
        ci = gaussian_credible_interval(self.mean_diff, self.std_diff, self.alpha)
        risk = self.get_risk(self.mean_diff, self.std_diff)
        # flip risk for inverse metrics
        risk = [risk[0], risk[1]] if not self.inverse else [risk[1], risk[0]]

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
            risk_type="relative" if self.relative else "absolute",
            error_message=None,
        )
        if self.scaled:
            result = self.scale_result(result)
        return result

    @staticmethod
    def get_risk(mu, sigma) -> List[float]:
        prob_ctrl_is_better = norm.cdf(0.0, loc=mu, scale=sigma)
        mn_neg = truncated_normal_mean(mu=mu, sigma=sigma, a=-np.inf, b=0.0)
        mn_pos = truncated_normal_mean(mu=mu, sigma=sigma, a=0, b=np.inf)
        risk_ctrl = float((1.0 - prob_ctrl_is_better) * mn_pos)
        risk_trt = -float(prob_ctrl_is_better * mn_neg)
        return [risk_ctrl, risk_trt]
