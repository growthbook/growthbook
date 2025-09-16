from abc import ABC, abstractmethod
from typing import Dict, Mapping, Tuple, Type, Union, Optional

import numpy as np
import numpy.typing as npt
from scipy.stats import norm

from gbstats.models.statistics import (
    TestStatistic,
    SampleMeanStatistic,
    ProportionStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
    RegressionAdjustedRatioStatistic,
    QuantileStatistic,
)
from gbstats.models.tests import (
    BaseABTest,
    BaseConfig,
)

##############################################
# this file is used for internal testing only.
# no methods from this file should be exported.
###############################################


class SimulationStudy(ABC):
    def __init__(
        self,
        test_dict: Mapping[str, Tuple[Type[BaseABTest], BaseConfig]],
        data_params: Dict,
        seed: int,
        n_sim: int = 100,
        alpha: float = 0.05,
    ):
        self.n_sim = n_sim
        self.alpha = alpha
        self.seed = seed
        self.test_names = list(test_dict.keys())
        self.tests = list([v[0] for v in test_dict.values()])
        self.configs = list([v[1] for v in test_dict.values()])
        self.n_tests = len(self.tests)
        self.data_params = data_params
        self.create_storage_arrays()

    def run_sim(self):
        for i in range(self.n_sim):
            self.run_iteration(i)

    def run_iteration(self, i):
        np.random.seed(self.seed + i)
        stat_a, stat_b, estimand = self.generate_data()
        for j, test in enumerate(self.tests):
            t = test([(stat_a, stat_b)], self.configs[j])
            test_result = t.compute_result()
            self.pt[i, j] = test_result.expected
            self.se[i, j] = test_result.uplift.stddev
            self.lower_limit[i, j] = test_result.ci[0]
            self.upper_limit[i, j] = test_result.ci[1]
            self.theta[i, j] = estimand
            self.results[i, j] = test_result

    def create_storage_arrays(self):
        array_shape = (self.n_sim, self.n_tests)
        self.pt = np.empty(array_shape)
        self.se = np.empty(array_shape)
        self.theta = np.empty(array_shape)
        self.lower_limit = np.empty(array_shape)
        self.upper_limit = np.empty(array_shape)
        self.results = np.empty(array_shape, dtype=object)

    @abstractmethod
    def generate_data(self) -> Tuple[TestStatistic, TestStatistic, float]:
        pass

    @property
    def coverage(self):
        """computes coverage."""
        return [
            np.mean(
                (self.lower_limit[:, j] <= self.theta[:, j])
                * (self.upper_limit[:, j] >= self.theta[:, j])
            )
            for j in range(self.n_tests)
        ]

    @property
    def reject(self):
        return [
            1.0
            - np.mean((self.lower_limit[:, j] < 0.0) * (self.upper_limit[:, j] > 0.0))
            for j in range(self.n_tests)
        ]

    @property
    def mse(self):
        return [
            np.mean((self.pt[:, j] - self.theta[:, j]) ** 2)
            for j in range(self.n_tests)
        ]

    @property
    def bias(self):
        return [np.mean(self.pt[:, j] - self.theta[:, j]) for j in range(self.n_tests)]

    @property
    def variance(self):
        return [np.var(self.pt[:, j]) for j in range(self.n_tests)]


def bernoulli_standard_error(nu, n):
    return np.sqrt(nu * (1 - nu)) / np.sqrt(n)


def create_limits(nu, n_seq, alpha):
    multiplier = norm.ppf(1.0 - 0.5 * alpha, loc=0, scale=1)
    standard_errors = [bernoulli_standard_error(nu, n_star) for n_star in n_seq]
    lower = [nu - multiplier * s for s in standard_errors]
    upper = [nu + multiplier * s for s in standard_errors]
    return lower, upper


