from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Union, List, Optional
from gbstats.frequentist.tests import (
    two_sided_confidence_interval,
    FrequentistTestResult,
)
from gbstats.models.tests import Uplift
import numpy as np
from scipy.stats import norm
from gbstats.utils import multinomial_covariance
from gbstats.models.statistics import (
    SampleMeanStatistic,
    ProportionStatistic,
    RegressionAdjustedStatistic,
    RatioStatistic,
    RegressionAdjustedRatioStatistic,
    compute_theta,
)


@dataclass
class StrataResult:
    n: int
    mean: np.ndarray  # Expected shape: (2,) for count and (4,) for ratio
    covariance: np.ndarray  # Expected shape: (2, 2) for count and (4, 4) for ratio


class BasePostStratification(ABC):
    @property
    @abstractmethod
    def n_a(self) -> int:
        pass

    @property
    @abstractmethod
    def n_b(self) -> int:
        pass

    @property
    def n(self) -> int:
        return self.n_a + self.n_b

    @property
    @abstractmethod
    def strata_means(self) -> np.ndarray:
        pass

    @property
    @abstractmethod
    def len_alpha(self) -> int:
        """
        Number of alpha parameters
        # 1 for count
        # 2 for count CUPED
        # 2 for ratio
        # 4 for ratio CUPED
        """
        pass

    @property
    @abstractmethod
    def lambda_a(self) -> np.ndarray:
        pass

    @property
    @abstractmethod
    def lambda_b(self) -> np.ndarray:
        pass

    @property
    def strata_covariance(self) -> np.ndarray:
        nrow_v = 2 * self.len_alpha
        v = np.zeros((nrow_v, nrow_v))
        v[0 : self.len_alpha, 0 : self.len_alpha] = self.lambda_b * self.n / self.n_b
        v[
            self.len_alpha : (2 * self.len_alpha), self.len_alpha : (2 * self.len_alpha)
        ] = (self.lambda_a * self.n / self.n_a)
        return v

    @property
    @abstractmethod
    def contrast_matrix(self) -> np.ndarray:
        pass

    @property
    def mean(self) -> np.ndarray:
        return self.contrast_matrix.dot(self.strata_means)

    @property
    def covariance(self) -> np.ndarray:
        return self.contrast_matrix.dot(self.strata_covariance).dot(
            self.contrast_matrix.T
        )


