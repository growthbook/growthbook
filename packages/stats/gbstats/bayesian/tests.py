from abc import abstractmethod
from dataclasses import field
from typing import List, Literal, Optional, Dict

import numpy as np
import random
from pydantic.dataclasses import dataclass
from scipy.stats import norm, chi2  # type: ignore

from gbstats.messages import (
    BASELINE_VARIATION_ZERO_MESSAGE,
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    ZERO_SCALED_VARIATION_MESSAGE,
    NO_UNITS_IN_VARIATION_MESSAGE,
)
from gbstats.models.tests import BaseABTest, BaseConfig, TestResult, Uplift
from gbstats.models.statistics import (
    TestStatistic,
    BanditStatistic,
)
from gbstats.frequentist.tests import frequentist_diff, frequentist_variance
from gbstats.utils import (
    truncated_normal_mean,
    variance_of_ratios,
    gaussian_credible_interval,
)
from gbstats.models.statistics import BanditPeriodData


# Configs
@dataclass
class GaussianPrior:
    mean: float = 0
    variance: float = 1
    proper: bool = False


@dataclass
class BayesianConfig(BaseConfig):
    inverse: bool = False
    alpha: float = 0.05
    prior_type: Literal["relative", "absolute"] = "relative"


@dataclass
class EffectBayesianConfig(BayesianConfig):
    prior_effect: GaussianPrior = field(default_factory=GaussianPrior)


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


# Results
RiskType = Literal["absolute", "relative"]


@dataclass
class BayesianTestResult(TestResult):
    chance_to_win: float
    risk: List[float]
    risk_type: RiskType
    error_message: Optional[str] = None


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
        self.traffic_proportion_b = config.traffic_proportion_b
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

    def scale_result(
        self, result: BayesianTestResult, p: float, d: float
    ) -> BayesianTestResult:
        if result.uplift.dist != "normal":
            raise ValueError("Cannot scale relative results.")
        if p == 0:
            return self._default_output(ZERO_SCALED_VARIATION_MESSAGE)
        adjustment = self.stat_b.n / p / d
        return BayesianTestResult(
            chance_to_win=result.chance_to_win,
            expected=result.expected * adjustment,
            ci=[result.ci[0] * adjustment, result.ci[1] * adjustment],
            uplift=Uplift(
                dist=result.uplift.dist,
                mean=result.uplift.mean * adjustment,
                stddev=result.uplift.stddev * adjustment,
            ),
            risk=result.risk,
            risk_type=result.risk_type,
        )


class EffectBayesianABTest(BayesianABTest):
    def __init__(
        self,
        stat_a: TestStatistic,
        stat_b: TestStatistic,
        config: EffectBayesianConfig = EffectBayesianConfig(),
    ):
        super().__init__(stat_a, stat_b, config)
        self.stat_a = stat_a
        self.stat_b = stat_b
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
        )
        if self.scaled:
            result = self.scale_result(
                result, self.traffic_proportion_b, self.phase_length_days
            )
        return result

    @staticmethod
    def get_risk(mu, sigma) -> List[float]:
        prob_ctrl_is_better = norm.cdf(0.0, loc=mu, scale=sigma)
        mn_neg = truncated_normal_mean(mu=mu, sigma=sigma, a=-np.inf, b=0.0)
        mn_pos = truncated_normal_mean(mu=mu, sigma=sigma, a=0, b=np.inf)
        risk_ctrl = float((1.0 - prob_ctrl_is_better) * mn_pos)
        risk_trt = -float(prob_ctrl_is_better * mn_neg)
        return [risk_ctrl, risk_trt]


class Bandits:
    def __init__(
        self,
        stats: Dict[
            int, BanditPeriodData
        ],  # keys are 0, 1, 2, etc. mapping to periods; values are lists of length n_variations of summary_statistics
        config: BanditConfig,
    ):
        self.stats: Dict[int, List[BanditStatistic]] = {
            period: stats[period].stats for period in range(len(stats))
        }
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

    @staticmethod
    def attribute_array(
        stats: Dict[int, List[BanditStatistic]],
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
    def counts_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "n")

    @property
    def means_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "mean")

    @property
    def variances_array(self) -> np.ndarray:
        return self.attribute_array(self.stats, self.array_shape, "variance")

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

    # given num_periods x num_variations arrays of means and weights, returns the weighted means across periods.
    @staticmethod
    def construct_weighted_means(means_array, weights_array) -> np.ndarray:
        return np.sum(means_array * weights_array, axis=0)

    @property
    def variation_means(self) -> np.ndarray:
        return self.construct_weighted_means(self.means_array, self.weights_array)

    # find elements of an array that are positive
    @staticmethod
    def find_positive_sample_size(arr: np.ndarray) -> np.ndarray:
        return arr > 0

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
    def variation_variances(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.variances_array, self.weights_array, self.counts_array
        )

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
        # raise ValueError([test_stat, df, self.num_periods, self.num_variations, self.counts_array])
        return float(1 - chi2.cdf(test_stat, df=df))

    # given n_periods x n_variations arrays of counts and means, what is the additional reward compared to fixed weight balanced design?
    def compute_additional_reward(self) -> float:
        variation_counts_balanced = np.tile(
            np.expand_dims(self.period_counts, axis=1) / self.num_variations,
            (1, self.num_variations),
        )
        counts_diff = self.counts_array - variation_counts_balanced
        return float(np.sum(counts_diff * self.means_array))

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
            else "some variation counts fewer than " + str(min_n),
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

    def make_row(self, dimension, variation_index, variation_value):
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