class CreateStatistic:
    def __init__(
        self,
        statistic_type: str,
        y: npt.NDArray[np.float64],
        x: Optional[npt.NDArray[np.float64]],
        nu: Optional[float],
    ):
        self.statistic_type = statistic_type
        self.y = y
        self.n = len(self.y)
        self.x = x
        self.nu = nu
        assert self.statistic_type in [
            "sample_mean",
            "proportion",
            "ratio",
            "regression_adjusted",
            "regression_adjusted_ratio",
            "quantile",
            "quantile_clustered",
        ], "statistic_type must be one of sample_mean, proportion, ratio, regression_adjusted, regression_adjusted_ratio, quantile, quantile_clustered"
        assert (
            self.x is None or self.x.shape == self.y.shape
        ), "if x is specified, it must have the same shape as y"

    def create_statistic(self) -> TestStatistic:
        if self.statistic_type == "sample_mean":
            return SampleMeanStatistic(
                n=self.n,
                sum=float(np.sum(self.y)),
                sum_squares=float(np.sum(self.y**2)),
            )
        elif self.statistic_type == "proportion":
            return ProportionStatistic(n=self.n, sum=float(np.sum(self.y)))
        elif self.statistic_type == "ratio":
            if self.x is None:
                raise ValueError("x must be provided for ratio statistic")
            m_statistic = SampleMeanStatistic(
                n=self.n,
                sum=float(np.sum(self.y)),
                sum_squares=float(np.sum(self.y**2)),
            )
            d_statistic = SampleMeanStatistic(
                n=self.n,
                sum=float(np.sum(self.x)),
                sum_squares=float(np.sum(self.x**2)),
            )
            m_d_sum_of_products = float(np.sum(self.y * self.x))
            return RatioStatistic(
                n=len(self.y),
                m_statistic=m_statistic,
                d_statistic=d_statistic,
                m_d_sum_of_products=m_d_sum_of_products,
            )
        elif self.statistic_type == "regression_adjusted":
            if self.x is None:
                raise ValueError("x must be provided for regression statistic")
            post_statistic = SampleMeanStatistic(
                n=self.n,
                sum=float(np.sum(self.y)),
                sum_squares=float(np.sum(self.y**2)),
            )
            pre_statistic = SampleMeanStatistic(
                n=self.n,
                sum=float(np.sum(self.x)),
                sum_squares=float(np.sum(self.x**2)),
            )
            post_pre_sum_of_products = float(np.sum(self.y * self.x))
            stat = RegressionAdjustedStatistic(
                n=post_statistic.n,
                post_statistic=post_statistic,
                pre_statistic=pre_statistic,
                post_pre_sum_of_products=post_pre_sum_of_products,
                theta=None,
            )
            return stat
        elif self.statistic_type == "regression_adjusted_ratio":
            if self.x is None:
                raise ValueError(
                    "x must be provided for regression adjusted ratio statistic"
                )
            m_statistic_post = SampleMeanStatistic(
                n=self.n,
                sum=float(np.sum(self.y[:, 0])),
                sum_squares=float(np.sum(self.y[:, 0] ** 2)),
            )
            d_statistic_post = SampleMeanStatistic(
                n=self.n,
                sum=float(np.sum(self.y[:, 1])),
                sum_squares=float(np.sum(self.y[:, 1] ** 2)),
            )
            m_statistic_pre = SampleMeanStatistic(
                n=self.n,
                sum=float(np.sum(self.x[:, 0])),
                sum_squares=float(np.sum(self.x[:, 0] ** 2)),
            )
            d_statistic_pre = SampleMeanStatistic(
                n=self.n,
                sum=float(np.sum(self.x[:, 1])),
                sum_squares=float(np.sum(self.x[:, 1] ** 2)),
            )
            m_post_m_pre_sum_of_products = float(np.sum(self.y[:, 0] * self.x[:, 0]))
            d_post_d_pre_sum_of_products = float(np.sum(self.y[:, 1] * self.x[:, 1]))
            m_pre_d_pre_sum_of_products = float(np.sum(self.x[:, 0] * self.x[:, 1]))
            m_post_d_post_sum_of_products = float(np.sum(self.y[:, 0] * self.y[:, 1]))
            m_post_d_pre_sum_of_products = float(np.sum(self.y[:, 0] * self.x[:, 1]))
            m_pre_d_post_sum_of_products = float(np.sum(self.x[:, 0] * self.y[:, 1]))
            return RegressionAdjustedRatioStatistic(
                n=self.n,
                m_statistic_post=m_statistic_post,
                d_statistic_post=d_statistic_post,
                m_statistic_pre=m_statistic_pre,
                d_statistic_pre=d_statistic_pre,
                m_post_m_pre_sum_of_products=m_post_m_pre_sum_of_products,
                d_post_d_pre_sum_of_products=d_post_d_pre_sum_of_products,
                m_pre_d_pre_sum_of_products=m_pre_d_pre_sum_of_products,
                m_post_d_post_sum_of_products=m_post_d_post_sum_of_products,
                m_post_d_pre_sum_of_products=m_post_d_pre_sum_of_products,
                m_pre_d_post_sum_of_products=m_pre_d_post_sum_of_products,
                theta=None,
            )
        else:
            if not self.nu:
                raise ValueError("nu must be provided for quantile statistic")
            n_seq = np.array([100 * 2**i for i in range(20)])
            filtered_arr = n_seq[n_seq <= self.n]
            n_star = filtered_arr.max() if len(filtered_arr) > 0 else None
            if not n_star:
                raise ValueError("sample size for QuantileStatistic is out of range")
            quantile_hat = float(np.quantile(self.y, self.nu))
            alpha = 0.05
            multiplier = norm.ppf(1.0 - 0.5 * alpha, loc=0, scale=1)
            standard_error = bernoulli_standard_error(self.nu, n_star)
            quantile_lower = self.nu - multiplier * standard_error
            quantile_upper = self.nu + multiplier * standard_error
            if self.statistic_type == "quantile":
                return QuantileStatistic(
                    n=self.n,
                    n_star=n_star,
                    nu=self.nu,
                    quantile_hat=quantile_hat,
                    quantile_lower=quantile_lower,
                    quantile_upper=quantile_upper,
                )
            else:
                raise ValueError(
                    "need cluster information for QuantileClusterStatistic"
                )


