from abc import abstractmethod, ABC
from dataclasses import field
from typing import Dict, List, Optional, Union

import numpy as np
import random
from pydantic.dataclasses import dataclass

from gbstats.models.results import ResponseCI, BanditResult, SingleVariationResult
from gbstats.models.settings import ContextualBanditSettingsForStatsEngine
from gbstats.models.statistics import (
    SampleMeanStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
)
from gbstats.utils import (
    variance_of_ratios,
    gaussian_credible_interval,
)
from gbstats.bayesian.tests import BayesianConfig, GaussianPrior

ContextualBanditRow = Dict[str, Union[str, int, float]]


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
    cr: Optional[List[float]]
    ci: Optional[List[ResponseCI]]
    bandit_weights: Optional[List[float]]
    best_arm_probabilities: Optional[List[float]]
    seed: int
    bandit_update_message: str
    enough_units: Optional[bool]


def get_error_bandit_result(
    single_variation_results: Optional[List[SingleVariationResult]],
    update_message: str,
    error: str,
    reweight: bool,
    current_weights: List[float],
) -> BanditResult:
    return BanditResult(
        singleVariationResults=single_variation_results,
        currentWeights=current_weights,
        updatedWeights=current_weights,
        bestArmProbabilities=None,
        seed=0,
        updateMessage=update_message,
        error=error,
        reweight=reweight,
        weightsWereUpdated=False,
    )


@dataclass
class ContextualBanditLeaf:
    leaf_id: str
    rule: str
    condition: Dict[str, object]
    context_ids: List[str]
    n: int
    weights: List[float]
    best_arm_probabilities: Optional[List[float]]


@dataclass
class ContextualBanditTreeSummary:
    leaves: List[ContextualBanditLeaf]
    split_features: List[str]


@dataclass
class ContextualBanditResponse:
    result: List[BanditResult]
    tree_summary: ContextualBanditTreeSummary
    update_message: str
    error: Optional[str]


class LinearThompsonReducer:
    def fit(self):
        raise NotImplementedError(
            "linear_thompson contextual bandits are not implemented"
        )


def _parse_context_condition(context_id: str) -> Dict[str, object]:
    """Parse a context_id like 'browser=chrome|region=us' into a condition dict.

    Returns an empty dict if the context_id cannot be parsed (e.g. mock ids or
    the special 'other' value). Null-valued attributes ('__null__') are omitted.
    """
    if context_id == "other" or "|" not in context_id and "=" not in context_id:
        return {}
    try:
        condition: Dict[str, object] = {}
        for part in context_id.split("|"):
            eq = part.find("=")
            if eq < 1:
                return {}
            key = part[:eq]
            value = part[eq + 1 :]
            if value == "__null__":
                continue
            condition[key] = value
        return condition
    except Exception:
        return {}


class ContextualBandits:
    def __init__(
        self,
        rows: List[ContextualBanditRow],
        settings: ContextualBanditSettingsForStatsEngine,
    ):
        self.rows = rows
        self.settings = settings

    def compute_result(self) -> ContextualBanditResponse:
        if self.settings.tree_model == "linear_thompson":
            LinearThompsonReducer().fit()
        raise NotImplementedError(
            "regression_tree contextual bandits are not implemented"
        )

    def _current_weights(self, context_id: str) -> List[float]:
        configured = self.settings.current_weights_by_context.get(context_id)
        if configured:
            return configured
        return [1 / len(self.settings.var_ids)] * len(self.settings.var_ids)

    def _stats_for_rows(self, rows: List[ContextualBanditRow]) -> List[SampleMeanStatistic]:
        stats: List[SampleMeanStatistic] = []
        for variation in self.settings.var_ids:
            variation_rows = [r for r in rows if str(r["variation"]) == variation]
            n = int(sum(float(r.get("n", 0)) for r in variation_rows))
            main_sum = float(sum(float(r.get("main_sum", 0)) for r in variation_rows))
            main_sum_squares = float(sum(float(r.get("main_sum_squares", 0)) for r in variation_rows))
            stats.append(SampleMeanStatistic(n=n, sum=main_sum, sum_squares=main_sum_squares))
        return stats

    def _make_bandit_config(self) -> BanditConfig:
        return BanditConfig(
            prior_distribution=GaussianPrior(mean=0, variance=float(1e4), proper=True),
            bandit_weights_seed=self.settings.bandit_weights_seed,
            top_two=self.settings.top_two,
        )

    def _run_leaf(
        self,
        leaf_rows: List[ContextualBanditRow],
        current_weights: List[float],
    ):
        """Run Thompson sampling for a single leaf. Returns (bandit, bandit_response)."""
        stats = self._stats_for_rows(leaf_rows)
        bandit = BanditsSimple(stats, current_weights, self._make_bandit_config())
        return bandit, bandit.compute_result()


