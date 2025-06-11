from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Union, List, Optional
import numpy as np
from gbstats.models.statistics import (
    SampleMeanStatistic,
    ProportionStatistic,
    RegressionAdjustedStatistic,
    RatioStatistic,
    RegressionAdjustedRatioStatistic,
    compute_theta,
)


@dataclass
class CellResult:
    n: int
    sample_mean: np.ndarray  # Expected shape: (2,) for count and (4,) for ratio
    sample_covariance: np.ndarray  # Expected shape: (2, 2) for count and (4, 4) for ratio


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
        return np.array([[1, 0], [1, -1]])

    def compute_result(self) -> CellResult:
        return CellResult(self.n, self.mean, self.covariance)


# Regression version of Algorithm 1 for count metrics
class PostStratificationRegressionAdjustedSharedTheta:
    def __init__(
        self,
        stat_a: List[RegressionAdjustedStatistic],
        stat_b: List[RegressionAdjustedStatistic],
        alpha: float = 0.05,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.alpha = alpha

    @property
    def num_cells(self) -> int:
        return len(self.stat_a)

    @property
    def n_a(self) -> np.ndarray:
        return np.array([stat.n for stat in self.stat_a])

    @property
    def n_b(self) -> np.ndarray:
        return np.array([stat.n for stat in self.stat_b])

    @property
    def n(self) -> np.ndarray:
        return self.n_a + self.n_b

    @property
    def n_total(self) -> int:
        return np.sum(self.n)

    @property
    def len_alpha(self) -> int:
        return 2

    @property
    def len_gamma(self) -> int:
        return 2 * self.num_cells + 1

    @property
    def xtx(self) -> np.ndarray:
        xtx = np.zeros((self.len_gamma, self.len_gamma))
        for cell in range(self.num_cells):
            start = cell * 2
            xtx[start, start] = self.n[cell]
            xtx[start + 1, start] = self.n_b[cell]
            xtx[start, start + 1] = xtx[start + 1, start]
            xtx[start + 1, start + 1] = self.n_b[cell]
            xtx[start, self.len_gamma - 1] = (
                self.stat_a[cell].pre_statistic.sum
                + self.stat_b[cell].pre_statistic.sum
            )
            xtx[start + 1, self.len_gamma - 1] = self.stat_b[cell].pre_statistic.sum
            xtx[self.len_gamma - 1, start] = xtx[start, self.len_gamma - 1]
            xtx[self.len_gamma - 1, start + 1] = xtx[start + 1, self.len_gamma - 1]
            xtx[self.len_gamma - 1, self.len_gamma - 1] += (
                self.stat_a[cell].pre_statistic.sum_squares
                + self.stat_b[cell].pre_statistic.sum_squares
            )
        return xtx

    @property
    def xty(self) -> np.ndarray:
        xty = np.zeros((self.len_gamma, 1))
        for cell in range(self.num_cells):
            start = cell * 2
            xty[start] = (
                self.stat_a[cell].post_statistic.sum
                + self.stat_b[cell].post_statistic.sum
            )
            xty[start + 1] = self.stat_b[cell].post_statistic.sum
            xty[self.len_gamma - 1] += (
                self.stat_a[cell].post_pre_sum_of_products
                + self.stat_b[cell].post_pre_sum_of_products
            )
        return xty

    @property
    def xtx_inv(self) -> np.ndarray:
        return np.linalg.inv(self.xtx)

    @property
    def gammahat(self) -> np.ndarray:
        return self.xtx_inv.dot(self.xty)

    @property
    def sigma(self) -> np.ndarray:
        resids_part_1 = 0
        for cell in range(self.num_cells):
            resids_part_1 += (
                self.stat_a[cell].post_statistic.sum_squares
                + self.stat_b[cell].post_statistic.sum_squares
            )
        resids_part_2 = -self.xty.T.dot(self.xtx_inv).dot(self.xty)
        return np.array(
            (resids_part_1 + resids_part_2) / (self.n_total - self.len_gamma)
        )

    @property
    def coef_covariance(self) -> np.ndarray:
        return np.kron(self.sigma, self.xtx_inv)

    @property
    def baseline_statistic_combined(self) -> SampleMeanStatistic:
        statistic_pre = SampleMeanStatistic(n=0, sum=0, sum_squares=0)
        for cell in range(self.num_cells):
            statistic_pre += (
                self.stat_a[cell].pre_statistic + self.stat_b[cell].pre_statistic
            )
        return statistic_pre

    @property
    def baseline_variance(self) -> float:
        return self.baseline_statistic_combined.variance

    @property
    def contrast_matrix(self) -> np.ndarray:
        m = np.zeros((2 * self.num_cells, self.len_gamma))
        for cell in range(self.num_cells):
            statistic_pre = (
                self.stat_a[cell].pre_statistic + self.stat_b[cell].pre_statistic
            )
            start = cell * 2
            m[start, start] = 1
            m[start, self.len_gamma - 1] = statistic_pre.mean
            m[start + 1, start + 1] = 1
        return m

    def contrast_matrix_estimated_mean(self, i: int) -> np.ndarray:
        return np.expand_dims(self.contrast_matrix[i, :], axis=1)

    def contrast_matrix_covariance(self, i: int, j: int) -> np.ndarray:
        v = np.zeros((self.len_gamma, self.len_gamma))
        if i % 2 == 0 and j % 2 == 0:
            cell_i = int(i / self.len_alpha)
            cell_j = int(j / self.len_alpha)
            statistic_pre_i = (
                self.stat_a[cell_i].pre_statistic + self.stat_b[cell_i].pre_statistic
            )
            statistic_pre_j = (
                self.stat_a[cell_j].pre_statistic + self.stat_b[cell_j].pre_statistic
            )
            v[self.len_gamma - 1, self.len_gamma - 1] = (
                statistic_pre_i.variance / statistic_pre_i.n
                + statistic_pre_j.variance / statistic_pre_j.n
            )
        return v

    def contrast_matrix_second_moment(self, i: int, j: int) -> np.ndarray:
        m_i = self.contrast_matrix_estimated_mean(i)
        m_j = self.contrast_matrix_estimated_mean(j)
        return self.contrast_matrix_covariance(i, j) + m_i.dot(m_j.T)

    @property
    def mean(self) -> np.ndarray:
        return self.contrast_matrix.dot(self.gammahat).ravel()

    def compute_result(self) -> List[CellResult]:
        results = []
        for cell in range(self.num_cells):
            start = cell * 2
            this_mean = self.mean[start : start + 2]
            v_alpha = np.zeros((self.len_alpha, self.len_alpha))
            for i in range(self.len_alpha):
                for j in range(i + 1):
                    sum_1 = np.trace(
                        self.coef_covariance.dot(
                            self.contrast_matrix_second_moment(start + i, start + j)
                        )
                    )
                    sum_2 = np.trace(
                        self.gammahat.dot(self.gammahat.T).dot(
                            self.contrast_matrix_covariance(start + i, start + j)
                        )
                    )
                    v_alpha[i, j] = sum_1 + sum_2
                    v_alpha[j, i] = v_alpha[i, j]
            this_covariance = float(self.n[cell]) * v_alpha
            results.append(CellResult(self.n[cell], this_mean, this_covariance))
        return results


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
        resids_part_2 = -self.xty.T.dot(self.xtx_inv).dot(self.xty)
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

    def compute_result(self) -> CellResult:
        return CellResult(self.n, self.mean, self.covariance)


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

    def compute_result(self) -> CellResult:
        return CellResult(self.n, self.mean, self.covariance)


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

    def compute_result(self) -> CellResult:
        return CellResult(self.n, self.mean, self.covariance)


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

    def compute_result(self) -> CellResult:
        return CellResult(self.n, self.mean, self.covariance)
