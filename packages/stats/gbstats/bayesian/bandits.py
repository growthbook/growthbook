from abc import abstractmethod, ABC
from dataclasses import field
from typing import List, Dict, Optional, Union, Any

import numpy as np
import random
from pydantic.dataclasses import dataclass
from scipy.stats import chi2  # type: ignore

from gbstats.models.statistics import (
    SampleMeanStatistic,
    ProportionStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
)
from gbstats.utils import (
    variance_of_ratios,
    gaussian_credible_interval,
)
from gbstats.models.statistics import (
    BanditPeriodData,
    BanditPeriodDataRatio,
    BanditPeriodDataCuped,
)
from gbstats.bayesian.tests import BayesianConfig, GaussianPrior


@dataclass
class BanditConfig(BayesianConfig):
    bandit_weights_seed: int = 0
    top_two: bool = True
    prior_distribution: GaussianPrior = field(default_factory=GaussianPrior)
    min_variation_weight: float = 0.01
    weight_by_period: bool = True


@dataclass
class BanditResponse:
    users: Optional[List[float]]
    users_by_period: Optional[List[List[int]]]
    user_percentages_by_period: Optional[List[List[float]]]
    cr: Optional[List[float]]
    ci: Optional[List[List[float]]]
    bandit_weights: Optional[List[float]]
    best_arm_probabilities: Optional[List[float]]
    additional_reward: Optional[float]
    seed: int
    bandit_update_message: Optional[str]


