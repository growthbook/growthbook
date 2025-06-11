from abc import abstractmethod
from dataclasses import field
from typing import List, Literal, Optional
import copy
import numpy as np
from pydantic.dataclasses import dataclass
from pydantic.config import ConfigDict
from scipy.stats import norm
from arviz import ess

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
    random_inverse_wishart,
)
from gbstats.frequentist.post_strat import CellResult


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
class MCMCConfig:
    num_burn: int
    num_keep: int
    seed: int
    false_positive_rate: float = 0.05
    difference_type: Literal["relative", "absolute"] = "relative"


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class HyperparamsTwoFactor:
    mu_0: np.ndarray  # prior mean for mu
    sigma_0: np.ndarray  # prior variance for mu
    nu_alpha: float  # prior degrees of freedom for sigma_alpha
    psi_alpha: np.ndarray  # prior scale matrix for sigma_alpha
    nu_beta: float  # prior degrees of freedom for sigma_beta
    psi_beta: np.ndarray  # prior scale matrix for sigma_beta
    nu_alpha_beta: float  # prior degrees of freedom for sigma_alpha_beta
    psi_alpha_beta: np.ndarray  # prior scale matrix for sigma_alpha_beta
    num_variations_alpha: int
    num_variations_beta: int


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class ModelParamsTwoFactor:
    mu_overall: np.ndarray  # overall mean
    mu: np.ndarray  # cell means
    alpha: np.ndarray  # row effects
    beta: np.ndarray  # column effects
    alpha_beta: np.ndarray  # interaction effects
    sigma_alpha: np.ndarray  # row variances
    sigma_beta: np.ndarray  # column variances
    sigma_alpha_beta: np.ndarray  # interaction variances


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class MCMCPooledResult:
    mu_mean: np.ndarray
    mu_standard_error: np.ndarray
    mu_lower: np.ndarray
    mu_upper: np.ndarray
    error_message: Optional[str] = None


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class ModelDataTwoFactor:
    mu_hat: np.ndarray
    sigma_hat_inv: np.ndarray