class RegressionTreeContextualBandits(ContextualBandits):
    """Per-context Thompson sampling grouped into at most max_leaves leaves.

    Each context that has enough users (>= min_users_per_leaf) gets its own
    leaf with parsed attribute conditions. Small or overflow contexts are pooled
    into a single catch-all leaf (condition = {}).
    """

    def compute_result(self) -> ContextualBanditResponse:
        context_ids = sorted({str(row["context_id"]) for row in self.rows})
        if not context_ids:
            context_ids = ["other"]

        # Total users per context
        context_n: Dict[str, int] = {
            ctx_id: int(
                sum(float(r.get("n", 0)) for r in self.rows if str(r["context_id"]) == ctx_id)
            )
            for ctx_id in context_ids
        }

        has_other = "other" in context_ids
        specific = [c for c in context_ids if c != "other"]
        # Sort largest first so we keep the most-sampled contexts as individual leaves
        specific.sort(key=lambda c: context_n[c], reverse=True)

        # Split into contexts with enough data and those without
        qualifying = [c for c in specific if context_n[c] >= self.settings.min_users_per_leaf]
        non_qualifying = [c for c in specific if context_n[c] < self.settings.min_users_per_leaf]

        # Determine if a catch-all leaf is needed (takes one slot from max_leaves)
        need_catch_all = has_other or bool(non_qualifying) or len(qualifying) > self.settings.max_leaves
        max_individual = (self.settings.max_leaves - 1) if need_catch_all else self.settings.max_leaves

        individual = qualifying[:max_individual]
        overflow = qualifying[max_individual:]
        catch_all: List[str] = overflow + non_qualifying + (["other"] if has_other else [])

        # Build leaf groups: each individual context is its own leaf, then the catch-all
        leaf_groups: List[List[str]] = [[c] for c in individual]
        if catch_all:
            leaf_groups.append(catch_all)

        # If no leaves yet (no data at all), put everything in one leaf
        if not leaf_groups:
            leaf_groups = [context_ids]

        all_results: List[BanditResult] = []
        leaf_summaries: List[ContextualBanditLeaf] = []

        for leaf_idx, leaf_ctx_ids in enumerate(leaf_groups):
            leaf_rows = [r for r in self.rows if str(r["context_id"]) in set(leaf_ctx_ids)]
            total_n = int(sum(float(r.get("n", 0)) for r in leaf_rows))

            is_catch_all = len(leaf_ctx_ids) != 1 or leaf_ctx_ids[0] == "other"
            condition: Dict[str, object] = (
                {} if is_catch_all else _parse_context_condition(leaf_ctx_ids[0])
            )

            # Use the current weights for the first recognised context in this leaf
            current_weights = self._current_weights(leaf_ctx_ids[0])

            bandit, bandit_response = self._run_leaf(leaf_rows, current_weights)
            updated_weights = (
                bandit_response.bandit_weights
                if self.settings.reweight and bandit_response.bandit_weights
                else current_weights
            )
            weights_were_updated = (
                self.settings.reweight and updated_weights != current_weights
            )
            single_variation_results = [
                SingleVariationResult(n, mn, ci)
                for n, mn, ci in zip(
                    bandit.variation_counts.tolist(),
                    bandit.posterior_mean.tolist(),
                    bandit_response.ci or [],
                )
            ]
            leaf_id = f"leaf-{leaf_idx}"

            for ctx_id in leaf_ctx_ids:
                all_results.append(
                    BanditResult(
                        singleVariationResults=single_variation_results,
                        currentWeights=current_weights,
                        updatedWeights=updated_weights,
                        bestArmProbabilities=bandit_response.best_arm_probabilities,
                        seed=bandit_response.seed,
                        updateMessage=bandit_response.bandit_update_message,
                        error=(
                            "" if bandit_response.ci else bandit_response.bandit_update_message
                        ),
                        reweight=self.settings.reweight,
                        weightsWereUpdated=weights_were_updated,
                        contextID=ctx_id,
                    )
                )

            leaf_summaries.append(
                ContextualBanditLeaf(
                    leaf_id=leaf_id,
                    rule="all contexts" if is_catch_all else leaf_ctx_ids[0],
                    condition=condition,
                    context_ids=leaf_ctx_ids,
                    n=total_n,
                    weights=updated_weights,
                    best_arm_probabilities=bandit_response.best_arm_probabilities,
                )
            )

        update_message = (
            all_results[0].updateMessage if all_results else "no data"
        )
        return ContextualBanditResponse(
            result=all_results,
            tree_summary=ContextualBanditTreeSummary(
                leaves=leaf_summaries,
                split_features=list(self.settings.contextual_attributes),
            ),
            update_message=update_message,
            error=None,
        )