class Bandits(ABC):
    def __init__(
        self,
        stats: Dict[int, BanditPeriodData],
        config: BanditConfig,
    ):
        self.add_attributes(stats, config)

    def add_attributes(self, stats, config):
        self.stats = {period: stats[period].stats for period in range(len(stats))}
        self.config = config
        self.inverse = self.config.inverse
        self.historical_weights = []
        for period in range(self.num_periods):
            self.historical_weights.append(stats[period].weights)

    @staticmethod
    def construct_mean(sums: np.ndarray, counts: np.ndarray) -> np.ndarray:
        positive_counts = counts > 0
        means = np.zeros(sums.shape)
        means[positive_counts] = sums[positive_counts] / counts[positive_counts]
        return means

    @property
    def bandit_weights_seed(self) -> int:
        return self.config.bandit_weights_seed

    @property
    def num_periods(self) -> int:
        return len(self.stats)

    @property
    def num_variations(self) -> int:
        return len(self.stats[0])

    @property
    def array_shape(self) -> tuple:
        return (self.num_periods, self.num_variations)

    @property
    def historical_weights_array(self) -> np.ndarray:
        return np.array(self.historical_weights).reshape(self.array_shape)

    @property
    def counts_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "n")

    # sample sizes by variation
    @property
    def variation_counts(self) -> np.ndarray:
        return np.sum(self.counts_array, axis=0)

    # sample sizes by period
    @property
    def period_counts(self) -> np.ndarray:
        return np.sum(self.counts_array, axis=1)

    @property
    def period_weights(self) -> np.ndarray:
        """given the total traffic (across variations) for each period, what is the percentage that was allocated to each period?
        Args:
            counts_array: num_periods x num_variations array of traffic whose (i, j)th element corresponds to the ith phase for the jth variation.
        Returns:
            weights: num_periods x 1 vector of final weights.
        """
        # sum traffic across variations for a specific phase to get the total traffic for that phase
        total_count = sum(self.period_counts)
        if total_count:
            return self.period_counts / total_count
        else:
            return np.full((self.num_variations,), 1 / self.num_variations)

    @property
    def weights_array(self) -> np.ndarray:
        if self.config.weight_by_period:
            return np.tile(
                np.expand_dims(self.period_weights, axis=1), (1, self.num_variations)
            )
        else:
            if any(self.variation_counts == 0):
                error_string = "Need at least 1 observation per variation per period if not weighting by period."
                raise ValueError(error_string)
            return self.counts_array / self.variation_counts

    # given num_periods x num_variations arrays of means and weights, returns the weighted means
    # across periods (axis_index = 0) or variations (axis_index = 1).
    @staticmethod
    def construct_weighted_means(
        means_array, weights_array, axis_index=0
    ) -> np.ndarray:
        return np.sum(means_array * weights_array, axis=axis_index)

    # find elements of an array that are positive
    @staticmethod
    def find_positive_sample_size(arr: np.ndarray) -> np.ndarray:
        return arr > 0

    @property
    def positive_sample_size(self) -> np.ndarray:
        return self.find_positive_sample_size(self.counts_array)

    @staticmethod
    def construct_weighted_variances(
        variances_array: np.ndarray, weights_array: np.ndarray, counts_array: np.ndarray
    ) -> np.ndarray:
        # array of variances of the sample mean
        sample_mean_variances_by_period = np.zeros(variances_array.shape)
        # find elements where n > 0
        positive_sample_size = Bandits.find_positive_sample_size(counts_array)
        # update the array only where the sample size is positive
        sample_mean_variances_by_period[positive_sample_size] = (
            variances_array[positive_sample_size] / counts_array[positive_sample_size]
        )
        # construct the variance of the weighted mean
        sample_mean_variances = np.sum(
            sample_mean_variances_by_period * (weights_array) ** 2, axis=0
        )
        # scale by number of counts to get back to distributional variance
        variation_counts = np.sum(counts_array, axis=0)
        return sample_mean_variances * variation_counts

    @property
    def prior_precision(self) -> np.ndarray:
        return np.full(
            (self.num_variations,),
            int(self.config.prior_distribution.proper)
            / self.config.prior_distribution.variance,
        )

    @property
    def data_precision(self) -> np.ndarray:
        return np.array(
            [
                float(n) / v if v > 0 else 0
                for n, v in zip(self.variation_counts, self.variation_variances)
            ]
        )

    @property
    def posterior_precision(self) -> np.ndarray:
        return self.prior_precision + self.data_precision

    @property
    def posterior_variance(self) -> np.ndarray:
        return 1 / self.posterior_precision

    @property
    def prior_mean(self) -> np.ndarray:
        return np.full((self.num_variations,), self.config.prior_distribution.mean)

    @property
    def posterior_mean(self) -> np.ndarray:
        return self.posterior_variance * (
            self.prior_precision * self.prior_mean
            + self.data_precision * self.variation_means
        )

    # number of Monte Carlo samples to perform when sampling to estimate weights for the SDK
    @property
    def n_samples(self):
        return int(1e4)

    @property
    def counts_expected(self) -> np.ndarray:
        counts_expected = np.empty((self.num_periods, self.num_variations))
        for period in range(self.num_periods):
            counts_expected[period] = (
                self.period_counts[period] * self.historical_weights_array[period, :]
            )
        return counts_expected

    def compute_srm(self) -> float:
        resid = self.counts_array - self.counts_expected
        resid_squared = resid**2
        positive_expected = self.counts_expected > 0
        test_stat = np.sum(
            resid_squared[positive_expected] / self.counts_expected[positive_expected]
        )
        df = self.num_periods * (self.num_variations - 1)
        return float(1 - chi2.cdf(test_stat, df=df))

    # function that computes thompson sampling variation weights
    def compute_result(self) -> BanditResponse:
        seed = (
            self.bandit_weights_seed
            if self.bandit_weights_seed
            else random.randint(0, 1000000)
        )
        rng = np.random.default_rng(seed=seed)
        y = rng.multivariate_normal(
            mean=self.posterior_mean,
            cov=np.diag(self.posterior_variance),
            size=self.n_samples,
        )
        if self.inverse:
            best_rows = np.min(y, axis=1)
        else:
            best_rows = np.max(y, axis=1)
        best_arm_probabilities = np.mean((y == best_rows[:, np.newaxis]), axis=0)
        if self.config.top_two:
            p = self.top_two_weights(y, self.inverse)
        else:
            p = best_arm_probabilities
        update_message = "successfully updated"
        p[p < self.config.min_variation_weight] = self.config.min_variation_weight
        p /= sum(p)
        credible_intervals = [
            gaussian_credible_interval(mn, s, self.config.alpha)
            for mn, s in zip(self.posterior_mean, np.sqrt(self.posterior_variance))
        ]
        min_n = 100 * self.num_variations
        enough_data = sum(self.variation_counts) >= min_n
        return BanditResponse(
            users=self.variation_counts.tolist(),
            users_by_period=self.user_counts_by_period,
            user_percentages_by_period=self.user_percentages_by_period,
            cr=self.variation_means.tolist(),
            ci=credible_intervals,
            bandit_weights=p.tolist() if enough_data else None,
            best_arm_probabilities=best_arm_probabilities.tolist(),
            additional_reward=self.compute_additional_reward(),
            seed=seed,
            bandit_update_message=update_message
            if enough_data
            else "total sample size is less than 100 times number of variations",
        )

    # each element of the list is a list of length num_variations of user counts specific to a period
    @property
    def user_counts_by_period(self) -> List[List[int]]:
        counts_by_period = []
        for period in range(self.num_periods):
            counts_by_period.append(self.counts_array[period, :].tolist())
        return counts_by_period

    @property
    def user_percentages_by_period(self) -> List[List[float]]:
        percentages_by_period = []
        for period in range(self.num_periods):
            if self.period_counts[period]:
                these_percentages = (
                    self.counts_array[period, :] / self.period_counts[period]
                )
            else:
                these_percentages = np.zeros((self.num_variations,))
            percentages_by_period.append(these_percentages.tolist())
        return percentages_by_period

    # function that takes weights for largest realization and turns into top two weights
    @staticmethod
    def top_two_weights(y: np.ndarray, inverse=False) -> np.ndarray:
        """Calculates the proportion of times each column contains the largest or second largest element in a row.
        Args:
        arr: A 2D NumPy array.
        Returns:
        A NumPy array of proportions, one for each column.
        """
        # Get indices of sorted elements in each row
        sorted_indices = np.argsort(y, axis=1)
        if inverse:
            # counts for number of times each variation was the smallest
            unique_0, counts_0 = np.unique(
                sorted_indices[:, 1][:, np.newaxis], return_counts=True
            )
            # counts for number of times each variation was the second smallest
            unique_1, counts_1 = np.unique(
                sorted_indices[:, 2][:, np.newaxis], return_counts=True
            )
        else:
            # counts for number of times each variation was the largest
            unique_0, counts_0 = np.unique(
                sorted_indices[:, -1][:, np.newaxis], return_counts=True
            )
            # counts for number of times each variation was the second largest
            unique_1, counts_1 = np.unique(
                sorted_indices[:, -2][:, np.newaxis], return_counts=True
            )
        # put inside dicts and loop over count to ensure arms that are never the biggest are included
        dict_0 = dict(zip(unique_0, counts_0))
        dict_1 = dict(zip(unique_1, counts_1))
        n_variations = y.shape[1]
        final_counts = np.zeros((n_variations,))
        for i in range(n_variations):
            final_counts[i] = dict_0.get(i, 0) + dict_1.get(i, 0)
        return final_counts / sum(final_counts)

    @staticmethod
    def sum_from_moments(n, mn):
        return n * mn

    @staticmethod
    def sum_squares_from_moments(n, mn, v):
        return (n - 1) * v + n * mn**2

    @staticmethod
    def cross_product_from_moments(n, mn_x, mn_y, cov_x_y):
        return (n - 1) * cov_x_y + n * mn_x * mn_y

    # given n_periods x n_variations arrays of counts and means, what is the additional reward compared to fixed weight balanced design?
    @abstractmethod
    def compute_additional_reward(self) -> float:
        pass

    @property
    @abstractmethod
    def variation_means(self) -> np.ndarray:
        raise NotImplementedError

    @property
    @abstractmethod
    def variation_variances(self) -> np.ndarray:
        raise NotImplementedError

    @abstractmethod
    def attribute_array(
        self,
        stats: Dict,
        array_shape: tuple,
        attribute_1: str,
        attribute_2: str = "",
    ) -> np.ndarray:
        raise NotImplementedError