class TwoFactorPooling:
    def __init__(
        self,
        hyperparams: HyperparamsTwoFactor,
        cell_data: List[CellResult],
        config: MCMCConfig,
        params: Optional[ModelParamsTwoFactor],
    ):
        self.relative = config.difference_type == "relative"
        self.cell_data = copy.deepcopy(cell_data)
        self.hyperparams = copy.deepcopy(hyperparams)
        self.num_variations_alpha = self.hyperparams.num_variations_alpha
        self.num_variations_beta = self.hyperparams.num_variations_beta
        assert (
            len(self.cell_data) == self.num_variations_alpha * self.num_variations_beta
        ), "Number of cell data must match number of levels in alpha and beta."
        self.num_outcomes = self.hyperparams.mu_0.shape[0]
        assert (
            self.cell_data[0].sample_mean.shape[0] == self.num_outcomes
        ), "Number of outcomes must be the same in data and hyperparams."
        assert self.num_outcomes in (1, 2, 4), "Number of outcomes must be 2 or 4"
        self.ratio = self.num_outcomes == 4
        self.mu_hat_init = np.zeros(
            (self.num_variations_alpha, self.num_variations_beta, self.num_outcomes)
        )
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                index = i + self.num_variations_alpha * j
                self.mu_hat_init[i, j, :] = self.cell_data[index].sample_mean

        self.seed = config.seed
        self.false_positive_rate = config.false_positive_rate
        self.num_burn = config.num_burn
        self.num_keep = config.num_keep
        self.num_iters = self.num_burn + self.num_keep
        self.params = self.initialize_parameters(params)

        self.sigma_hat_shape = (
            self.num_variations_alpha,
            self.num_variations_beta,
            self.num_outcomes,
            self.num_outcomes,
        )
        self.sigma_hat = np.zeros(self.sigma_hat_shape)
        self.sigma_hat_inv = np.zeros(self.sigma_hat_shape)
        self.sigma_hat_inv_sum = np.zeros((self.num_outcomes, self.num_outcomes))
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                index = i + self.num_variations_alpha * j
                self.sigma_hat[i, j, :, :] = (
                    self.cell_data[index].sample_covariance / self.cell_data[index].n
                )
                self.sigma_hat_inv[i, j, :, :] = np.linalg.inv(
                    self.sigma_hat[i, j, :, :]
                )
                self.sigma_hat_inv_sum += self.sigma_hat_inv[i, j, :, :]

    @staticmethod
    def specify_hyperparams(
        num_variations_alpha, num_variations_beta, mu_hat
    ) -> HyperparamsTwoFactor:
        num_variations_alpha = mu_hat.shape[0]
        num_variations_beta = mu_hat.shape[1]
        num_outcomes = mu_hat.shape[2]
        mns_alpha = np.nanmean(mu_hat, axis=1)
        mns_beta = np.nanmean(mu_hat, axis=0)
        target_mean_alpha = np.cov(mns_alpha.T, ddof=1)
        target_mean_beta = np.cov(mns_beta.T, ddof=1)
        # update later
        target_mean_alpha_beta = 0.5 * (target_mean_alpha + target_mean_beta)
        nu_alpha = 10
        nu_beta = 10
        nu_alpha_beta = 10
        psi_alpha = np.array(
            [target_mean_alpha * float(nu_alpha - num_outcomes - 1)]
        ).reshape((num_outcomes, num_outcomes))
        psi_beta = np.array(
            [target_mean_beta * float(nu_beta - num_outcomes - 1)]
        ).reshape((num_outcomes, num_outcomes))
        psi_alpha_beta = np.array(
            [target_mean_alpha_beta * float(nu_alpha_beta - num_outcomes - 1)]
        ).reshape((num_outcomes, num_outcomes))
        mu_0 = np.zeros((num_outcomes,))
        sigma_0 = float(1e5) * np.eye(num_outcomes)
        hyperparams = HyperparamsTwoFactor(
            mu_0=mu_0,
            sigma_0=sigma_0,
            nu_alpha=nu_alpha,
            psi_alpha=psi_alpha,
            nu_beta=nu_beta,
            psi_beta=psi_beta,
            nu_alpha_beta=nu_alpha_beta,
            psi_alpha_beta=psi_alpha_beta,
            num_variations_alpha=num_variations_alpha,
            num_variations_beta=num_variations_beta,
        )
        return hyperparams

    def initialize_parameters(self, params) -> ModelParamsTwoFactor:
        # update later
        if params is None:
            mu = self.mu_hat_init
            mu[np.isnan(mu)] = np.nanmean(mu)
            mu_overall = np.mean(mu, axis=(0, 1)).ravel()
            alpha = np.mean(mu, axis=1)
            beta = np.mean(mu, axis=0)
            # needs to be updated
            alpha_beta = np.zeros(
                (self.num_variations_alpha, self.num_variations_beta, self.num_outcomes)
            )
            alpha -= np.mean(alpha, axis=0)
            beta -= np.mean(beta, axis=0)
            sigma_alpha = np.cov(alpha.T, ddof=1) + 1e-5 * np.eye(self.num_outcomes)
            sigma_beta = np.cov(beta.T, ddof=1) + 1e-5 * np.eye(self.num_outcomes)
            # this is wrong
            sigma_alpha_beta = np.zeros(
                (
                    self.num_variations_alpha,
                    self.num_variations_beta,
                    self.num_outcomes,
                    self.num_outcomes,
                )
            )
            return ModelParamsTwoFactor(
                mu_overall=mu_overall,
                mu=mu,
                alpha=alpha,
                beta=beta,
                alpha_beta=alpha_beta,
                sigma_alpha=sigma_alpha,
                sigma_beta=sigma_beta,
                sigma_alpha_beta=sigma_alpha_beta,
            )
        else:
            return copy.deepcopy(params)

    def run_mcmc(self) -> MCMCPooledResult:
        if self.check_missing_mu_hat():
            raise ValueError("Missing mu_hat in data")
        self.create_storage_arrays()
        self.params = self.initialize_parameters(self.params)
        for i in range(self.num_iters):
            self.update_params(i)
            if i >= self.num_burn:
                self.store_params(i)
        return self.create_summary()

    def check_missing_mu_hat(self):
        means_alpha = np.nanmean(self.mu_hat, axis=1)
        means_beta = np.nanmean(self.mu_hat, axis=0)
        if np.isnan(means_alpha).any() or np.isnan(means_beta).any():
            return True
        return False

    @property
    def mu_hat(self) -> np.ndarray:
        return self.mu_hat_init

    @property
    def prec_mu(self) -> np.ndarray:
        return np.linalg.inv(self.hyperparams.sigma_0) + self.sigma_hat_inv_sum

    @staticmethod
    def draw_multivariate_normal(m: np.ndarray, v: np.ndarray, seed: int):
        rng = np.random.default_rng(seed)
        return rng.multivariate_normal(m, v, size=1)

    @staticmethod
    def transform_moments(
        weighted_sum: np.ndarray, prec: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, bool]:
        matrix_inversion_success = True
        n_row = prec.shape[0]
        mean = np.zeros((n_row,))
        variance = np.eye(n_row)
        try:
            prec_chol = np.linalg.cholesky(prec)
            prec_chol_inv = np.linalg.inv(prec_chol)
            variance = prec_chol_inv.T @ prec_chol_inv
            mean = variance @ weighted_sum
        except np.linalg.LinAlgError:
            # If cholesky or inv fails, a LinAlgError is raised
            matrix_inversion_success = False
            # 'mean' and 'variance' will retain their initialized (e.g., zero) values
            # or you could assign specific error values if preferred.
        return mean, variance, matrix_inversion_success

    @property
    def minimum_mcmc_samples(self) -> int:
        return 250

    @property
    def num_seeds_mu_overall(self) -> int:
        return 1

    @property
    def num_seeds_mu_individual(self) -> int:
        return 0

    @property
    def num_seeds_alpha(self) -> int:
        return self.num_variations_alpha

    @property
    def num_seeds_beta(self) -> int:
        return self.num_variations_beta

    @property
    def num_seeds_sigma_alpha(self) -> int:
        return 2

    @property
    def num_seeds_sigma_beta(self) -> int:
        return 2

    @property
    def num_seeds_per_iter(self) -> int:
        return (
            self.num_seeds_mu_overall
            + self.num_seeds_mu_individual
            + self.num_seeds_alpha
            + self.num_seeds_beta
            + self.num_seeds_sigma_alpha
            + self.num_seeds_sigma_beta
        )

    def update_mu_overall(self, seed: int, iteration: int):
        weighted_sum_mu = np.linalg.inv(self.hyperparams.sigma_0).dot(
            self.hyperparams.mu_0
        )
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                weighted_sum_mu += self.sigma_hat_inv[i, j, :, :].dot(
                    self.mu_hat[i, j, :]
                    - self.params.alpha[i, :]
                    - self.params.beta[j, :]
                )
        mean, variance, matrix_inversion_success = TwoFactorPooling.transform_moments(
            weighted_sum_mu, self.prec_mu
        )
        if not matrix_inversion_success:
            raise ValueError("Matrix inversion failed in update_mu_overall")
        self.params.mu_overall = TwoFactorPooling.draw_multivariate_normal(
            mean, variance, seed
        ).ravel()
        self.update_mu_individual()

    def update_mu_individual(self):
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                self.params.mu[i, j, :] = (
                    self.params.mu_overall
                    + self.params.alpha[i, :]
                    + self.params.beta[j, :]
                )

    def update_alpha(self, seed: int):
        for i in range(self.num_variations_alpha):
            weighted_sum = np.zeros((self.num_outcomes,))
            prec = copy.deepcopy(np.linalg.inv(self.params.sigma_alpha))
            for j in range(self.num_variations_beta):
                weighted_sum += self.sigma_hat_inv[i, j, :, :].dot(
                    self.mu_hat[i, j, :]
                    - self.params.mu_overall
                    - self.params.beta[j, :]
                )
                prec += self.sigma_hat_inv[i, j, :, :]
            (
                mean,
                variance,
                matrix_inversion_success,
            ) = TwoFactorPooling.transform_moments(weighted_sum, prec)
            if not matrix_inversion_success:
                raise ValueError("Matrix inversion failed in update_alpha")
            self.params.alpha[i, :] = TwoFactorPooling.draw_multivariate_normal(
                mean, variance, seed + i
            )
        self.params.alpha -= np.mean(self.params.alpha, axis=0)
        self.update_mu_individual()

    def update_beta(self, seed: int):
        for j in range(self.num_variations_beta):
            weighted_sum = np.zeros((self.num_outcomes,))
            prec = copy.deepcopy(np.linalg.inv(self.params.sigma_beta))
            for i in range(self.num_variations_alpha):
                weighted_sum += self.sigma_hat_inv[i, j, :, :].dot(
                    self.mu_hat[i, j, :]
                    - self.params.mu_overall
                    - self.params.alpha[i, :]
                )
                prec += self.sigma_hat_inv[i, j, :, :]
            (
                mean,
                variance,
                matrix_inversion_success,
            ) = TwoFactorPooling.transform_moments(weighted_sum, prec)
            if not matrix_inversion_success:
                raise ValueError("Matrix inversion failed in update_beta")
            self.params.beta[j, :] = TwoFactorPooling.draw_multivariate_normal(
                mean, variance, seed + j
            )
        self.params.beta -= np.mean(self.params.beta, axis=0)
        self.update_mu_individual()

    def update_sigma_alpha(self, seed: int):
        nu_post = self.hyperparams.nu_alpha + self.num_variations_alpha
        lambda_post = self.hyperparams.psi_alpha + (
            self.num_variations_alpha - 1
        ) * np.cov(self.params.alpha.T)
        self.params.sigma_alpha = random_inverse_wishart(
            nu_post, lambda_post, seed
        ) + 1e-5 * np.eye(self.num_outcomes)

    def update_sigma_beta(self, seed: int):
        nu_post = self.hyperparams.nu_beta + self.num_variations_beta
        lambda_post = self.hyperparams.psi_beta + (
            self.num_variations_beta - 1
        ) * np.cov(self.params.beta.T)
        self.params.sigma_beta = random_inverse_wishart(
            nu_post, lambda_post, seed
        ) + 1e-5 * np.eye(self.num_outcomes)

    def update_missing_mu_hat(self, seed: int):
        pass

    def create_storage_arrays(self):
        self.mu_overall_keep = np.zeros((self.num_keep, self.num_outcomes))
        self.mu_keep = np.zeros(
            (
                self.num_keep,
                self.num_variations_alpha,
                self.num_variations_beta,
                self.num_outcomes,
            )
        )
        self.alpha_keep = np.zeros(
            (self.num_keep, self.num_variations_alpha, self.num_outcomes)
        )
        self.beta_keep = np.zeros(
            (self.num_keep, self.num_variations_beta, self.num_outcomes)
        )
        self.sigma_alpha_keep = np.zeros(
            (self.num_keep, self.num_outcomes, self.num_outcomes)
        )
        self.sigma_beta_keep = np.zeros(
            (self.num_keep, self.num_outcomes, self.num_outcomes)
        )
        self.mu_hat_keep = np.zeros(
            (
                self.num_keep,
                self.num_variations_alpha,
                self.num_variations_beta,
                self.num_outcomes,
            )
        )
        self.ess_mu = np.zeros((self.num_variations_alpha, self.num_variations_beta))

    def update_params(self, iteration):
        # i used the first seed to initialize the parameters
        this_seed = self.seed + (iteration + 1) * self.num_seeds_per_iter
        this_seed_mu_overall = this_seed
        this_seed_alpha = this_seed_mu_overall + self.num_seeds_alpha
        this_seed_beta = this_seed_alpha + self.num_seeds_beta
        this_seed_sigma_alpha = this_seed_beta + self.num_seeds_sigma_alpha
        this_seed_sigma_beta = this_seed_sigma_alpha + self.num_seeds_sigma_beta
        this_seed_missing_mu_hat = this_seed_sigma_beta + self.num_seeds_mu_individual
        self.update_mu_overall(this_seed_mu_overall, iteration)
        self.update_alpha(this_seed_alpha)
        self.update_beta(this_seed_beta)
        self.update_sigma_alpha(this_seed_sigma_alpha)
        self.update_sigma_beta(this_seed_sigma_beta)
        self.update_missing_mu_hat(this_seed_missing_mu_hat)

    def store_params(self, iteration):
        k = iteration - self.num_burn
        self.mu_overall_keep[k, :] = self.params.mu_overall
        self.mu_keep[k, :, :] = self.params.mu
        self.alpha_keep[k, :, :] = self.params.alpha
        self.beta_keep[k, :, :] = self.params.beta
        self.sigma_alpha_keep[k, :, :] = self.params.sigma_alpha
        self.sigma_beta_keep[k, :, :] = self.params.sigma_beta
        self.mu_hat_keep[k, :, :] = self.mu_hat

    def _default_output(self, error_message: Optional[str] = None) -> MCMCPooledResult:
        """Return uninformative output when AB test analysis can't be performed
        adequately
        """
        zero_array = np.zeros((self.num_outcomes,))
        return MCMCPooledResult(
            mu_mean=zero_array,
            mu_standard_error=zero_array,
            mu_lower=zero_array,
            mu_upper=zero_array,
            error_message=error_message,
        )

    def create_summary(self) -> MCMCPooledResult:
        if self.ratio:
            numerator = self.mu_keep[:, :, :, 0] + self.mu_keep[:, :, :, 1]
            denominator = self.mu_keep[:, :, :, 2] + self.mu_keep[:, :, :, 3]
            mean_treatment = numerator / denominator
            mean_control = self.mu_keep[:, 0, 0, 0] / self.mu_keep[:, 0, 0, 2]
            absolute_effect = mean_treatment - mean_control
        else:
            if self.num_outcomes == 2:
                absolute_effect = copy.deepcopy(self.mu_keep[:, :, :, 1])
                mean_control = np.empty_like(absolute_effect)
                for i in range(self.num_variations_alpha):
                    for j in range(self.num_variations_beta):
                        mean_control[:, i, j] = self.mu_keep[:, 0, 0, 0]
            else:
                absolute_effect = copy.deepcopy(self.mu_keep[:, :, :, 0])
                mean_control = np.ones(absolute_effect.shape)

        if self.relative and np.any(mean_control == 0):
            return self._default_output(error_message=BASELINE_VARIATION_ZERO_MESSAGE)
        samps = (
            absolute_effect / np.abs(mean_control) if self.relative else absolute_effect
        )
        # calculate effective sample size for mu
        for j in range(self.num_variations_alpha):
            for k in range(self.num_variations_beta):
                self.ess_mu[j, k] = ess(samps[:, j, k])
        min_samples = np.min(self.ess_mu)
        if min_samples < self.minimum_mcmc_samples:
            return self._default_output(
                error_message=f"Not enough samples: {min_samples} < {self.minimum_mcmc_samples}"
            )

        mu_mean = np.mean(samps, axis=0)
        mu_standard_error = np.std(samps, axis=0) / np.sqrt(self.num_keep)
        mu_lower = np.quantile(samps, self.false_positive_rate / 2, axis=0)
        mu_upper = np.quantile(samps, 1 - self.false_positive_rate / 2, axis=0)
        return MCMCPooledResult(
            mu_mean=mu_mean,
            mu_standard_error=mu_standard_error,
            mu_lower=mu_lower,
            mu_upper=mu_upper,
        )


