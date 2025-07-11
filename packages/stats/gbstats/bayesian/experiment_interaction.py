from typing import Optional, Tuple, Union
import numpy as np
import copy
from pydantic import ConfigDict
from pydantic.dataclasses import dataclass
from typing import Literal
from gbstats.utils import invert_symmetric_matrix, random_inverse_wishart
from arviz import ess
from gbstats.messages import BASELINE_VARIATION_ZERO_MESSAGE
from gbstats.models.statistics import (
    SampleMeanStatistic,
    ProportionStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
    RegressionAdjustedRatioStatistic,
)


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


class CreateModelData:
    def __init__(
        self,
        stats: np.ndarray,
    ):
        self.stats = stats
        self.num_variations_alpha = stats.shape[0]
        self.num_variations_beta = stats.shape[1]
        self.check_input_type()

    def check_input_type(self):
        valid_stats = Union[SampleMeanStatistic, ProportionStatistic]
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                if not isinstance(self.stats[i, j], valid_stats):
                    raise ValueError(
                        "Input must be a numpy array of type " + str(valid_stats)
                    )

    @property
    def num_outcomes(self) -> int:
        return 1

    def create_model_data(self) -> ModelDataTwoFactor:
        self.mu_hat = np.empty(
            (self.num_outcomes, self.num_variations_alpha, self.num_variations_beta)
        )
        self.sigma_hat_inv = np.empty(
            (
                self.num_outcomes,
                self.num_outcomes,
                self.num_variations_alpha,
                self.num_variations_beta,
            )
        )
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                self.mu_hat[0, i, j] = self.stats[i, j].mean
                sigma_hat = np.array(
                    [[self.stats[i, j].variance / self.stats[i, j].n]]
                ).reshape((self.num_outcomes, self.num_outcomes))
                self.sigma_hat_inv[0, 0, i, j] = invert_symmetric_matrix(sigma_hat)
        return ModelDataTwoFactor(mu_hat=self.mu_hat, sigma_hat_inv=self.sigma_hat_inv)


class CreateModelDataRatio(CreateModelData):
    def check_input_type(self):
        valid_stats = RatioStatistic
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                if not isinstance(self.stats[i, j], valid_stats):
                    raise ValueError(
                        "Input must be a numpy array of type " + str(valid_stats)
                    )

    @property
    def num_outcomes(self) -> int:
        return 2

    def create_model_data(self) -> ModelDataTwoFactor:
        self.mu_hat = np.empty(
            (self.num_outcomes, self.num_variations_alpha, self.num_variations_beta)
        )
        self.sigma_hat_inv = np.empty(
            (
                self.num_outcomes,
                self.num_outcomes,
                self.num_variations_alpha,
                self.num_variations_beta,
            )
        )
        sigma_hat = np.empty((self.num_outcomes, self.num_outcomes))
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                self.mu_hat[0, i, j] = self.stats[i, j].m_statistic.mean
                self.mu_hat[1, i, j] = self.stats[i, j].d_statistic.mean
                sigma_hat[0, 0] = (
                    self.stats[i, j].m_statistic.variance
                    / self.stats[i, j].m_statistic.n
                )
                sigma_hat[0, 1] = (
                    self.stats[i, j].covariance / self.stats[i, j].m_statistic.n
                )
                sigma_hat[1, 0] = sigma_hat[0, 1]
                sigma_hat[1, 1] = (
                    self.stats[i, j].d_statistic.variance
                    / self.stats[i, j].d_statistic.n
                )
                self.sigma_hat_inv[:, :, i, j] = invert_symmetric_matrix(sigma_hat)
        return ModelDataTwoFactor(mu_hat=self.mu_hat, sigma_hat_inv=self.sigma_hat_inv)


