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
    invert_symmetric_matrix,
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
    num_variations_alpha: int
    num_variations_beta: int


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class ModelParamsTwoFactor:
    mu_overall: np.ndarray  # overall mean
    mu: np.ndarray  # cell means
    alpha: np.ndarray  # row effects
    beta: np.ndarray  # column effects
    sigma_alpha: np.ndarray  # row variances
    sigma_beta: np.ndarray  # column variances


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
        model_data: ModelDataTwoFactor,
        config: MCMCConfig,
        params: Optional[ModelParamsTwoFactor],
    ):
        self.relative = config.difference_type == "relative"
        self.mu_hat = model_data.mu_hat
        self.sigma_hat_inv = model_data.sigma_hat_inv
        self.hyperparams = copy.deepcopy(hyperparams)
        self.num_variations_alpha = self.hyperparams.num_variations_alpha
        self.num_variations_beta = self.hyperparams.num_variations_beta
        self.num_outcomes = self.hyperparams.mu_0.shape[0]
        assert self.num_outcomes in (1, 2), "Number of outcomes must be 1 or 2"
        self.ratio = self.num_outcomes == 2
        self.mu_hat_init = np.zeros(
            (self.num_outcomes, self.num_variations_alpha, self.num_variations_beta)
        )
        self.seed = config.seed
        self.false_positive_rate = config.false_positive_rate
        self.num_burn = config.num_burn
        self.num_keep = config.num_keep
        self.num_iters = self.num_burn + self.num_keep
        self.params = self.initialize_parameters(params)

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
        nu_alpha = num_outcomes + num_variations_alpha + 1
        nu_beta = num_outcomes + num_variations_beta + 1
        psi_alpha = np.array(
            [target_mean_alpha * float(nu_alpha - num_outcomes - 1)]
        ).reshape((num_outcomes, num_outcomes))
        psi_beta = np.array(
            [target_mean_beta * float(nu_beta - num_outcomes - 1)]
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
            num_variations_alpha=num_variations_alpha,
            num_variations_beta=num_variations_beta,
        )
        return hyperparams

    def initialize_parameters(self, params) -> ModelParamsTwoFactor:
        if params is None:
            mu = self.mu_hat_init
            mu[np.isnan(mu)] = np.nanmean(mu)
            mu_overall = np.mean(mu, axis=(1, 2)).ravel()
            alpha = np.mean(mu, axis=2)
            beta = np.mean(mu, axis=1)
            alpha -= np.mean(alpha, keepdims=True)
            beta -= np.mean(beta, keepdims=True)
            sigma_alpha = np.cov(alpha, ddof=1) + 1e-5 * np.eye(self.num_outcomes)
            sigma_beta = np.cov(beta, ddof=1) + 1e-5 * np.eye(self.num_outcomes)
            return ModelParamsTwoFactor(
                mu_overall=mu_overall,
                mu=mu,
                alpha=alpha,
                beta=beta,
                sigma_alpha=sigma_alpha,
                sigma_beta=sigma_beta,
            )
        else:
            return copy.deepcopy(params)

    def run_mcmc(self) -> MCMCPooledResult:
        self.create_storage_arrays()
        self.params = self.initialize_parameters(self.params)
        for i in range(self.num_iters):
            self.update_params(i)
            if i >= self.num_burn:
                self.store_params(i)
        return self.create_summary()

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
        sigma_0_inv = invert_symmetric_matrix(self.hyperparams.sigma_0)
        prec = copy.deepcopy(sigma_0_inv)
        weighted_sum = sigma_0_inv.dot(self.hyperparams.mu_0)
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                prec += self.sigma_hat_inv[:, :, i, j]
                weighted_sum += self.sigma_hat_inv[:, :, i, j].dot(
                    self.mu_hat[:, i, j]
                    - self.params.alpha[:, i]
                    - self.params.beta[:, j]
                )
        mean, variance, matrix_inversion_success = TwoFactorPooling.transform_moments(
            weighted_sum, prec
        )
        if not matrix_inversion_success:
            raise ValueError("Matrix inversion failed in update_mu_overall")
        rng = np.random.default_rng(seed)
        self.params.mu_overall = rng.multivariate_normal(mean, variance, size=1).ravel()
        self.update_mu_individual()

    def update_mu_individual(self):
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                self.params.mu[:, i, j] = (
                    self.params.mu_overall
                    + self.params.alpha[:, i]
                    + self.params.beta[:, j]
                )

    def update_alpha(self, seed: int):
        for i in range(self.num_variations_alpha):
            prec = copy.deepcopy(invert_symmetric_matrix(self.params.sigma_alpha))
            weighted_sum = np.zeros(self.num_outcomes)
            for j in range(self.num_variations_beta):
                prec += self.sigma_hat_inv[:, :, i, j]
                weighted_sum += self.sigma_hat_inv[:, :, i, j].dot(
                    self.mu_hat[:, i, j]
                    - self.params.mu_overall
                    - self.params.beta[:, j]
                )
            (
                mean,
                variance,
                matrix_inversion_success,
            ) = TwoFactorPooling.transform_moments(weighted_sum, prec)
            if not matrix_inversion_success:
                raise ValueError("Matrix inversion failed in update_alpha")
            rng = np.random.default_rng(seed + i)
            self.params.alpha[:, i] = rng.multivariate_normal(
                mean, variance, size=1
            ).ravel()
        self.params.alpha -= np.mean(self.params.alpha, axis=1, keepdims=True)
        self.update_mu_individual()

    def update_beta(self, seed: int):
        for j in range(self.num_variations_beta):
            prec = copy.deepcopy(invert_symmetric_matrix(self.params.sigma_beta))
            weighted_sum = np.zeros(self.num_outcomes)
            for i in range(self.num_variations_alpha):
                prec += self.sigma_hat_inv[:, :, i, j]
                weighted_sum += self.sigma_hat_inv[:, :, i, j].dot(
                    self.mu_hat[:, i, j]
                    - self.params.mu_overall
                    - self.params.alpha[:, i]
                )
            (
                mean,
                variance,
                matrix_inversion_success,
            ) = TwoFactorPooling.transform_moments(weighted_sum, prec)
            if not matrix_inversion_success:
                raise ValueError("Matrix inversion failed in update_beta")
            rng = np.random.default_rng(seed + j)
            self.params.beta[:, j] = rng.multivariate_normal(
                mean, variance, size=1
            ).ravel()
        self.params.beta -= np.mean(self.params.beta, axis=1, keepdims=True)
        self.update_mu_individual()

    def update_sigma_alpha(self, seed: int):
        df = self.hyperparams.nu_alpha + self.num_variations_alpha
        psi = copy.deepcopy(self.hyperparams.psi_alpha)
        for i in range(self.num_variations_alpha):
            psi += np.outer(self.params.alpha[:, i], self.params.alpha[:, i])
        self.params.sigma_alpha = random_inverse_wishart(df, psi, seed)

    def update_sigma_beta(self, seed: int):
        df = self.hyperparams.nu_beta + self.num_variations_beta
        psi = copy.deepcopy(self.hyperparams.psi_beta)
        for j in range(self.num_variations_beta):
            psi += np.outer(self.params.beta[:, j], self.params.beta[:, j])
        self.params.sigma_beta = random_inverse_wishart(df, psi, seed)

    def create_storage_arrays(self):
        self.mu_overall_keep = np.zeros((self.num_keep, self.num_outcomes))
        self.mu_keep = np.zeros(
            (
                self.num_keep,
                self.num_outcomes,
                self.num_variations_alpha,
                self.num_variations_beta,
            )
        )
        self.alpha_keep = np.zeros(
            (self.num_keep, self.num_outcomes, self.num_variations_alpha)
        )
        self.beta_keep = np.zeros(
            (self.num_keep, self.num_outcomes, self.num_variations_beta)
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
                self.num_outcomes,
                self.num_variations_alpha,
                self.num_variations_beta,
            )
        )
        self.ess_mu = np.zeros((self.num_variations_alpha, self.num_variations_beta))
        self.ess_delta = np.zeros((self.num_variations_alpha, self.num_variations_beta))

    def update_params(self, iteration):
        # i used the first seed to initialize the parameters
        this_seed = self.seed + (iteration + 1) * self.num_seeds_per_iter
        this_seed_mu_overall = this_seed
        this_seed_alpha = this_seed_mu_overall + self.num_seeds_alpha
        this_seed_beta = this_seed_alpha + self.num_seeds_beta
        this_seed_sigma_alpha = this_seed_beta + self.num_seeds_sigma_alpha
        this_seed_sigma_beta = this_seed_sigma_alpha + self.num_seeds_sigma_beta
        self.update_mu_overall(this_seed_mu_overall, iteration)
        self.update_alpha(this_seed_alpha)
        self.update_beta(this_seed_beta)
        self.update_sigma_alpha(this_seed_sigma_alpha)
        self.update_sigma_beta(this_seed_sigma_beta)

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
        means = (
            self.mu_keep[:, 0, :, :] / self.mu_keep[:, 1, :, :]
            if self.ratio
            else self.mu_keep[:, :, :, 0]
        )
        mean_control = means[:, 0, 0]
        if self.relative and np.any(mean_control == 0):
            return self._default_output(error_message=BASELINE_VARIATION_ZERO_MESSAGE)
        absolute_effect = np.empty_like(means)
        mean_control_array = np.empty_like(means)
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                absolute_effect[:, i, j] = means[:, i, j] - mean_control
                mean_control_array[:, i, j] = mean_control
        samps = (
            absolute_effect / np.abs(mean_control_array)
            if self.relative
            else absolute_effect
        )
        # calculate effective sample size for mu
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                self.ess_delta[i, j] = ess(samps[:, i, j])
                self.ess_mu[i, j] = ess(means[:, i, j])
        min_samples_delta = np.min(self.ess_delta)
        min_samples_mu = np.min(self.ess_mu)
        min_samples = (
            min_samples_delta if min_samples_delta < min_samples_mu else min_samples_mu
        )
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