class TwoFactorPooling2(TwoFactorPooling):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        psi_alpha = np.zeros_like(self.hyperparams.psi_alpha)
        psi_beta = np.zeros_like(self.hyperparams.psi_beta)
        sigma_alpha = np.zeros_like(self.params.sigma_alpha)
        sigma_beta = np.zeros_like(self.params.sigma_beta)
        np.fill_diagonal(psi_alpha, np.diag(self.hyperparams.psi_alpha))
        np.fill_diagonal(psi_beta, np.diag(self.hyperparams.psi_beta))
        np.fill_diagonal(sigma_alpha, np.diag(self.params.sigma_alpha))
        np.fill_diagonal(sigma_beta, np.diag(self.params.sigma_beta))
        self.hyperparams.psi_alpha = psi_alpha
        self.hyperparams.psi_beta = psi_beta
        self.params.sigma_alpha = sigma_alpha
        self.params.sigma_beta = sigma_beta

    def update_sigma_alpha(self, seed: int):
        nu_post = self.hyperparams.nu_alpha + self.num_variations_alpha
        sum_squares = (self.num_variations_alpha - 1) * np.cov(self.params.alpha.T)
        diag_cov_matrix = np.zeros_like(sum_squares)
        np.fill_diagonal(diag_cov_matrix, np.diag(sum_squares))
        lambda_post = self.hyperparams.psi_alpha + diag_cov_matrix
        for i in range(self.num_outcomes):
            self.params.sigma_alpha[i, i] = (
                random_inverse_wishart(
                    nu_post, np.array(lambda_post[i, i]).reshape(1, 1), seed
                )
                + 1e-5
            )

    def update_sigma_beta(self, seed: int):
        nu_post = self.hyperparams.nu_beta + self.num_variations_beta
        sum_squares = (self.num_variations_beta - 1) * np.cov(self.params.beta.T)
        diag_cov_matrix = np.zeros_like(sum_squares)
        np.fill_diagonal(diag_cov_matrix, np.diag(sum_squares))
        lambda_post = self.hyperparams.psi_alpha + diag_cov_matrix
        for i in range(self.num_outcomes):
            self.params.sigma_beta[i, i] = (
                random_inverse_wishart(
                    nu_post, np.array(lambda_post[i, i]).reshape(1, 1), seed
                )
                + 1e-5
            )

    @property
    def num_seeds_sigma_alpha(self) -> int:
        return self.num_variations_alpha

    @property
    def num_seeds_sigma_beta(self) -> int:
        return self.num_variations_beta