def compute_additional_reward(
    period_counts, num_variations, counts_array, means_unadjusted_array
) -> float:
    variation_counts_balanced = np.tile(
        np.expand_dims(period_counts, axis=1) / num_variations,
        (1, num_variations),
    )
    counts_diff = counts_array - variation_counts_balanced
    return float(np.sum(counts_diff * means_unadjusted_array))


class BanditsSimple(Bandits):
    def __init__(
        self,
        stats: Dict[int, BanditPeriodData],
        config: BanditConfig,
    ):
        self.add_attributes(stats, config)

    def attribute_array(
        self,
        stats: Dict[int, List[Union[ProportionStatistic, SampleMeanStatistic]]],
        array_shape: tuple,
        attribute_1: str,
        attribute_2: str = "",
    ) -> np.ndarray:
        """
        Extracts a specified attribute from nested data structures and reshapes it.
        Args:
            stats: A dictionary of lists containing objects with the specified attribute.
            array_shape: The desired shape of the output array.
            attribute_1: The name of the first attribute to extract.
            attribute_2: The name of the sub-attribute to extract (if needed).

        Returns:
            A NumPy array containing the extracted attributes, reshaped to the specified shape.
        """
        values = [
            getattr(getattr(item, attribute_1), attribute_2)
            if attribute_2
            else getattr(item, attribute_1)
            for sublist in stats.values()
            for item in sublist
        ]
        return np.array(values).reshape(array_shape)

    def add_attributes(self, stats, config):
        self.stats = {period: stats[period].stats for period in range(len(stats))}
        self.config = config
        self.inverse = self.config.inverse
        self.historical_weights = []
        for period in range(self.num_periods):
            self.historical_weights.append(stats[period].weights)

    @property
    def means_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "mean")

    @property
    def variances_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "variance")

    @property
    def variation_means(self) -> np.ndarray:
        return self.construct_weighted_means(self.means_array, self.weights_array)

    @property
    def variation_variances(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.variances_array, self.weights_array, self.counts_array
        )

    def make_row(self, dimension, variation_index, variation_value) -> Dict[str, Any]:
        n = self.variation_counts[variation_index]
        mn = self.variation_means[variation_index]
        v = self.variation_variances[variation_index]
        return {
            "dimension": dimension,
            "variation": variation_value,
            "users": n,
            "count": n,
            "main_sum": self.sum_from_moments(n, mn),
            "main_sum_squares": self.sum_squares_from_moments(n, mn, v),
        }

    def compute_additional_reward(self) -> float:
        return compute_additional_reward(
            self.period_counts, self.num_variations, self.counts_array, self.means_array
        )


