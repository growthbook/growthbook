from abc import abstractmethod
from dataclasses import field
from typing import List, Literal, Optional
import copy
import numpy as np
from pydantic.dataclasses import dataclass
from pydantic.config import ConfigDict
from scipy.stats import norm

from gbstats.messages import (
    BASELINE_VARIATION_ZERO_MESSAGE,
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    ZERO_SCALED_VARIATION_MESSAGE,
    NO_UNITS_IN_VARIATION_MESSAGE,
)
from gbstats.models.tests import BaseABTest, BaseConfig, TestResult, Uplift
from gbstats.models.statistics import (
    TestStatistic,
    ProportionStatistic,
    SampleMeanStatistic,
    RegressionAdjustedStatistic,
    RegressionAdjustedRatioStatistic,
)
from gbstats.frequentist.tests import (
    frequentist_diff,
    frequentist_variance,
    frequentist_variance_relative_cuped,
    frequentist_variance_relative_cuped_ratio,
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


# Results
RiskType = Literal["absolute", "relative"]


@dataclass
class BayesianTestResult(TestResult):
    chance_to_win: float
    risk: List[float]
    risk_type: RiskType


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

    def has_empty_input(self):
        return self.stat_a.n == 0 or self.stat_b.n == 0

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
        if isinstance(
            self.stat_a,
            (ProportionStatistic, SampleMeanStatistic, RegressionAdjustedStatistic),
        ):
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
        stat_a: TestStatistic,
        stat_b: TestStatistic,
        config: EffectBayesianConfig = EffectBayesianConfig(),
    ):
        super().__init__(stat_a, stat_b, config)
        self.config = config

    def compute_result(self):
        if (
            self.stat_a.mean == 0 or self.stat_a.unadjusted_mean == 0
        ) and self.relative:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        if self.has_empty_input():
            return self._default_output(NO_UNITS_IN_VARIATION_MESSAGE)
        if self._has_zero_variance():
            return self._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE)

        # rescale prior if needed
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
        if (
            isinstance(self.stat_a, RegressionAdjustedStatistic)
            and isinstance(self.stat_b, RegressionAdjustedStatistic)
            and self.relative
        ):
            data_variance = frequentist_variance_relative_cuped(
                self.stat_a, self.stat_b
            )
        elif (
            isinstance(self.stat_a, RegressionAdjustedRatioStatistic)
            and isinstance(self.stat_b, RegressionAdjustedRatioStatistic)
            and self.relative
        ):
            data_variance = frequentist_variance_relative_cuped_ratio(
                self.stat_a, self.stat_b
            )
        else:
            data_variance = frequentist_variance(
                self.stat_a.variance,
                self.stat_a.unadjusted_mean,
                self.stat_a.n,
                self.stat_b.variance,
                self.stat_b.unadjusted_mean,
                self.stat_b.n,
                self.relative,
            )
        data_mean = frequentist_diff(
            self.stat_a.mean,
            self.stat_b.mean,
            self.relative,
            self.stat_a.unadjusted_mean,
        )
        if data_variance:
            post_prec = 1 / data_variance + (
                1 / scaled_prior_effect.variance if scaled_prior_effect.proper else 0
            )
            self.mean_diff = (
                (
                    data_mean / data_variance
                    + scaled_prior_effect.mean / scaled_prior_effect.variance
                )
                / post_prec
                if scaled_prior_effect.proper
                else data_mean
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


@dataclass
class MCMCParams:
    num_burn: int
    num_keep: int
    seed: int


@dataclass
class Hyperparams:
    mu_delta: float
    sigma_2_delta: float
    a: float
    b: float
    sigma_2_alpha: float
    sigma_2_beta: float
    num_levels_alpha: Optional[int] = None
    num_levels_beta: Optional[int] = None


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class CellData:
    tau_hat: np.ndarray
    s2: np.ndarray


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class ModelParams:
    tau: np.ndarray
    mu: np.ndarray
    alpha: np.ndarray
    beta: np.ndarray
    sigma_2: float
    tau_overall: float


class TwoFactorPooling:
    def __init__(
        self,
        hyperparams: Hyperparams,
        cell_data: CellData,
        mcmc_params: MCMCParams,
        params: Optional[ModelParams],
    ):
        self.tau_hat_init = copy.deepcopy(cell_data.tau_hat)
        self.cell_data = copy.deepcopy(cell_data)
        self.hyperparams = hyperparams
        # raise ValueError('jill')
        self.num_levels_alpha = self.cell_data.tau_hat.shape[0]
        self.num_levels_beta = self.cell_data.tau_hat.shape[1]
        self.seed = mcmc_params.seed
        self.num_burn = mcmc_params.num_burn
        self.num_keep = mcmc_params.num_keep
        self.num_iters = self.num_burn + self.num_keep
        self.params = self.initialize_parameters(params)
        self.update_missing_tau_hat(self.seed + self.num_seeds_per_iter - 1)

    def update_missing_tau_hat(self, seed):
        rng_tau_hat = np.random.default_rng(seed)
        z_tau_hat = rng_tau_hat.normal(
            0, 1, size=(self.num_levels_alpha, self.num_levels_beta)
        )
        for a in range(self.num_levels_alpha):
            for b in range(self.num_levels_beta):
                if self.tau_hat_init[a, b] is None or np.isnan(self.tau_hat_init[a, b]):
                    self.cell_data.tau_hat[a, b] = (
                        np.sqrt(self.cell_data.s2[a, b]) * z_tau_hat[a, b]
                        + self.params.tau[a, b]
                    )

    def initialize_parameters(self, params) -> ModelParams:
        if params is None:
            # use mean imputation for stability
            tau = copy.deepcopy(self.tau_hat_init)
            tau[np.isnan(tau)] = np.nanmean(tau)
            tau_overall = float(np.mean(tau))
            alpha = np.mean(tau, axis=1)
            beta = np.mean(tau, axis=0)
            alpha -= np.mean(alpha)
            beta -= np.mean(beta)
            mu = self.create_mu_matrix(tau_overall, alpha, beta)
            sigma_2 = float(min(0.1, np.var(tau - mu, ddof=1)))
            return ModelParams(tau, mu, alpha, beta, sigma_2, tau_overall)
        else:
            return params

    @property
    def tau_shape(self) -> tuple[int, int]:
        return (self.num_levels_alpha, self.num_levels_beta)

    @property
    def num_seeds_per_iter(self) -> int:
        return 6

    def run_mcmc(self):
        self.create_storage_arrays()
        self.params = self.initialize_parameters(self.params)
        for i in range(self.num_iters):
            self.update_params(i)
            if i >= self.num_burn:
                self.store_params(i)

    def create_mu_matrix(self, tau_overall, alpha, beta) -> np.ndarray:
        mu = np.zeros((self.num_levels_alpha, self.num_levels_beta))
        for a in range(self.num_levels_alpha):
            for b in range(self.num_levels_beta):
                mu[a, b] = tau_overall + alpha[a] + beta[b]
        return mu

    def create_storage_arrays(self):
        self.tau_hat = np.zeros(
            (self.num_keep, self.num_levels_alpha, self.num_levels_beta)
        )
        self.tau = np.zeros(
            (self.num_keep, self.num_levels_alpha, self.num_levels_beta)
        )
        self.mu = np.zeros((self.num_keep, self.num_levels_alpha, self.num_levels_beta))
        self.alpha = np.zeros((self.num_keep, self.num_levels_alpha))
        self.beta = np.zeros((self.num_keep, self.num_levels_beta))
        self.sigma_2 = np.zeros((self.num_keep, 1))
        self.tau_overall = np.zeros((self.num_keep, 1))

    def store_params(self, iteration):
        k = iteration - self.num_burn
        self.tau_hat[k, :, :] = self.cell_data.tau_hat
        self.tau[k, :, :] = self.params.tau
        self.mu[k, :, :] = self.params.mu
        self.alpha[k, :] = self.params.alpha
        self.beta[k, :] = self.params.beta
        self.sigma_2[k] = self.params.sigma_2
        self.tau_overall[k] = self.params.tau_overall

    def update_params(self, iteration):
        # i used the first seed to initialize the parameters
        this_seed = self.seed + (iteration + 1) * self.num_seeds_per_iter
        self.update_tau_individual(this_seed)
        self.update_alpha(this_seed + 1)
        self.update_beta(this_seed + 2)
        self.update_tau_overall(this_seed + 3)
        self.update_sigma_2(this_seed + 4)
        self.update_missing_tau_hat(this_seed + 5)

    @staticmethod
    def update_univariate_normal(prec, weighted_mean, seed):
        var = 0 if prec == 0 else 1 / prec
        mean = var * weighted_mean
        rng = np.random.default_rng(seed)
        return np.sqrt(var) * rng.normal(size=1) + mean

    def update_tau_individual(self, seed):
        prec = 1 / self.cell_data.s2 + 1 / self.params.sigma_2
        omega = (
            self.cell_data.tau_hat / self.cell_data.s2
            + self.params.mu / self.params.sigma_2
        )
        var = 1 / prec
        mean = var * omega
        rng = np.random.default_rng(seed)
        self.params.tau = mean + np.sqrt(var) * rng.normal(0, 1, size=self.tau_shape)

    def update_alpha(self, seed):
        alpha = np.zeros((self.num_levels_alpha,))
        prec = (
            self.num_levels_beta / self.params.sigma_2
            + 1 / self.hyperparams.sigma_2_alpha
        )
        var = 1 / prec
        rng = np.random.default_rng(seed)
        z = rng.normal(0, 1, size=(self.num_levels_alpha))
        for a in range(self.num_levels_alpha):
            omega = 0
            for b in range(self.num_levels_beta):
                omega += (
                    self.params.tau[a, b]
                    - self.params.tau_overall
                    - self.params.beta[b]
                ) / self.num_levels_beta
            omega /= self.params.sigma_2 / self.num_levels_beta
            mean = var * omega
            alpha[a] = np.sqrt(var) * z[a] + mean
        alpha -= np.mean(alpha)
        self.params.alpha = alpha
        self.params.mu = self.create_mu_matrix(
            self.params.tau_overall, self.params.alpha, self.params.beta
        )

    def update_beta(self, seed):
        beta = np.zeros((self.num_levels_beta,))
        prec = (
            self.num_levels_alpha / self.params.sigma_2
            + 1 / self.hyperparams.sigma_2_beta
        )
        var = 1 / prec
        rng = np.random.default_rng(seed)
        z = rng.normal(0, 1, size=(self.num_levels_beta))
        for b in range(self.num_levels_beta):
            omega = 0
            for a in range(self.num_levels_alpha):
                omega += (
                    self.params.tau[a, b]
                    - self.params.tau_overall
                    - self.params.alpha[a]
                ) / self.num_levels_alpha
            omega /= self.params.sigma_2 / self.num_levels_alpha
            mean = var * omega
            beta[b] = np.sqrt(var) * z[b] + mean
        beta -= np.mean(beta)
        self.params.beta = beta
        self.params.mu = self.create_mu_matrix(
            self.params.tau_overall, self.params.alpha, self.params.beta
        )

    def update_tau_overall(self, seed):
        prec = (
            self.num_levels_alpha * self.num_levels_beta
        ) / self.params.sigma_2 + 1 / self.hyperparams.sigma_2_delta
        omega = (
            np.sum(self.params.tau) / self.params.sigma_2
            + self.hyperparams.mu_delta / self.hyperparams.sigma_2_delta
        )
        self.params.tau_overall = self.update_univariate_normal(prec, omega, seed)
        self.params.mu = self.create_mu_matrix(
            self.params.tau_overall, self.params.alpha, self.params.beta
        )

    def update_sigma_2(self, seed):
        a_prime = (
            self.hyperparams.a + 0.5 * self.num_levels_alpha * self.num_levels_beta
        )
        b_prime = self.hyperparams.b + 0.5 * np.sum(
            (self.params.tau - self.params.mu) ** 2
        )
        rng = np.random.default_rng(seed)
        self.params.sigma_2 = 1 / float(
            rng.gamma(shape=a_prime, scale=1 / b_prime, size=1)[0]
        )