class CreateModelDataRegressionAdjusted(CreateModelData):
    def check_input_type(self):
        valid_stats = RegressionAdjustedStatistic
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                if not isinstance(self.stats[i, j], valid_stats):
                    raise ValueError(
                        "Input must be a numpy array of type " + str(valid_stats)
                    )

    @property
    def mean_vec(self) -> np.ndarray:
        x_sum = 0
        n = 0
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                x_sum += self.stats[i, j].pre_statistic.sum
                n += self.stats[i, j].pre_statistic.n
        x_bar = x_sum / n if n > 0 else 0
        return np.array([1, x_bar])

    @staticmethod
    def regress(
        statistic: RegressionAdjustedStatistic,
    ) -> Tuple[np.ndarray, np.ndarray]:
        if (
            statistic.n == 0
            or statistic.pre_statistic.sum == 0
            or statistic.post_statistic.variance == 0
        ):
            beta_hat = np.array([statistic.post_statistic.mean, 0])
            sigma_hat = np.zeros((2, 2))
            if statistic.post_statistic.variance > 0:
                sigma_hat[0, 0] = statistic.post_statistic.variance / statistic.n
        else:
            xtx = np.empty((2, 2))
            xty = np.empty(2)
            xtx[0, 0] = statistic.n
            xtx[0, 1] = statistic.pre_statistic.sum
            xtx[1, 0] = statistic.pre_statistic.sum
            xtx[1, 1] = statistic.pre_statistic.sum_squares
            xty[0] = statistic.post_statistic.sum
            xty[1] = statistic.post_pre_sum_of_products
            xtx_inv = invert_symmetric_matrix(xtx)
            beta_hat = xtx_inv.dot(xty)
            resids_ss_part_1 = statistic.post_statistic.sum_squares
            resids_ss_part_2 = -2 * xty.T.dot(beta_hat)
            resids_ss_part_3 = beta_hat.T.dot(xtx).dot(beta_hat)
            sigma_2 = (resids_ss_part_1 + resids_ss_part_2 + resids_ss_part_3) / (
                statistic.n - 2
            )
            sigma_hat = sigma_2 * xtx_inv
        return beta_hat, sigma_hat

    def create_model_data(self) -> ModelDataTwoFactor:
        self.mu_hat = np.empty(
            (self.num_outcomes, self.num_variations_alpha, self.num_variations_beta)
        )
        self.sigma_hat_inv = np.empty(
            (
                self.num_outcomes,
                self.num_outcomes,
                self.num_variations_alpha,
                self.num_variations_beta,
            )
        )
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                beta_hat, sigma_hat = self.regress(self.stats[i, j])
                self.mu_hat[0 : self.num_outcomes, i, j] = self.mean_vec.T.dot(beta_hat)
                self.sigma_hat_inv[:, :, i, j] = 1 / self.mean_vec.T.dot(sigma_hat).dot(
                    self.mean_vec
                )
        return ModelDataTwoFactor(mu_hat=self.mu_hat, sigma_hat_inv=self.sigma_hat_inv)