class CreateRow:
    def __init__(
        self,
        stat: TestStatistic,
        variation: str,
        dimension_name: str,
        dimension_value: str,
        dimension_two_name: Optional[str] = None,
        dimension_two_value: Optional[str] = None,
    ):
        self.stat = stat
        self.dimension_name = dimension_name
        self.dimension_value = dimension_value
        self.dimension_two_name = dimension_two_name
        self.dimension_two_value = dimension_two_value
        self.variation = variation

    def create_row(self) -> Dict[str, Union[str, int, float]]:
        n = self.stat.n
        d = {
            self.dimension_name: self.dimension_value,
            "variation": self.variation,
            "users": n,
            "count": n,
        }
        if self.dimension_two_name:
            d[self.dimension_two_name] = self.dimension_two_value

        if isinstance(self.stat, SampleMeanStatistic):
            return d | {
                "main_sum": self.stat.sum,
                "main_sum_squares": self.stat.sum_squares,
            }

        elif isinstance(self.stat, ProportionStatistic):
            return d | {
                "main_sum": self.stat.sum,
            }

        elif isinstance(self.stat, RatioStatistic):
            return d | {
                "main_sum": self.stat.m_statistic.sum,
                "main_sum_squares": self.stat.m_statistic.sum_squares,
                "denominator_sum": self.stat.d_statistic.sum,
                "denominator_sum_squares": self.stat.d_statistic.sum_squares,
                "main_denominator_sum_product": self.stat.m_d_sum_of_products,
            }

        elif isinstance(self.stat, RegressionAdjustedStatistic):
            return d | {
                "main_sum": self.stat.post_statistic.sum,
                "main_sum_squares": self.stat.post_statistic.sum_squares,
                "covariate_sum": self.stat.pre_statistic.sum,
                "covariate_sum_squares": self.stat.pre_statistic.sum_squares,
                "main_covariate_sum_product": self.stat.post_pre_sum_of_products,
                "theta": self.stat.theta if self.stat.theta else 0,
            }

        elif isinstance(self.stat, RegressionAdjustedRatioStatistic):
            return d | {
                "main_sum": self.stat.m_statistic_post.sum,
                "main_sum_squares": self.stat.m_statistic_post.sum_squares,
                "denominator_sum": self.stat.d_statistic_post.sum,
                "denominator_sum_squares": self.stat.d_statistic_post.sum_squares,
                "main_denominator_sum_product": self.stat.m_post_d_post_sum_of_products,
                "covariate_sum": self.stat.m_statistic_pre.sum,
                "covariate_sum_squares": self.stat.m_statistic_pre.sum_squares,
                "denominator_pre_sum": self.stat.d_statistic_pre.sum,
                "denominator_pre_sum_squares": self.stat.d_statistic_pre.sum_squares,
                "main_covariate_sum_product": self.stat.m_post_m_pre_sum_of_products,
                "main_post_denominator_pre_sum_product": self.stat.m_post_d_pre_sum_of_products,
                "main_pre_denominator_post_sum_product": self.stat.m_pre_d_post_sum_of_products,
                "main_pre_denominator_pre_sum_product": self.stat.m_pre_d_pre_sum_of_products,
                "denominator_post_denominator_pre_sum_product": self.stat.d_post_d_pre_sum_of_products,
                "theta": self.stat.theta if self.stat.theta else 0,
            }
        elif isinstance(self.stat, QuantileStatistic):
            d_quantile = {
                "n": n,
                "n_star": self.stat.n_star,
                "nu": self.stat.nu,
                "quantile_hat": self.stat.quantile_hat,
                "quantile_lower": self.stat.quantile_lower,
                "quantile_upper": self.stat.quantile_upper,
            }
            if isinstance(self.stat, QuantileStatistic):
                return d | d_quantile
            else:
                return (
                    d
                    | d_quantile
                    | {
                        "main_sum": self.stat.main_sum,
                        "main_sum_squares": self.stat.main_sum_squares,
                        "denominator_sum": self.stat.denominator_sum,
                        "denominator_sum_squares": self.stat.denominator_sum_squares,
                        "main_denominator_sum_product": self.stat.main_denominator_sum_product,
                        "n_clusters": self.stat.n_clusters,
                    }
                )
        else:
            raise ValueError("statistic type not recognized")