class MockContextualBandits(ContextualBandits):
    def compute_result(self) -> ContextualBanditResponse:
        context_ids = sorted({str(row["context_id"]) for row in self.rows})
        if not context_ids:
            context_ids = ["other"]

        current_weights = self._current_weights(context_ids[0])
        bandit, bandit_response = self._run_leaf(self.rows, current_weights)
        updated_weights = (
            bandit_response.bandit_weights
            if self.settings.reweight and bandit_response.bandit_weights
            else current_weights
        )
        weights_were_updated = (
            self.settings.reweight and updated_weights != current_weights
        )
        single_variation_results = [
            SingleVariationResult(n, mn, ci)
            for n, mn, ci in zip(
                bandit.variation_counts.tolist(),
                bandit.posterior_mean.tolist(),
                bandit_response.ci or [],
            )
        ]

        results = [
            BanditResult(
                singleVariationResults=single_variation_results,
                currentWeights=current_weights,
                updatedWeights=updated_weights,
                bestArmProbabilities=bandit_response.best_arm_probabilities,
                seed=bandit_response.seed,
                updateMessage=bandit_response.bandit_update_message,
                error=(
                    "" if bandit_response.ci else bandit_response.bandit_update_message
                ),
                reweight=self.settings.reweight,
                weightsWereUpdated=weights_were_updated,
                contextID=context_id,
            )
            for context_id in context_ids
        ]
        total_n = int(sum(float(row.get("n", 0)) for row in self.rows))

        return ContextualBanditResponse(
            result=results,
            tree_summary=ContextualBanditTreeSummary(
                leaves=[
                    ContextualBanditLeaf(
                        leaf_id="mock-leaf-0",
                        rule="all contexts",
                        condition={},
                        context_ids=context_ids,
                        n=total_n,
                        weights=updated_weights,
                        best_arm_probabilities=bandit_response.best_arm_probabilities,
                    )
                ],
                split_features=[],
            ),
            update_message=bandit_response.bandit_update_message,
            error=None,
        )


class Bandits(ABC):
    def __init__(
        self,
        stats: List,
        current_weights: List[float],
        config: BanditConfig,
    ):
        self.stats = stats
        self.current_weights = current_weights
        self.config = config
        self.inverse = self.config.inverse
        self.cuped_indicator = False

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
    def num_variations(self) -> int:
        return len(self.stats)

    @property
    def current_sample_size(self):
        return sum(self.variation_counts)

    # sample sizes by variation
    @property
    def variation_counts(self) -> np.ndarray:
        return np.array([stat.n for stat in self.stats])

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

    @property
    def posterior_mean_unadjusted(self) -> np.ndarray:
        return self.posterior_mean

    @property
    def posterior_variance_unadjusted(self) -> np.ndarray:
        return self.posterior_variance

    # number of Monte Carlo samples to perform when sampling to estimate weights for the SDK
    @property
    def n_samples(self) -> int:
        return int(1e4)

    # scalar to add to the mean for leaderboard plots.  For non-cuped metrics, is 0.
    @property
    def addback(self) -> float:
        return 0

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
            p = best_arm_probabilities.copy()
        update_message = "successfully updated"
        p[p < self.config.min_variation_weight] = self.config.min_variation_weight
        p /= sum(p)
        credible_intervals: List[ResponseCI] = [
            gaussian_credible_interval(mn, s, self.config.alpha)
            for mn, s in zip(self.variation_means, np.sqrt(self.posterior_variance))
        ]
        enough_units = all(self.variation_counts >= 100)
        return BanditResponse(
            users=self.variation_counts.tolist(),
            cr=(self.variation_means).tolist(),
            ci=credible_intervals,
            bandit_weights=p.tolist() if enough_units else None,
            best_arm_probabilities=best_arm_probabilities.tolist(),
            seed=seed,
            bandit_update_message=(
                update_message
                if enough_units
                else "total sample size must be at least 100 per variation"
            ),
            enough_units=enough_units,
        )

    # function that takes weights for largest realization and turns into top two weights
    @staticmethod
    def top_two_weights(y: np.ndarray, inverse=False) -> np.ndarray:
        """Calculates the proportion of times each column contains the largest or second largest element in a row.
        Args:
        arr: A 2D NumPy array.
        Returns:
        A NumPy array of proportions, one for each column.
        """
        # g indices of sorted elements in each row
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
    def sum_from_moments(n, mn) -> float:
        return n * mn

    @staticmethod
    def sum_squares_from_moments(n, mn, v) -> float:
        return (n - 1) * v + n * mn**2

    @staticmethod
    def cross_product_from_moments(n, mn_x, mn_y, cov_x_y) -> float:
        return (n - 1) * cov_x_y + n * mn_x * mn_y

    @property
    @abstractmethod
    def variation_means(self) -> np.ndarray:
        raise NotImplementedError

    @property
    @abstractmethod
    def variation_variances(self) -> np.ndarray:
        raise NotImplementedError