class BanditsRatio(Bandits):
    def __init__(
        self,
        stats: Dict[int, BanditPeriodDataRatio],
        config: BanditConfig,
    ):
        self.add_attributes(stats, config)

    def attribute_array(
        self,
        stats: Dict[int, List[RatioStatistic]],
        array_shape: tuple,
        attribute_1: str,
        attribute_2: str = "",
    ) -> np.ndarray:
        """
        Extracts a specified attribute from nested data structures and reshapes it.
        Args:
            stats: A dictionary of lists containing objects with the specified attribute.
            array_shape: The desired shape of the output array.
            attribute_1: The name of the first attribute to extract.
            attribute_2: The name of the sub-attribute to extract (if needed).

        Returns:
            A NumPy array containing the extracted attributes, reshaped to the specified shape.
        """
        values = [
            getattr(getattr(item, attribute_1), attribute_2)
            if attribute_2
            else getattr(item, attribute_1)
            for sublist in stats.values()
            for item in sublist
        ]
        return np.array(values).reshape(array_shape)

    @property
    def numerator_means_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "m_statistic", "mean")

    @property
    def denominator_means_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "d_statistic", "mean")

    @property
    def numerator_means(self) -> np.ndarray:
        return self.construct_weighted_means(
            self.numerator_means_array, self.weights_array
        )

    @property
    def denominator_means(self) -> np.ndarray:
        return self.construct_weighted_means(
            self.denominator_means_array, self.weights_array
        )

    @property
    def variation_means(self) -> np.ndarray:
        return self.construct_mean(self.numerator_means, self.denominator_means)

    @property
    def numerator_variances_array(self) -> np.ndarray:
        return self.attribute_array(
            self.stats, self.array_shape, "m_statistic", "variance"
        )

    @property
    def denominator_variances_array(self) -> np.ndarray:
        return self.attribute_array(
            self.stats, self.array_shape, "d_statistic", "variance"
        )

    @property
    def ratio_covariances_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "covariance")

    @property
    def numerator_variances(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.numerator_variances_array, self.weights_array, self.counts_array
        )

    @property
    def denominator_variances(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.denominator_variances_array, self.weights_array, self.counts_array
        )

    @property
    def covariances(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.ratio_covariances_array, self.weights_array, self.counts_array
        )

    @property
    def variation_variances(self) -> np.ndarray:
        return np.array(
            [
                variance_of_ratios(
                    self.numerator_means[variation],
                    self.numerator_variances[variation],
                    self.denominator_means[variation],
                    self.denominator_variances[variation],
                    self.covariances[variation],
                )
                if self.variation_counts[variation] > 0
                else 0
                for variation in range(self.num_variations)
            ]
        )

    def compute_additional_reward(self) -> float:
        return 0

    def make_row(self, dimension, variation_index, variation_value) -> Dict[str, Any]:
        n = self.variation_counts[variation_index]
        mn_num = self.numerator_means[variation_index]
        v_num = self.numerator_variances[variation_index]
        mn_den = self.denominator_means[variation_index]
        v_den = self.denominator_variances[variation_index]
        main_denominator_sum_product = n * (
            self.covariances[variation_index] + mn_num * mn_den
        )
        return {
            "dimension": dimension,
            "variation": variation_value,
            "users": n,
            "count": n,
            "main_sum": self.sum_from_moments(n, mn_num),
            "main_sum_squares": self.sum_squares_from_moments(n, mn_num, v_num),
            "denominator_sum": self.sum_from_moments(n, mn_den),
            "denominator_sum_squares": self.sum_squares_from_moments(n, mn_den, v_den),
            "main_denominator_sum_product": main_denominator_sum_product,
        }