class BanditsRatio(Bandits):
    @property
    def means_array(self):
        raise NotImplementedError(
            "RatioStatistic means cannot be combined over periods"
        )

    @property
    def variances_array(self):
        raise NotImplementedError(
            "RatioStatistic variances cannot be combined over periods"
        )

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

    def make_row(self, dimension, variation_index, variation_value):
        n = self.variation_counts[variation_index]
        mn_num = self.numerator_means[variation_index]
        v_num = self.numerator_variances[variation_index]
        mn_den = self.denominator_means[variation_index]
        v_den = self.denominator_variances[variation_index]
        cross_product = self.covariances[variation_index] + mn_num * mn_den
        return {
            "dimension": dimension,
            "variation": variation_value,
            "users": n,
            "count": n,
            "main_sum": self.sum_from_moments(n, mn_num),
            "main_sum_squares": self.sum_squares_from_moments(n, mn_num, v_num),
            "denominator_sum": self.sum_from_moments(n, mn_den),
            "denominator_sum_squares": self.sum_squares_from_moments(n, mn_den, v_den),
            "main_denominator_sum_product": cross_product,
        }


class BanditsCuped(Bandits):
    @property
    def post_sum(self):
        return self.attribute_array(
            self.stats, self.array_shape, "post_statistic", "sum"
        )

    @property
    def post_mean(self):
        return self.construct_mean(self.post_sum, self.counts_array)

    @property
    def post_variance(self):
        return self.attribute_array(
            self.stats, self.array_shape, "post_statistic", "variance"
        )

    @property
    def pre_sum(self):
        return self.attribute_array(
            self.stats, self.array_shape, "pre_statistic", "sum"
        )

    @property
    def pre_mean(self):
        return self.construct_mean(self.pre_sum, self.counts_array)

    @property
    def pre_variance(self):
        return self.attribute_array(
            self.stats, self.array_shape, "pre_statistic", "variance"
        )

    @property
    def post_pre_sum_of_products_array(self):
        return self.attribute_array(
            self.stats, self.array_shape, "post_pre_sum_of_products"
        )

    @property
    def theta_array(self):
        return self.attribute_array(self.stats, self.array_shape, "theta")

    @property
    def means_array(self):
        return self.post_mean - self.theta_array * self.pre_mean

    @property
    def variances_array(self):
        return (
            self.post_variance
            + pow(self.theta_array, 2) * self.pre_variance
            - 2 * self.theta_array * self.covariance_array
        )

    @property
    def covariance_array(self):
        cov_array = np.zeros(self.array_shape)
        bigger_than_one = self.counts_array > 1
        cov_array[bigger_than_one] = (
            self.post_pre_sum_of_products_array[bigger_than_one]
            - self.post_sum[bigger_than_one]
            * self.pre_sum[bigger_than_one]
            / self.counts_array[bigger_than_one]
        ) / (
            self.counts_array[bigger_than_one]
            - np.ones(self.array_shape)[bigger_than_one]
        )
        return cov_array

    @property
    def variation_means_post(self) -> np.ndarray:
        return self.construct_weighted_means(self.post_mean, self.weights_array)

    @property
    def variation_variances_post(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.post_variance, self.weights_array, self.counts_array
        )

    @property
    def variation_means_pre(self) -> np.ndarray:
        return self.construct_weighted_means(self.pre_mean, self.weights_array)

    @property
    def variation_variances_pre(self) -> np.ndarray:
        return self.construct_weighted_variances(
            self.pre_variance, self.weights_array, self.counts_array
        )

    @property
    def variation_post_pre_sum_of_products(self) -> np.ndarray:
        return self.construct_weighted_means(
            self.post_pre_sum_of_products_array, self.weights_array
        )

    def make_row(self, dimension, variation_index, variation_value):
        n = self.variation_counts[variation_index]
        mn_post = self.variation_means_post[variation_index]
        v_post = self.variation_variances_post[variation_index]
        mn_pre = self.variation_means_pre[variation_index]
        v_pre = self.variation_variances_pre[variation_index]
        return {
            "dimension": dimension,
            "variation": variation_value,
            "users": n,
            "count": n,
            "main_sum": self.sum_from_moments(n, mn_post),
            "main_sum_squares": self.sum_squares_from_moments(n, mn_post, v_post),
            "covariate_sum": self.sum_from_moments(n, mn_pre),
            "covariate_sum_squares": self.sum_squares_from_moments(n, mn_pre, v_pre),
            "main_covariate_sum_product": self.variation_post_pre_sum_of_products[
                variation_index
            ],
        }