class BanditsSimple(Bandits):
    def __init__(
        self,
        stats: List[SampleMeanStatistic],
        current_weights: List[float],
        config: BanditConfig,
    ):
        self.stats = stats
        self.current_weights = current_weights
        self.config = config
        self.inverse = self.config.inverse

    @property
    def variation_means(self) -> np.ndarray:
        return np.array([stat.mean for stat in self.stats])

    @property
    def variation_variances(self) -> np.ndarray:
        return np.array([stat.variance for stat in self.stats])


class BanditsRatio(Bandits):
    def __init__(
        self,
        stats: List[RatioStatistic],
        current_weights: List[float],
        config: BanditConfig,
    ):
        self.stats = stats
        self.current_weights = current_weights
        self.config = config
        self.inverse = self.config.inverse

    @property
    def numerator_means(self) -> np.ndarray:
        return np.array([stat.m_statistic.mean for stat in self.stats])

    @property
    def denominator_means(self) -> np.ndarray:
        return np.array([stat.d_statistic.mean for stat in self.stats])

    @property
    def variation_means(self) -> np.ndarray:
        return self.construct_mean(self.numerator_means, self.denominator_means)

    @property
    def numerator_variances(self) -> np.ndarray:
        return np.array([stat.m_statistic.variance for stat in self.stats])

    @property
    def denominator_variances(self) -> np.ndarray:
        return np.array([stat.d_statistic.variance for stat in self.stats])

    @property
    def covariances(self) -> np.ndarray:
        return np.array([stat.covariance for stat in self.stats])

    @property
    def variation_variances(self) -> np.ndarray:
        return np.array(
            [
                (
                    variance_of_ratios(
                        self.numerator_means[variation],
                        self.numerator_variances[variation],
                        self.denominator_means[variation],
                        self.denominator_variances[variation],
                        self.covariances[variation],
                    )
                    if self.variation_counts[variation] > 0
                    else 0
                )
                for variation in range(self.num_variations)
            ]
        )


class BanditsCuped(Bandits):
    def __init__(
        self,
        stats: List[RegressionAdjustedStatistic],
        current_weights: List[float],
        config: BanditConfig,
    ):
        self.stats = stats
        self.current_weights = current_weights
        self.config = config
        self.inverse = self.config.inverse
        self.cuped_indicator = True

    @property
    def variation_covariances(self) -> np.ndarray:
        return np.array([stat.covariance for stat in self.stats])

    @property
    def variation_means_post(self) -> np.ndarray:
        return np.array([stat.post_statistic.mean for stat in self.stats])

    @property
    def variation_variances_post(self) -> np.ndarray:
        return np.array([stat.post_statistic.variance for stat in self.stats])

    @property
    def variation_means_pre(self) -> np.ndarray:
        return np.array([stat.pre_statistic.mean for stat in self.stats])

    @property
    def variation_variances_pre(self) -> np.ndarray:
        return np.array([stat.pre_statistic.variance for stat in self.stats])

    @property
    def theta(self) -> float:
        return self.stats[0].theta if self.stats[0].theta else 0

    # for cuped, when producing intervals for the leaderboard, add back in the pooled baseline mean
    @property
    def addback(self) -> float:
        if self.current_sample_size:
            return float(
                self.theta
                * np.sum(self.variation_counts * self.variation_means_pre)
                / self.current_sample_size
            )
        else:
            return 0

    @property
    def variation_means(self) -> np.ndarray:
        return (
            self.variation_means_post
            - self.theta * self.variation_means_pre
            + self.addback
        )

    @property
    def posterior_mean_unadjusted(self) -> np.ndarray:
        return self.variation_means_post

    @property
    def posterior_variance_unadjusted(self) -> np.ndarray:
        v = np.zeros((self.num_variations,))
        positive_n = self.variation_counts > 0
        v[positive_n] = (
            self.variation_variances_post[positive_n]
            / self.variation_counts[positive_n]
        )
        return v

    @property
    def variation_variances(self) -> np.ndarray:
        return (
            self.variation_variances_post
            + self.theta**2 * self.variation_variances_pre
            - 2 * self.theta * self.variation_covariances
        )