# Algorithm 1 for count metrics
class PostStratification(BasePostStratification):
    def __init__(
        self,
        stat_a: Union[ProportionStatistic, SampleMeanStatistic],
        stat_b: Union[ProportionStatistic, SampleMeanStatistic],
        alpha: float = 0.05,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.alpha = alpha

    @property
    def n_a(self) -> int:
        return self.stat_a.n

    @property
    def n_b(self) -> int:
        return self.stat_b.n

    @property
    def len_alpha(self) -> int:
        return 1

    @property
    def strata_means(self) -> np.ndarray:
        return np.array([self.stat_b.mean, self.stat_a.mean])

    @property
    def lambda_a(self) -> np.ndarray:
        return np.array([self.stat_a.variance])

    @property
    def lambda_b(self) -> np.ndarray:
        return np.array([self.stat_b.variance])

    @property
    def contrast_matrix(self) -> np.ndarray:
        return np.array([[0, 1], [1, -1]])

    def compute_result(self) -> StrataResult:
        return StrataResult(self.n, self.mean, self.covariance)


# Regression version of Algorithm 1 for count metrics
class PostStratificationRegressionAdjusted:
    def __init__(
        self,
        stat_a: RegressionAdjustedStatistic,
        stat_b: RegressionAdjustedStatistic,
        alpha: float = 0.05,
        theta: Optional[float] = None,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.alpha = alpha
        self.theta = theta

    @property
    def n_a(self) -> int:
        return self.stat_a.n

    @property
    def n_b(self) -> int:
        return self.stat_b.n

    @property
    def n(self) -> int:
        return self.n_a + self.n_b

    @property
    def len_alpha(self) -> int:
        return 2

    @property
    def len_gamma(self) -> int:
        return 3

    @property
    def xtx(self) -> np.ndarray:
        xtx = np.zeros((self.len_gamma, self.len_gamma))
        xtx[0, 0] = self.n_a + self.n_b
        xtx[1, 1] = self.n_b
        xtx[2, 2] = (
            self.stat_a.pre_statistic.sum_squares
            + self.stat_b.pre_statistic.sum_squares
        )
        xtx[0, 1] = xtx[1, 0] = xtx[1, 1]
        xtx[0, 2] = xtx[2, 0] = (
            self.stat_a.pre_statistic.sum + self.stat_b.pre_statistic.sum
        )
        xtx[1, 2] = xtx[2, 1] = self.stat_b.pre_statistic.sum
        return xtx

    @property
    def xtx_inv(self) -> np.ndarray:
        return np.linalg.inv(self.xtx)

    @property
    def xty(self) -> np.ndarray:
        xty = np.zeros((self.len_gamma, 1))
        xty[0] = self.stat_a.post_statistic.sum + self.stat_b.post_statistic.sum
        xty[1] = self.stat_b.post_statistic.sum
        xty[2] = (
            self.stat_a.post_pre_sum_of_products + self.stat_b.post_pre_sum_of_products
        )
        return xty

    @property
    def gammahat(self) -> np.ndarray:
        return self.xtx_inv.dot(self.xty)

    # covariance matrix, 1 x 1 in this case
    @property
    def sigma(self) -> np.ndarray:
        resids_part_1 = (
            self.stat_a.post_statistic.sum_squares
            + self.stat_b.post_statistic.sum_squares
        )
        resids_part_2 = -self.xty.T.dot(np.linalg.inv(self.xtx)).dot(self.xty)
        return np.array((resids_part_1 + resids_part_2) / (self.n - 3))

    @property
    def baseline_mean(self) -> float:
        statistic_pre = self.stat_a.pre_statistic + self.stat_b.pre_statistic
        return statistic_pre.mean

    @property
    def baseline_variance(self) -> float:
        statistic_pre = self.stat_a.pre_statistic + self.stat_b.pre_statistic
        return statistic_pre.variance

    def contrast_matrix_estimated_mean(self, i: int) -> np.ndarray:
        return np.expand_dims(self.contrast_matrix[i, :], axis=1)

    def contrast_matrix_covariance(self, i: int, j: int) -> np.ndarray:
        v = np.zeros((self.len_gamma, self.len_gamma))
        if i == 0 and j == 0:
            v[2, 2] = self.baseline_variance / self.n
        return v

    def contrast_matrix_second_moment(self, i: int, j: int) -> np.ndarray:
        m_i = self.contrast_matrix_estimated_mean(i)
        m_j = self.contrast_matrix_estimated_mean(j)
        return self.contrast_matrix_covariance(i, j) + m_i.dot(m_j.T)

    @property
    def contrast_matrix(self) -> np.ndarray:
        m = np.zeros((2, 3))
        m[0, :] = [1, 0, self.baseline_mean]
        m[1, :] = [0, 1, 0]
        return m

    @property
    def mean(self) -> np.ndarray:
        return self.contrast_matrix.dot(self.gammahat).ravel()

    @property
    def coef_covariance(self) -> np.ndarray:
        return np.kron(self.sigma, self.xtx_inv)

    @property
    def covariance(self) -> np.ndarray:
        v_alpha = np.zeros((self.len_alpha, self.len_alpha))
        for i in range(self.len_alpha):
            for j in range(i + 1):
                sum_1 = sum(
                    np.diag(
                        self.coef_covariance.dot(
                            self.contrast_matrix_second_moment(i, j)
                        )
                    )
                )
                sum_2 = sum(
                    np.diag(
                        self.gammahat.dot(self.gammahat.T).dot(
                            self.contrast_matrix_covariance(i, j)
                        )
                    )
                )
                v_alpha[i, j] = sum_1 + sum_2
                v_alpha[j, i] = v_alpha[i, j]
        return float(self.n) * v_alpha

    def compute_result(self) -> StrataResult:
        return StrataResult(self.n, self.mean, self.covariance)


# Regression version of Algorithm 1 for ratio metrics
class PostStratificationRegressionAdjustedRatio(PostStratificationRegressionAdjusted):
    def __init__(
        self,
        stat_a: RegressionAdjustedRatioStatistic,
        stat_b: RegressionAdjustedRatioStatistic,
        alpha: float = 0.05,
        theta: Optional[float] = None,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.alpha = alpha
        self.theta = theta

    @property
    def len_alpha(self) -> int:
        return 4

    @property
    def len_gamma(self) -> int:
        return 8

    @property
    def xtx(self) -> np.ndarray:
        xtx = np.zeros((4, 4))
        xtx[0, 0] = self.n_a + self.n_b
        xtx[1, 1] = self.n_b
        xtx[2, 2] = (
            self.stat_a.m_statistic_pre.sum_squares
            + self.stat_b.m_statistic_pre.sum_squares
        )
        xtx[3, 3] = (
            self.stat_a.d_statistic_pre.sum_squares
            + self.stat_b.d_statistic_pre.sum_squares
        )
        xtx[0, 1] = xtx[1, 0] = xtx[1, 1]
        xtx[0, 2] = xtx[2, 0] = (
            self.stat_a.m_statistic_pre.sum + self.stat_b.m_statistic_pre.sum
        )
        xtx[0, 3] = xtx[3, 0] = (
            self.stat_a.d_statistic_pre.sum + self.stat_b.d_statistic_pre.sum
        )
        xtx[1, 2] = xtx[2, 1] = self.stat_b.m_statistic_pre.sum
        xtx[1, 3] = xtx[3, 1] = self.stat_b.d_statistic_pre.sum
        xtx[2, 3] = xtx[3, 2] = (
            self.stat_a.m_pre_d_pre_sum_of_products
            + self.stat_b.m_pre_d_pre_sum_of_products
        )
        return xtx

    @property
    def xty_numerator(self) -> np.ndarray:
        xty = np.zeros((4, 1))
        xty[0] = self.stat_a.m_statistic_post.sum + self.stat_b.m_statistic_post.sum
        xty[1] = self.stat_b.m_statistic_post.sum
        xty[2] = (
            self.stat_a.m_post_m_pre_sum_of_products
            + self.stat_b.m_post_m_pre_sum_of_products
        )
        xty[3] = (
            self.stat_a.m_post_d_pre_sum_of_products
            + self.stat_b.m_post_d_pre_sum_of_products
        )
        return xty

    @property
    def xty_denominator(self) -> np.ndarray:
        xty = np.zeros((4, 1))
        xty[0] = self.stat_a.d_statistic_post.sum + self.stat_b.d_statistic_post.sum
        xty[1] = self.stat_b.d_statistic_post.sum
        xty[2] = (
            self.stat_a.m_pre_d_post_sum_of_products
            + self.stat_b.m_pre_d_post_sum_of_products
        )
        xty[3] = (
            self.stat_a.d_post_d_pre_sum_of_products
            + self.stat_b.d_post_d_pre_sum_of_products
        )
        return xty

    @property
    def gammahat_numerator(self) -> np.ndarray:
        return self.xtx_inv.dot(self.xty_numerator)

    @property
    def gammahat_denominator(self) -> np.ndarray:
        return self.xtx_inv.dot(self.xty_denominator)

    @property
    def gammahat(self) -> np.ndarray:
        return np.concatenate(
            (self.gammahat_numerator, self.gammahat_denominator), axis=0
        )

    @property
    def sigma_1_1(self) -> float:
        resids_part_1 = (
            self.stat_a.m_statistic_post.sum_squares
            + self.stat_b.m_statistic_post.sum_squares
        )
        resids_part_2 = -self.xty_numerator.T.dot(self.xtx_inv).dot(self.xty_numerator)
        return (resids_part_1 + resids_part_2) / (self.n - 6)

    @property
    def sigma_2_2(self) -> float:
        resids_part_1 = (
            self.stat_a.d_statistic_post.sum_squares
            + self.stat_b.d_statistic_post.sum_squares
        )
        resids_part_2 = -self.xty_denominator.T.dot(self.xtx_inv).dot(
            self.xty_denominator
        )
        return (resids_part_1 + resids_part_2) / (self.n - 6)

    @property
    def sigma_1_2(self) -> float:
        resids_part_1 = (
            self.stat_a.m_post_d_post_sum_of_products
            + self.stat_b.m_post_d_post_sum_of_products
        )
        resids_part_2 = -self.xty_numerator.T.dot(self.gammahat_denominator)
        resids_part_3 = -self.xty_denominator.T.dot(self.gammahat_numerator)
        resids_part_4 = self.gammahat_numerator.T.dot(self.xtx).dot(
            self.gammahat_denominator
        )
        return (resids_part_1 + resids_part_2 + resids_part_3 + resids_part_4) / (
            self.n - 6
        )

    @property
    def sigma(self) -> np.ndarray:
        return np.array(
            [[self.sigma_1_1, self.sigma_1_2], [self.sigma_1_2, self.sigma_2_2]]
        ).reshape(2, 2)

    @property
    def baseline_mean_numerator(self) -> float:
        m_statistic_pre = self.stat_a.m_statistic_pre + self.stat_b.m_statistic_pre
        return m_statistic_pre.mean

    @property
    def baseline_mean_denominator(self) -> float:
        d_statistic_pre = self.stat_a.d_statistic_pre + self.stat_b.d_statistic_pre
        return d_statistic_pre.mean

    @property
    def baseline_variance_numerator(self) -> float:
        m_statistic_pre = self.stat_a.m_statistic_pre + self.stat_b.m_statistic_pre
        return m_statistic_pre.variance

    @property
    def baseline_variance_denominator(self) -> float:
        d_statistic_pre = self.stat_a.d_statistic_pre + self.stat_b.d_statistic_pre
        return d_statistic_pre.variance

    @property
    def baseline_covariance(self) -> float:
        stat_combined = self.stat_a + self.stat_b
        return stat_combined.cov_m_pre_d_pre

    @property
    def contrast_matrix(self) -> np.ndarray:
        m = np.zeros((4, 8))
        m[0, :] = [
            1,
            0,
            self.baseline_mean_numerator,
            self.baseline_mean_denominator,
            0,
            0,
            0,
            0,
        ]
        m[1, :] = [0, 1, 0, 0, 0, 0, 0, 0]
        m[2, :] = [
            0,
            0,
            0,
            0,
            1,
            0,
            self.baseline_mean_numerator,
            self.baseline_mean_denominator,
        ]
        m[3, :] = [0, 0, 0, 0, 0, 1, 0, 0]
        return m

    def contrast_matrix_covariance(self, i: int, j: int) -> np.ndarray:
        v = np.zeros((self.len_gamma, self.len_gamma))
        if i == 0 and j == 0:
            v[2, 2] = self.baseline_variance_numerator / self.n
            v[3, 3] = self.baseline_variance_denominator / self.n
            v[2, 3] = v[3, 2] = self.baseline_covariance / self.n

        if i == 2 and j == 2:
            v[6, 6] = self.baseline_variance_numerator / self.n
            v[7, 7] = self.baseline_variance_denominator / self.n
            v[6, 7] = v[7, 6] = self.baseline_covariance / self.n

        if i == 0 and j == 2:
            v[2, 6] = self.baseline_variance_numerator / self.n
            v[3, 7] = self.baseline_variance_denominator / self.n
            v[2, 7] = v[3, 6] = self.baseline_covariance / self.n

        if i == 2 and j == 0:
            v[6, 2] = self.baseline_variance_numerator / self.n
            v[7, 3] = self.baseline_variance_denominator / self.n
            v[7, 2] = v[6, 3] = self.baseline_covariance / self.n

        return v


# Algorithm 1 for CUPED adjusted count metrics
class PostStratificationCupedAdjusted(BasePostStratification):
    def __init__(
        self,
        stat_a: RegressionAdjustedStatistic,
        stat_b: RegressionAdjustedStatistic,
        alpha: float = 0.05,
        theta: Optional[float] = None,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.alpha = alpha
        self.theta = theta

    @property
    def n_a(self) -> int:
        return self.stat_a.n

    @property
    def n_b(self) -> int:
        return self.stat_b.n

    @property
    def len_alpha(self) -> int:
        return 2

    @property
    def lambda_a(self) -> np.ndarray:
        return np.array(
            [
                self.stat_a.post_statistic.variance,
                self.stat_a.covariance,
                self.stat_a.covariance,
                self.stat_a.pre_statistic.variance,
            ]
        ).reshape(self.len_alpha, self.len_alpha)

    @property
    def lambda_b(self) -> np.ndarray:
        return np.array(
            [
                self.stat_b.post_statistic.variance,
                self.stat_b.covariance,
                self.stat_b.covariance,
                self.stat_b.pre_statistic.variance,
            ]
        ).reshape(self.len_alpha, self.len_alpha)

    @property
    def strata_means(self) -> np.ndarray:
        return np.array(
            [
                self.stat_b.post_statistic.mean,
                self.stat_b.pre_statistic.mean,
                self.stat_a.post_statistic.mean,
                self.stat_a.pre_statistic.mean,
            ]
        )

    @property
    def contrast_matrix(self) -> np.ndarray:
        theta = (
            self.theta
            if self.theta is not None
            else compute_theta(self.stat_a, self.stat_b)
        )
        return np.array([[0, 0, 1, 0], [1, -theta, -1, theta]])

    def compute_result(self) -> StrataResult:
        return StrataResult(self.n, self.mean, self.covariance)


# Algorithm 1 for ratio metrics
class PostStratificationRatio(BasePostStratification):
    def __init__(
        self,
        stat_a: RatioStatistic,
        stat_b: RatioStatistic,
        alpha: float = 0.05,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.alpha = alpha

    @property
    def n_a(self) -> int:
        return self.stat_a.n

    @property
    def n_b(self) -> int:
        return self.stat_b.n

    @property
    def len_alpha(self) -> int:
        return 2

    @property
    def lambda_a(self) -> np.ndarray:
        return np.array(
            [
                self.stat_a.m_statistic.variance,
                self.stat_a.covariance,
                self.stat_a.covariance,
                self.stat_a.d_statistic.variance,
            ]
        ).reshape(self.len_alpha, self.len_alpha)

    @property
    def lambda_b(self) -> np.ndarray:
        return np.array(
            [
                self.stat_b.m_statistic.variance,
                self.stat_b.covariance,
                self.stat_b.covariance,
                self.stat_b.d_statistic.variance,
            ]
        ).reshape(self.len_alpha, self.len_alpha)

    @property
    def strata_means(self) -> np.ndarray:
        return np.array(
            [
                self.stat_b.m_statistic.mean,
                self.stat_b.d_statistic.mean,
                self.stat_a.m_statistic.mean,
                self.stat_a.d_statistic.mean,
            ]
        )

    @property
    def contrast_matrix(self) -> np.ndarray:
        return np.array([[0, 0, 1, 0], [1, 0, -1, 0], [0, 0, 0, 1], [0, 1, 0, -1]])

    def compute_result(self) -> StrataResult:
        return StrataResult(self.n, self.mean, self.covariance)


# Algorithm 1 for CUPED adjusted ratio metrics
class PostStratificationCupedAdjustedRatio(BasePostStratification):
    def __init__(
        self,
        stat_a: RegressionAdjustedRatioStatistic,
        stat_b: RegressionAdjustedRatioStatistic,
        alpha: float = 0.05,
        theta_numerator_override: Optional[float] = None,
        theta_denominator_override: Optional[float] = None,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.alpha = alpha
        self.theta_numerator_override = theta_numerator_override
        self.theta_denominator_override = theta_denominator_override

    @property
    def n_a(self) -> int:
        return self.stat_a.n

    @property
    def n_b(self) -> int:
        return self.stat_b.n

    @property
    def len_alpha(self) -> int:
        return 4

    @property
    def lambda_a(self) -> np.ndarray:
        return self.stat_a.lambda_matrix

    @property
    def lambda_b(self) -> np.ndarray:
        return self.stat_b.lambda_matrix

    @property
    def strata_means(self) -> np.ndarray:
        return np.array(
            [
                self.stat_b.m_statistic_post.mean,
                self.stat_b.d_statistic_post.mean,
                self.stat_b.m_statistic_pre.mean,
                self.stat_b.d_statistic_pre.mean,
                self.stat_a.m_statistic_post.mean,
                self.stat_a.d_statistic_post.mean,
                self.stat_a.m_statistic_pre.mean,
                self.stat_a.d_statistic_pre.mean,
            ]
        )

    @property
    def theta_numerator(self) -> float:
        if self.theta_numerator_override:
            return self.theta_numerator_override
        a = RegressionAdjustedStatistic(
            n=self.stat_a.n,
            post_statistic=self.stat_a.m_statistic_post,
            pre_statistic=self.stat_a.m_statistic_pre,
            post_pre_sum_of_products=self.stat_a.m_post_m_pre_sum_of_products,
            theta=0,
        )
        b = RegressionAdjustedStatistic(
            n=self.stat_b.n,
            post_statistic=self.stat_b.m_statistic_post,
            pre_statistic=self.stat_b.m_statistic_pre,
            post_pre_sum_of_products=self.stat_b.m_post_m_pre_sum_of_products,
            theta=0,
        )
        return compute_theta(a, b)

    @property
    def theta_denominator(self) -> float:
        if self.theta_denominator_override:
            return self.theta_denominator_override
        a = RegressionAdjustedStatistic(
            n=self.stat_a.n,
            post_statistic=self.stat_a.d_statistic_post,
            pre_statistic=self.stat_a.d_statistic_pre,
            post_pre_sum_of_products=self.stat_a.d_post_d_pre_sum_of_products,
            theta=0,
        )
        b = RegressionAdjustedStatistic(
            n=self.stat_b.n,
            post_statistic=self.stat_b.d_statistic_post,
            pre_statistic=self.stat_b.d_statistic_pre,
            post_pre_sum_of_products=self.stat_b.d_post_d_pre_sum_of_products,
            theta=0,
        )
        return compute_theta(a, b)

    @property
    def contrast_matrix(self) -> np.ndarray:
        return np.array(
            [
                [0, 0, 0, 0, 1, 0, 0, 0],
                [1, 0, -self.theta_numerator, 0, -1, 0, self.theta_numerator, 0],
                [0, 0, 0, 0, 0, 1, 0, 0],
                [0, 1, 0, -self.theta_denominator, 0, -1, 0, self.theta_denominator],
            ]
        )

    def compute_result(self) -> StrataResult:
        return StrataResult(self.n, self.mean, self.covariance)


# Algorithm 4
class PostStratificationSummary:
    def __init__(
        self,
        stats: List[StrataResult],
        nu_hat: Optional[np.ndarray] = None,
        relative: bool = True,
        alpha: float = 0.05,
    ):
        self.stats = stats
        self.nu_hat = (
            nu_hat
            if nu_hat is not None
            else np.array([stat.n for stat in stats])
            / np.sum([stat.n for stat in stats])
        )
        self.relative = relative
        self.alpha = alpha

    @property
    def n(self) -> np.ndarray:
        return np.array([stat.n for stat in self.stats])

    @property
    def n_total(self) -> int:
        return int(np.sum(self.n).item())

    @property
    def len_alpha(self) -> int:
        return 2

    @property
    def num_cells(self) -> int:
        return len(self.stats)

    @property
    def alpha_hat(self) -> np.ndarray:
        return np.array([stat.mean for stat in self.stats])

    @property
    def alpha_matrix(self) -> np.ndarray:
        alpha_matrix = np.zeros((self.len_alpha, self.num_cells))
        for i, stat in enumerate(self.stats):
            alpha_matrix[:, i] = stat.mean
        return alpha_matrix

    @property
    def mean(self) -> np.ndarray:
        return self.alpha_matrix.dot(self.nu_hat)

    @property
    def covariance_nu(self) -> np.ndarray:
        return multinomial_covariance(self.nu_hat) / self.n_total

    @property
    def covariance_part_1(self) -> np.ndarray:
        return self.alpha_matrix.dot(self.covariance_nu).dot(self.alpha_matrix.T)

    @staticmethod
    def multinomial_third_moments(
        nu: np.ndarray, index_0: int, index_1: int, index_2: int, n_total: int
    ) -> float:
        """
        Third moments from multinomial distribution, e.g., E(x[index_0] * x[index_1] * x[index_2])
        from Quiment 2020 https://arxiv.org/pdf/2006.09059 Equation 3.3

        Args:
            nu: Array of probabilities that sum to 1
            index_0, index_1, index_2: Indices for the third moment calculation
            n_total: Total number of trials

        Returns:
            The third moment value
        """
        coef = n_total * (n_total - 1) * (n_total - 2)
        coef_same_1 = 3 * n_total * (n_total - 1)
        coef_same_2 = n_total
        coef_one_diff = n_total * (n_total - 1)

        if index_0 == index_1 and index_0 == index_2:
            return (
                coef * nu[index_0] ** 3
                + coef_same_1 * nu[index_0] ** 2
                + coef_same_2 * nu[index_0]
            )
        elif index_0 == index_1 and index_0 != index_2:
            # case where i == j, but i != l
            return (
                coef * nu[index_0] ** 2 * nu[index_2]
                + coef_one_diff * nu[index_0] * nu[index_2]
                + coef_same_2 * nu[index_0]
            )
        elif index_1 == index_2 and index_0 != index_2:
            return (
                coef * nu[index_0] ** 2 * nu[index_1]
                + coef_one_diff * nu[index_0] * nu[index_1]
                + coef_same_2 * nu[index_1]
            )
        else:
            raise ValueError("Invalid combination of indices")

    @property
    def third_moments_matrix(self) -> np.ndarray:
        """
        Calculate and normalize theoretical third moments matrix for a multinomial distribution.

        Args:
            n: Array of counts

        Returns:
            Normalized matrix of third moments
        """
        # Initialize matrix for theoretical moments
        moments_theoretical_y = np.empty((self.num_cells, self.num_cells))

        # Calculate third moments for each cell combination
        for i in range(self.num_cells):
            for j in range(self.num_cells):
                moments_theoretical_y[i, j] = self.multinomial_third_moments(
                    self.nu_hat, i, j, j, self.n_total
                )

        # Normalize by n_total^3
        nu_mat = moments_theoretical_y / (self.n_total**3)

        return nu_mat

    @property
    def v_full(self) -> np.ndarray:
        v_full = np.empty((self.num_cells, self.len_alpha, self.len_alpha))
        for cell in range(self.num_cells):
            v_full[cell] = self.stats[cell].covariance / self.nu_hat[cell]
        return v_full

    @property
    def covariance_part_2(self) -> np.ndarray:
        covariance_2 = np.zeros((self.len_alpha, self.len_alpha))
        for row in range(self.len_alpha):
            for col in range(self.len_alpha):
                covariance_2[row, col] = np.sum(
                    np.diag(self.v_full[:, row, col]).dot(self.third_moments_matrix)
                )
        return covariance_2 / self.n_total

    @property
    def covariance(self) -> np.ndarray:
        return self.covariance_part_1 + self.covariance_part_2

    @property
    def nabla(self) -> np.ndarray:
        if self.relative:
            if self.mean[0] == 0:
                return np.zeros((self.len_alpha,))
            else:
                return np.array([-self.mean[1] / self.mean[0] ** 2, 1 / self.mean[0]])
        else:
            return np.array([0, 1])

    @property
    def point_estimate(self) -> float:
        if self.relative:
            if self.mean[0] == 0:
                return 0
            else:
                return self.mean[1] / self.mean[0]
        else:
            return self.mean[1]

    @property
    def estimated_variance(self) -> float:
        return float(self.nabla.T.dot(self.covariance).dot(self.nabla))

    @property
    def halfwidth(self) -> float:
        return norm.ppf(1 - self.alpha / 2) * np.sqrt(self.estimated_variance)

    @property
    def p_value(self) -> float:
        return 2 * (1 - norm.cdf(abs(self.point_estimate) / np.sqrt(self.estimated_variance)))  # type: ignore

    @property
    def unadjusted_baseline_mean(self) -> float:
        return self.mean[0]

    def compute_result(self) -> FrequentistTestResult:
        return FrequentistTestResult(
            expected=self.point_estimate,
            ci=two_sided_confidence_interval(self.point_estimate, self.halfwidth),
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate,
                stddev=np.sqrt(self.estimated_variance),
            ),
            error_message=None,
            p_value=self.p_value,
            p_value_error_message=None,
            unadjusted_baseline_mean=self.unadjusted_baseline_mean,
            n=self.n_total,
        )


# Algorithm 3
class PostStratificationSummaryRatio(PostStratificationSummary):
    def __init__(
        self,
        stats: List[StrataResult],
        nu_hat: np.ndarray,
        relative: bool = True,
        alpha: float = 0.05,
    ):
        self.stats = stats
        self.nu_hat = nu_hat
        self.relative = relative
        self.alpha = alpha

    @property
    def len_alpha(self) -> int:
        return 4

    @property
    def nabla(self) -> np.ndarray:
        if self.mean[2] == 0 or self.mean[3] == 0:
            return np.zeros((self.len_alpha,))
        nabla = np.empty((self.len_alpha,))

        if self.relative:
            if self.mean[0] == 0:
                return np.zeros((self.len_alpha,))
            else:
                nabla[0] = (
                    self.mean[2] * self.point_estimate_rel_denominator
                    - (self.mean[2] + self.mean[3]) * self.point_estimate_rel_numerator
                ) / self.point_estimate_rel_denominator**2
                nabla[1] = self.mean[2] / self.point_estimate_rel_denominator
                nabla[2] = (
                    (self.mean[0] + self.mean[1]) * self.point_estimate_rel_denominator
                    - self.mean[0] * self.point_estimate_rel_numerator
                ) / self.point_estimate_rel_denominator**2
                nabla[3] = -self.point_estimate_rel_numerator / (
                    self.mean[0] * (self.mean[2] + self.mean[3]) ** 2
                )

        else:
            nabla[1] = 1 / (self.mean[2] + self.mean[3])
            nabla[0] = nabla[1] - 1 / self.mean[2]
            nabla[3] = -(self.mean[0] + self.mean[1]) / (
                (self.mean[2] + self.mean[3]) ** 2
            )
            nabla[2] = nabla[3] + self.mean[0] / self.mean[2] ** 2
        return nabla

    @property
    def point_estimate_rel_numerator(self) -> float:
        return self.mean[2] * (self.mean[0] + self.mean[1])

    @property
    def point_estimate_rel_denominator(self) -> float:
        return self.mean[0] * (self.mean[2] + self.mean[3])

    @property
    def point_estimate(self) -> float:
        if self.relative:
            if self.point_estimate_rel_denominator == 0:
                return 0
            else:
                return (
                    self.point_estimate_rel_numerator
                    / self.point_estimate_rel_denominator
                    - 1
                )
        else:
            mn_trt_num = self.mean[0] + self.mean[1]
            mn_trt_den = self.mean[2] + self.mean[3]
            mn_ctrl_num = self.mean[0]
            mn_ctrl_den = self.mean[2]
            if mn_trt_den == 0 or mn_ctrl_den == 0:
                return 0
            else:
                return mn_trt_num / mn_trt_den - mn_ctrl_num / mn_ctrl_den

    @property
    def unadjusted_baseline_mean(self) -> float:
        if self.mean[2] == 0:
            return 0
        else:
            return self.mean[0] / self.mean[2]


def nu_adjusted(nu_hat, n) -> np.ndarray:
    return nu_hat * np.sqrt(1 + (1 - nu_hat) / n)


class PostStratificationSummaryXie(PostStratificationSummary):
    @property
    def covariance_naive(self) -> np.ndarray:
        v = np.zeros((self.len_alpha, self.len_alpha))
        for i, stat in enumerate(self.stats):
            v += stat.covariance * self.nu_hat[i] ** 2
        return v

    @property
    def nu_adjusted(self) -> np.ndarray:
        return nu_adjusted(self.nu_hat, self.n)

    @property
    def covariance(self) -> np.ndarray:
        v = np.zeros((self.len_alpha, self.len_alpha))
        for i, stat in enumerate(self.stats):
            v += stat.covariance * self.nu_adjusted[i] ** 2 / self.n[i]
        return v


class PostStratificationSummaryXieRatio(PostStratificationSummaryRatio):
    @property
    def nu_adjusted(self) -> np.ndarray:
        return nu_adjusted(self.nu_hat, self.n)

    @property
    def covariance(self) -> np.ndarray:
        v = np.zeros((self.len_alpha, self.len_alpha))
        for i, stat in enumerate(self.stats):
            v += stat.covariance * self.nu_adjusted[i] ** 2 / self.n[i]
        return v