class BanditsCuped(Bandits):
    def __init__(
        self,
        stats: Dict[int, BanditPeriodDataCuped],
        config: BanditConfig,
    ):
        self.add_attributes(stats, config)

    def compute_additional_reward(self) -> float:
        return compute_additional_reward(
            self.period_counts,
            self.num_variations,
            self.counts_array,
            self.post_mean_array,
        )

    def attribute_array(
        self,
        stats: Dict[int, List[RegressionAdjustedStatistic]],
        array_shape: tuple,
        attribute_1: str,
        attribute_2: str = "",
    ) -> np.ndarray:
        """
        Extracts a specified attribute from nested data structures and reshapes it.
        Args:
            stats: A dictionary of lists containing objects with the specified attribute.
            array_shape: The desired shape of the output array.
            attribute_1: The name of the first attribute to extract.
            attribute_2: The name of the sub-attribute to extract (if needed).

        Returns:
            A NumPy array containing the extracted attributes, reshaped to the specified shape.
        """
        values = [
            getattr(getattr(item, attribute_1), attribute_2)
            if attribute_2
            else getattr(item, attribute_1)
            for sublist in stats.values()
            for item in sublist
        ]
        return np.array(values).reshape(array_shape)

    @property
    def post_sum_array(self) -> np.ndarray:
        return self.attribute_array(
            self.stats, self.array_shape, "post_statistic", "sum"
        )

    @property
    def post_mean_array(self) -> np.ndarray:
        return self.construct_mean(self.post_sum_array, self.counts_array)

    @property
    def post_variance_array(self) -> np.ndarray:
        return self.attribute_array(
            self.stats, self.array_shape, "post_statistic", "variance"
        )

    @property
    def pre_sum_array(self) -> np.ndarray:
        return self.attribute_array(
            self.stats, self.array_shape, "pre_statistic", "sum"
        )

    @property
    def pre_mean_array(self) -> np.ndarray:
        return self.construct_mean(self.pre_sum_array, self.counts_array)

    @property
    def pre_variance_array(self) -> np.ndarray:
        return self.attribute_array(
            self.stats, self.array_shape, "pre_statistic", "variance"
        )

    @property
    def post_pre_sum_of_products_array(self) -> np.ndarray:
        return self.attribute_array(
            self.stats, self.array_shape, "post_pre_sum_of_products"
        )

    @property
    def post_pre_mean_of_products_array(self) -> np.ndarray:
        means_cross_product = np.zeros(self.array_shape)
        means_cross_product[self.positive_sample_size] = (
            self.post_pre_sum_of_products_array[self.positive_sample_size]
            / self.counts_array[self.positive_sample_size]
        )
        return means_cross_product

    @property
    def post_pre_cov_array(self) -> np.ndarray:
        return (
            self.post_pre_mean_of_products_array
            - self.post_mean_array * self.pre_mean_array
        )

    @property
    def pre_sum_squares_array(self) -> np.ndarray:
        pre_sum_squares = np.zeros(self.array_shape)
        pre_sum_squares[self.positive_sample_size] = (
            self.post_pre_sum_of_products_array[self.positive_sample_size]
            / self.counts_array[self.positive_sample_size]
        )
        return pre_sum_squares

    @property
    def period_means_pre(self) -> np.ndarray:
        return self.construct_weighted_means(
            self.pre_mean_array, self.historical_weights_array, axis_index=1
        )

    @property
    def period_means_post(self) -> np.ndarray:
        return self.construct_weighted_means(
            self.post_mean_array, self.historical_weights_array, axis_index=1
        )

    @property
    def period_means_post_pre(self) -> np.ndarray:
        return self.construct_weighted_means(
            self.post_pre_mean_of_products_array,
            self.historical_weights_array,
            axis_index=1,
        )

    @property
    def period_means_pre_sum_squares(self) -> np.ndarray:
        return self.construct_weighted_means(
            self.pre_sum_squares_array, self.historical_weights_array, axis_index=1
        )

    @property
    def period_means_cross_product(self) -> np.ndarray:
        return self.construct_weighted_means(
            self.post_pre_mean_of_products_array,
            self.historical_weights_array,
            axis_index=1,
        )

    @property
    def period_variances_pre(self) -> np.ndarray:
        return self.period_means_pre_sum_squares - self.period_means_pre**2

    @property
    def period_covariances(self) -> np.ndarray:
        return (
            self.period_means_cross_product
            - self.period_means_post * self.period_means_pre
        )

    @property
    def weighted_covariance(self) -> np.float64:
        return (self.period_weights**2).T.dot(self.period_covariances)

    @property
    def weighted_variance_pre(self) -> np.float64:
        return (self.period_weights**2).T.dot(self.period_variances_pre)

    @property
    def theta(self) -> np.float64:
        return (
            self.weighted_covariance / self.weighted_variance_pre
            if self.weighted_variance_pre
            else np.float64(0)
        )

    @property
    def variation_means_post(self) -> np.ndarray:
        return self.construct_weighted_means(self.post_mean_array, self.weights_array)

    @property
    def variation_variances_post(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.post_variance_array, self.weights_array, self.counts_array
        )

    @property
    def variation_means_pre(self) -> np.ndarray:
        return self.construct_weighted_means(self.pre_mean_array, self.weights_array)

    @property
    def variation_variances_pre(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.pre_variance_array, self.weights_array, self.counts_array
        )

    @property
    def variation_post_pre_sum_of_products(self) -> np.ndarray:
        return (
            self.weighted_covariances
            + self.variation_counts
            * self.variation_means_post
            * self.variation_means_pre
        )

    @property
    def covariances_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "covariance")

    @property
    def weighted_covariances(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.covariances_array, self.weights_array, self.counts_array
        )

    def make_row(self, dimension, variation_index, variation_value) -> Dict[str, Any]:
        n = self.variation_counts[variation_index]
        mn_post = self.variation_means_post[variation_index]
        v_post = self.variation_variances_post[variation_index]
        mn_pre = self.variation_means_pre[variation_index]
        v_pre = self.variation_variances_pre[variation_index]
        # note that weighted covariances is already multplied by n
        main_covariate_sum_product = (
            self.weighted_covariances[variation_index] + n * mn_post * mn_pre
        )
        theta = self.theta
        return {
            "dimension": dimension,
            "variation": variation_value,
            "users": n,
            "count": n,
            "main_sum": self.sum_from_moments(n, mn_post),
            "main_sum_squares": self.sum_squares_from_moments(n, mn_post, v_post),
            "covariate_sum": self.sum_from_moments(n, mn_pre),
            "covariate_sum_squares": self.sum_squares_from_moments(n, mn_pre, v_pre),
            "main_covariate_sum_product": main_covariate_sum_product,
            "theta": theta,
        }

    @property
    def variation_means(self) -> np.ndarray:
        return self.construct_weighted_means(
            self.post_mean_array - self.theta * self.pre_mean_array, self.weights_array
        )

    @property
    def variation_variances(self) -> np.ndarray:
        var_array = (
            self.post_variance_array
            + self.theta**2 * self.pre_variance_array
            - 2 * self.theta * self.post_pre_cov_array
        )
        return self.construct_weighted_variances(
            var_array, self.weights_array, self.counts_array
        )