class CreateModelDataRegressionAdjustedRatio(CreateModelDataRegressionAdjusted):
    def check_input_type(self):
        valid_stats = RegressionAdjustedRatioStatistic
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                if not isinstance(self.stats[i, j], valid_stats):
                    raise ValueError(
                        "Input must be a numpy array of type " + str(valid_stats)
                    )

    @property
    def num_outcomes(self) -> int:
        return 2

    @property
    def mean_vec(self) -> np.ndarray:
        x_num_sum = 0
        x_den_sum = 0
        n = 0
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                x_num_sum += self.stats[i, j].m_statistic_pre.sum
                x_den_sum += self.stats[i, j].d_statistic_pre.sum
                n += self.stats[i, j].n
        x_num_bar = x_num_sum / n if n > 0 else 0
        x_den_bar = x_den_sum / n if n > 0 else 0
        return np.array([1, x_num_bar, x_den_bar])

    @staticmethod
    def regress_ratio(
        statistic: RegressionAdjustedRatioStatistic,
    ) -> Tuple[np.ndarray, np.ndarray]:
        if (
            statistic.n == 0
            or statistic.m_statistic_pre.sum == 0
            or statistic.d_statistic_pre.sum == 0
        ):
            beta_hat = np.array(
                [
                    statistic.m_statistic_post.mean,
                    0,
                    0,
                    statistic.d_statistic_post.mean,
                    0,
                    0,
                ]
            )
            beta_hat_cov = np.zeros((6, 6))
            if statistic.m_statistic_post.variance > 0:
                beta_hat_cov[0, 0] = statistic.m_statistic_post.variance / statistic.n
            if statistic.d_statistic_post.variance > 0:
                beta_hat_cov[3, 3] = statistic.d_statistic_post.variance / statistic.n
        else:
            xtx = np.empty((3, 3))
            xty_num = np.empty(3)
            xty_den = np.empty(3)
            xtx[0, 0] = statistic.n
            xtx[1, 1] = statistic.m_statistic_pre.sum_squares
            xtx[2, 2] = statistic.d_statistic_pre.sum_squares

            xtx[1, 0] = statistic.m_statistic_pre.sum
            xtx[2, 0] = statistic.d_statistic_pre.sum
            xtx[1, 2] = statistic.m_pre_d_pre_sum_of_products
            xtx[0, 1] = xtx[1, 0]
            xtx[0, 2] = xtx[2, 0]
            xtx[2, 1] = xtx[1, 2]
            xty_num[0] = statistic.m_statistic_post.sum
            xty_num[1] = statistic.m_post_m_pre_sum_of_products
            xty_num[2] = statistic.m_post_d_pre_sum_of_products
            xty_den[0] = statistic.d_statistic_post.sum
            xty_den[1] = statistic.m_pre_d_post_sum_of_products
            xty_den[2] = statistic.d_post_d_pre_sum_of_products

            xtx_inv = invert_symmetric_matrix(xtx)
            beta_hat_num = xtx_inv.dot(xty_num)
            beta_hat_den = xtx_inv.dot(xty_den)
            beta_hat = np.concatenate((beta_hat_num, beta_hat_den))

            resids_ss_num_part_1 = statistic.m_statistic_post.sum_squares
            resids_ss_num_part_2 = -2 * xty_num.T.dot(beta_hat_num)
            resids_ss_num_part_3 = beta_hat_num.T.dot(xtx).dot(beta_hat_num)
            resids_ss_den_part_1 = statistic.d_statistic_post.sum_squares
            resids_ss_den_part_2 = -2 * xty_den.T.dot(beta_hat_den)
            resids_ss_den_part_3 = beta_hat_den.T.dot(xtx).dot(beta_hat_den)

            resids_ss_num_den_part_1 = statistic.m_post_d_post_sum_of_products
            resids_ss_num_den_part_2 = xty_num.T.dot(beta_hat_den)
            resids_ss_num_den_part_3 = xty_den.T.dot(beta_hat_num)
            resids_ss_num_den_part_4 = beta_hat_num.T.dot(xtx).dot(beta_hat_den)

            sigma_hat = np.zeros((2, 2))
            sigma_hat[0, 0] = (
                resids_ss_num_part_1 + resids_ss_num_part_2 + resids_ss_num_part_3
            ) / (statistic.n - 3)
            sigma_hat[1, 1] = (
                resids_ss_den_part_1 + resids_ss_den_part_2 + resids_ss_den_part_3
            ) / (statistic.n - 3)
            sigma_hat[1, 0] = (
                resids_ss_num_den_part_1
                - resids_ss_num_den_part_2
                - resids_ss_num_den_part_3
                + resids_ss_num_den_part_4
            ) / (statistic.n - 3)
            sigma_hat[0, 1] = sigma_hat[1, 0]
            beta_hat_cov = np.kron(sigma_hat, xtx_inv)
        return beta_hat, beta_hat_cov

    def create_model_data(self) -> ModelDataTwoFactor:
        self.mu_hat = np.empty(
            (self.num_outcomes, self.num_variations_alpha, self.num_variations_beta)
        )
        self.sigma_hat_inv = np.empty(
            (
                self.num_outcomes,
                self.num_outcomes,
                self.num_variations_alpha,
                self.num_variations_beta,
            )
        )
        for i in range(self.num_variations_alpha):
            for j in range(self.num_variations_beta):
                beta_hat, beta_hat_cov = self.regress_ratio(self.stats[i, j])
                self.mu_hat[0, i, j] = self.mean_vec.T.dot(beta_hat[:3])
                self.mu_hat[1, i, j] = self.mean_vec.T.dot(beta_hat[3:])
                sigma_hat = np.zeros((2, 2))
                sigma_hat[0, 0] = self.mean_vec.T.dot(beta_hat_cov[:3, :3]).dot(
                    self.mean_vec
                )
                sigma_hat[1, 1] = self.mean_vec.T.dot(beta_hat_cov[3:, 3:]).dot(
                    self.mean_vec
                )
                sigma_hat[0, 1] = self.mean_vec.T.dot(beta_hat_cov[:3, 3:]).dot(
                    self.mean_vec
                )
                sigma_hat[1, 0] = sigma_hat[0, 1]
                self.sigma_hat_inv[:, :, i, j] = invert_symmetric_matrix(sigma_hat)
        return ModelDataTwoFactor(mu_hat=self.mu_hat, sigma_hat_inv=self.sigma_hat_inv)


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
        num_outcomes = mu_hat.shape[0]
        num_variations_alpha = mu_hat.shape[1]
        num_variations_beta = mu_hat.shape[2]
        mns_alpha = np.nanmean(mu_hat, axis=2)
        mns_beta = np.nanmean(mu_hat, axis=1)
        target_mean_alpha = np.cov(mns_alpha, ddof=1)
        target_mean_beta = np.cov(mns_beta, ddof=1)
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
            else self.mu_keep[:, 0, :, :]
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
