from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Union
from gbstats.frequentist.tests import FrequentistConfig
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
class PostStratificationResult:
    mean: np.ndarray
    covariance: np.ndarray


class BasePostStratification(ABC):
    @property
    @abstractmethod
    def strata_means(self) -> np.ndarray:
        pass

    @property
    @abstractmethod
    def strata_covariance(self) -> np.ndarray:
        pass

    @property
    @abstractmethod
    def transformation_matrix(self) -> np.ndarray:
        pass

    @property
    def mean(self) -> np.ndarray:
        return self.transformation_matrix @ self.strata_means

    @property
    def covariance(self) -> np.ndarray:
        return (
            self.transformation_matrix
            @ self.strata_covariance
            @ self.transformation_matrix.T
        )

    def compute_result(self) -> PostStratificationResult:
        return PostStratificationResult(self.mean, self.covariance)


class PostStratification(BasePostStratification):
    def __init__(
        self,
        stat_a: Union[ProportionStatistic, SampleMeanStatistic],
        stat_b: Union[ProportionStatistic, SampleMeanStatistic],
        config: FrequentistConfig = FrequentistConfig(),
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.config = config

    @property
    def strata_means(self) -> np.ndarray:
        return np.array([self.stat_b.mean, self.stat_a.mean])

    @property
    def strata_covariance(self) -> np.ndarray:
        return np.array(
            [
                [self.stat_a.variance / self.stat_a.n, 0],
                [0, self.stat_b.variance / self.stat_b.n],
            ]
        )

    @property
    def transformation_matrix(self) -> np.ndarray:
        return np.array([[1, -1], [0, 1]])


class PostStratificationRegressionAdjusted(BasePostStratification):
    def __init__(
        self,
        stat_a: RegressionAdjustedStatistic,
        stat_b: RegressionAdjustedStatistic,
        config: FrequentistConfig = FrequentistConfig(),
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.config = config

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
    def strata_covariance(self) -> np.ndarray:
        return np.array(
            [
                [self.stat_b.post_statistic.variance, self.stat_b.covariance, 0, 0],
                [self.stat_b.covariance, self.stat_b.pre_statistic.variance, 0, 0],
                [0, 0, self.stat_a.post_statistic.variance, self.stat_a.covariance],
                [0, 0, self.stat_a.covariance, self.stat_b.pre_statistic.variance],
            ]
        )

    @property
    def transformation_matrix(self) -> np.ndarray:
        theta = compute_theta(self.stat_a, self.stat_b)
        return np.array([[0, 0, 1, 0], [1, -theta, -1, theta]])


class PostStratificationRatio(BasePostStratification):
    def __init__(
        self,
        stat_a: RatioStatistic,
        stat_b: RatioStatistic,
        config: FrequentistConfig = FrequentistConfig(),
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.config = config

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
    def strata_covariance(self) -> np.ndarray:
        return np.array(
            [
                [self.stat_b.m_statistic.variance, self.stat_b.covariance, 0, 0],
                [self.stat_b.covariance, self.stat_b.d_statistic.variance, 0, 0],
                [0, 0, self.stat_a.m_statistic.variance, self.stat_a.covariance],
                [0, 0, self.stat_a.covariance, self.stat_b.d_statistic.variance],
            ]
        )

    @property
    def transformation_matrix(self) -> np.ndarray:
        return np.array([[0, 0, 1, 0], [1, 0, -1, 0], [0, 0, 0, 1], [0, 1, 0, -1]])


class PostStratificationRegressionAdjustedRatio(BasePostStratification):
    def __init__(
        self,
        stat_a: RegressionAdjustedRatioStatistic,
        stat_b: RegressionAdjustedRatioStatistic,
        config: FrequentistConfig = FrequentistConfig(),
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.config = config

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
    def strata_covariance(self) -> np.ndarray:
        v = np.zeros((8, 8))
        v[0:4, 0:4] = self.stat_b.lambda_matrix
        v[4:8, 4:8] = self.stat_b.lambda_matrix
        return v

    @property
    def theta_numerator(self) -> float:
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
    def transformation_matrix(self) -> np.ndarray:
        return np.array(
            [
                [0, 0, 0, 0, 0, 0, 1, 0],
                [1, 0, -self.theta_numerator, 0, -1, 0, self.theta_numerator, 0],
                [0, 0, 0, 0, 0, 1, 0, 0],
                [0, 1, 0, -self.theta_denominator, 0, -1, 0, self.theta_denominator],
            ]
        )
