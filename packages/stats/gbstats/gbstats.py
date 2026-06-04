from collections.abc import Sequence
from dataclasses import asdict, dataclass
import dataclasses
import re
import traceback
import copy
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import numpy as np
import pandas as pd

from gbstats.bayesian.tests import (
    BayesianTestResult,
    EffectBayesianABTest,
    EffectBayesianConfig,
    GaussianPrior,
)

from gbstats.bayesian.bandits import (
    BanditsSimple,
    BanditsRatio,
    BanditsCuped,
    BanditConfig,
    get_error_bandit_result,
)

from gbstats.power.midexperimentpower import (
    MidExperimentPower,
    MidExperimentPowerConfig,
)

from gbstats.models.tests import BaseConfig, sum_stats

from gbstats.frequentist.tests import (
    FrequentistConfig,
    SequentialConfig,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
    OneSidedTreatmentGreaterTTest,
    OneSidedTreatmentLesserTTest,
    SequentialOneSidedTreatmentLesserTTest,
    SequentialOneSidedTreatmentGreaterTTest,
    FrequentistTestResult,
)

from gbstats.models.results import (
    BaselineResponseWithSupplementalResults,
    DimensionResponseIndividual,
    DimensionResponse,
    ExperimentMetricAnalysis,
    ExperimentMetricAnalysisResult,
    MetricStats,
    MultipleExperimentMetricAnalysis,
    BaselineResponse,
    BayesianVariationResponseIndividual,
    BayesianVariationResponse,
    FrequentistVariationResponseIndividual,
    FrequentistVariationResponse,
    SupplementalResults,
    VariationResponse,
    BanditResult,
    SingleVariationResult,
    PowerResponse,
    ContextualBanditResponse,
    ContextualBanditContextSummary,
    ContextualBanditNoTreeResult,
    ContextualBanditResult,
    ContextualLeafMapEntry,
    Context,
)

from gbstats.models.settings import (
    AnalysisSettingsForStatsEngine,
    BanditSettingsForStatsEngine,
    ContextualBanditSettingsForStatsEngine,
    DataForStatsEngine,
    ExperimentDataForStatsEngine,
    ExperimentMetricQueryResponseRows,
    MetricSettingsForStatsEngine,
    MetricType,
    QueryResultsForStatsEngine,
    VarIdMap,
    CONTEXTUAL_BANDIT_DIMENSION_COLUMN,
    CONTEXTUAL_BANDIT_DIMENSION_VALUE,
    get_bandit_settings,
    get_contextual_bandit_settings,
)
from gbstats.models.statistics import (
    ProportionStatistic,
    QuantileStatistic,
    QuantileClusteredStatistic,
    RatioStatistic,
    RegressionAdjustedRatioStatistic,
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
    SummableStatistic,
    TestStatistic,
    BanditStatistic,
)
from gbstats.utils import check_srm

from gbstats.models.tests import EffectMomentsResult


SUM_COLS = [
    "users",
    "count",
    "main_sum",
    "main_sum_squares",
    "denominator_sum",
    "denominator_sum_squares",
    "main_denominator_sum_product",
    "covariate_sum",
    "covariate_sum_squares",
    "main_covariate_sum_product",
    "denominator_pre_sum",
    "denominator_pre_sum_squares",
    "main_post_denominator_pre_sum_product",
    "main_pre_denominator_post_sum_product",
    "main_pre_denominator_pre_sum_product",
    "denominator_post_denominator_pre_sum_product",
    "main_sum_uncapped",
    "main_sum_squares_uncapped",
    "denominator_sum_uncapped",
    "denominator_sum_squares_uncapped",
    "main_denominator_sum_product_uncapped",
    "covariate_sum_uncapped",
    "covariate_sum_squares_uncapped",
    "main_covariate_sum_product_uncapped",
    "denominator_pre_sum_uncapped",
    "denominator_pre_sum_squares_uncapped",
    "main_post_denominator_pre_sum_product_uncapped",
    "main_pre_denominator_post_sum_product_uncapped",
    "main_pre_denominator_pre_sum_product_uncapped",
    "denominator_post_denominator_pre_sum_product_uncapped",
]

NON_SUMMABLE_COLS = [
    "quantile_n",
    "quantile_nstar",
    "quantile",
    "quantile_lower",
    "quantile_upper",
    "theta",
]

ROW_COLS = SUM_COLS + NON_SUMMABLE_COLS

BANDIT_DIMENSION = {
    "column": "dimension",
    "value": "All",
}

LEAF_ID_COLUMN = "leaf_id"

StatisticalTests = Union[
    EffectBayesianABTest,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
    OneSidedTreatmentGreaterTTest,
    OneSidedTreatmentLesserTTest,
    SequentialOneSidedTreatmentLesserTTest,
    SequentialOneSidedTreatmentGreaterTTest,
]


# Looks for any variation ids that are not in the provided map
def detect_unknown_variations(
    rows, var_ids: Set[str], ignore_ids: Set[str] = {"__multiple__"}
) -> Set[str]:
    unknown_var_ids = []
    for row in rows.itertuples(index=False):
        id = str(row.variation)
        if id not in ignore_ids and id not in var_ids:
            unknown_var_ids.append(id)
    return set(unknown_var_ids)


def get_dimension_column_name(dimension: str) -> str:
    dimension_column_name = "dimension"
    if dimension == "pre:date":
        dimension_column_name = "dim_pre_date"
    elif dimension == "pre:activation":
        dimension_column_name = "dim_activation"
    elif dimension.startswith("exp:"):
        dimension_column_name = "dim_exp_" + dimension.split(":")[1]
    elif dimension.startswith("precomputed:"):
        dimension_column_name = "dim_exp_" + dimension.split(":")[1]
    elif dimension.startswith("dim_"):
        dimension_column_name = "dim_unit_" + dimension

    return dimension_column_name


@dataclass
class InitialMetricDataStrata:
    total_units: int
    data: Dict[str, Dict[str, Any]]


@dataclass
class DimensionMetricData:
    dimension: str
    total_units: int
    data: pd.DataFrame


# Transform raw SQL result for metrics into a dataframe per dimension level
def get_metric_dfs(
    rows: pd.DataFrame,
    var_id_map: VarIdMap,
    var_names: List[str],
    dimension: Optional[str] = None,
    post_stratify: bool = False,
) -> List[DimensionMetricData]:
    dfc = rows.copy()
    dimensions: Dict[str, InitialMetricDataStrata] = {}
    dimension_column_name = (
        "" if not dimension else get_dimension_column_name(dimension)
    )

    if post_stratify:
        # if post-stratifying, then we need to create a strata column
        # to ensure data is not collapsed across strata
        precomputed_dimension_df = dfc.filter(like="dim_exp_")
        dfc["strata"] = precomputed_dimension_df.astype(str).agg("_".join, axis=1)
    else:
        # if not post-stratifying, then all rows are in the same strata
        # and we will collapse all data into one row per dimension
        dfc["strata"] = ""

    # Each row in the raw SQL result is a dimension/variation combo
    # We want to end up with one row per dimension/strata
    for row in dfc.itertuples(index=False):
        # if not found, try to find a column with "dimension" for backwards compatibility
        # fall back to one unnamed dimension if even that column is not found
        dim = getattr(row, dimension_column_name, getattr(row, "dimension", ""))
        strata = getattr(row, "strata", "")

        # If this is the first time we're seeing this dimension-strata combo, create an empty dict
        if dim not in dimensions:
            dimensions[dim] = InitialMetricDataStrata(
                total_units=0,
                data={},
            )
        if strata not in dimensions[dim].data:
            dimensions[dim].data[strata] = {
                "dimension": dim,
                "strata": strata,
            }

            # Add columns for each variation (including baseline)
            for key in var_id_map:
                i = var_id_map[key]
                prefix = f"v{i}" if i > 0 else "baseline"
                dimensions[dim].data[strata][f"{prefix}_id"] = key
                dimensions[dim].data[strata][f"{prefix}_name"] = var_names[i]
                for col in ROW_COLS:
                    dimensions[dim].data[strata][f"{prefix}_{col}"] = 0

        # Add this SQL result row into the dimension dict if we recognize the variation
        key = str(row.variation)
        if key in var_id_map:
            i = var_id_map[key]
            dimensions[dim].total_units += getattr(row, "users", 0)
            prefix = f"v{i}" if i > 0 else "baseline"

            # Sum here in case multiple rows per dimension
            for col in SUM_COLS:
                # Special handling for count, if missing returns a method, so override with user value
                if col == "count" and callable(getattr(row, col)):
                    dimensions[dim].data[strata][f"{prefix}_count"] += getattr(
                        row, "users", 0
                    )
                else:
                    dimensions[dim].data[strata][f"{prefix}_{col}"] += getattr(
                        row, col, 0
                    )
            for col in NON_SUMMABLE_COLS:
                if dimensions[dim].data[strata][f"{prefix}_{col}"] != 0:
                    raise ValueError(
                        f"ImplementationError: Non-summable column {col} already has a value for dimension {dim}/{strata}"
                    )
                dimensions[dim].data[strata][f"{prefix}_{col}"] = getattr(row, col, 0)
    return [
        DimensionMetricData(
            dimension=dimension,
            total_units=dimension_data.total_units,
            data=pd.DataFrame([s for s in dimension_data.data.values()]),
        )
        for dimension, dimension_data in dimensions.items()
    ]


# Limit to the top X dimensions with the most users
# Merge the rest into an "(other)" dimension
def reduce_dimensionality(
    metric_data: List[DimensionMetricData],
    num_variations: int,
    max: int = 20,
    keep_other: bool = True,
    combine_strata: bool = True,
) -> List[DimensionMetricData]:

    metric_data.sort(key=lambda i: i.total_units, reverse=True)

    new_metric_data: List[DimensionMetricData] = []

    for i, dimension in enumerate(metric_data):
        # For the first few dimensions, keep them as-is
        if i < max:
            new_metric_data.append(dimension)
        # For the rest, merge them into the last dimension
        elif keep_other:
            current = new_metric_data[max - 1]
            current.dimension = "(other)"
            current.data["dimension"] = "(other)"
            dimension.data["dimension"] = "(other)"
            current.total_units += dimension.total_units
            for v in range(num_variations):
                prefix = f"v{v}" if v > 0 else "baseline"
                if combine_strata:
                    for row in dimension.data.itertuples(index=False):
                        for col in SUM_COLS:
                            current.data[f"{prefix}_{col}"] += getattr(
                                row, f"{prefix}_{col}", 0
                            )
                else:
                    current.data = pd.concat([current.data, dimension.data])
    # TODO: test that dimension with 21 values collapses correctly
    return new_metric_data


def get_configured_test(
    stats: List[Tuple[TestStatistic, TestStatistic]],
    total_users: int,
    analysis: AnalysisSettingsForStatsEngine,
    metric: MetricSettingsForStatsEngine,
    post_stratify: bool = False,
) -> StatisticalTests:

    base_config = {
        "total_users": total_users,
        "traffic_percentage": analysis.traffic_percentage,
        "phase_length_days": analysis.phase_length_days,
        "difference_type": analysis.difference_type,
        "post_stratify": post_stratify,
    }
    if analysis.use_covariate_as_response:
        num_variations = len(analysis.var_names)
        # if there are no goal metrics, just use 1 as the number of tests
        num_tests = max(
            1,
            (num_variations - 1)
            * (analysis.num_goal_metrics + analysis.num_guardrail_metrics),
        )
        alpha = analysis.alpha / num_tests
    else:
        alpha = analysis.alpha
    if analysis.stats_engine == "frequentist":
        if analysis.sequential_testing_enabled:
            sequential_config = SequentialConfig(
                **base_config,
                alpha=alpha,
                sequential_tuning_parameter=analysis.sequential_tuning_parameter,
            )
            if analysis.one_sided_intervals:
                if metric.inverse:
                    return SequentialOneSidedTreatmentGreaterTTest(
                        stats, sequential_config
                    )
                else:
                    return SequentialOneSidedTreatmentLesserTTest(
                        stats, sequential_config
                    )
            else:
                return SequentialTwoSidedTTest(stats, sequential_config)
        else:
            config = FrequentistConfig(
                **base_config,
                alpha=alpha,
            )
            if analysis.one_sided_intervals:
                if metric.inverse:
                    return OneSidedTreatmentGreaterTTest(stats, config)
                else:
                    return OneSidedTreatmentLesserTTest(stats, config)
            else:
                return TwoSidedTTest(stats, config)
    else:
        if analysis.use_covariate_as_response:
            prior = GaussianPrior(
                mean=0,
                variance=100,
                proper=False,
            )
        else:
            prior = GaussianPrior(
                mean=metric.prior_mean,
                variance=pow(metric.prior_stddev, 2),
                proper=metric.prior_proper,
            )
        return EffectBayesianABTest(
            stats,
            EffectBayesianConfig(
                **base_config,
                inverse=metric.inverse,
                prior_effect=prior,
                prior_type="relative",
                alpha=alpha,
            ),
        )


def decision_making_conditions(metric, analysis):
    return (
        metric.business_metric_type
        and "goal" in metric.business_metric_type
        and analysis.difference_type == "relative"
        and analysis.dimension == ""
    )


def run_mid_experiment_power(
    total_users: int,
    num_variations: int,
    effect_moments: EffectMomentsResult,
    res: Union[BayesianTestResult, FrequentistTestResult],
    metric: MetricSettingsForStatsEngine,
    analysis: AnalysisSettingsForStatsEngine,
) -> PowerResponse:
    config = BaseConfig(
        difference_type=analysis.difference_type,
        traffic_percentage=analysis.traffic_percentage,
        phase_length_days=analysis.phase_length_days,
        total_users=total_users,
        alpha=analysis.alpha,
    )

    if isinstance(res, BayesianTestResult):
        prior = GaussianPrior(
            mean=metric.prior_mean,
            variance=pow(metric.prior_stddev, 2),
            proper=metric.prior_proper,
        )
        p_value_corrected = False
    else:
        prior = None
        p_value_corrected = analysis.p_value_corrected

    power_config = MidExperimentPowerConfig(
        target_mde=metric.target_mde,
        num_goal_metrics=analysis.num_goal_metrics,
        num_variations=num_variations,
        prior_effect=prior,
        p_value_corrected=p_value_corrected,
        sequential=analysis.sequential_testing_enabled,
        sequential_tuning_parameter=analysis.sequential_tuning_parameter,
    )
    mid_experiment_power = MidExperimentPower(
        effect_moments=effect_moments,
        test_result=res,
        config=config,
        power_config=power_config,
    )
    mid_experiment_power_result = mid_experiment_power.calculate_sample_size()

    return PowerResponse(
        status=mid_experiment_power_result.update_message,
        errorMessage=mid_experiment_power_result.error,
        firstPeriodPairwiseSampleSize=mid_experiment_power.pairwise_sample_size,
        targetMDE=metric.target_mde,
        sigmahat2Delta=mid_experiment_power.sigmahat_2_delta,
        priorProper=(
            mid_experiment_power.prior_effect.proper
            if mid_experiment_power.prior_effect
            else None
        ),
        priorLiftMean=(
            mid_experiment_power.prior_effect.mean
            if mid_experiment_power.prior_effect
            else None
        ),
        priorLiftVariance=(
            mid_experiment_power.prior_effect.variance
            if mid_experiment_power.prior_effect
            else None
        ),
        upperBoundAchieved=mid_experiment_power_result.upper_bound_achieved,
        scalingFactor=mid_experiment_power_result.scaling_factor,
    )


def get_cuped_unadjusted_stat(stat: TestStatistic) -> TestStatistic:
    if isinstance(stat, RegressionAdjustedStatistic):
        if isinstance(stat.post_statistic, SampleMeanStatistic):
            return SampleMeanStatistic(
                n=stat.post_statistic.n,
                sum=stat.post_statistic.sum,
                sum_squares=stat.post_statistic.sum_squares,
            )
        else:
            return ProportionStatistic(
                n=stat.post_statistic.n, sum=stat.post_statistic.sum
            )
    elif isinstance(stat, RegressionAdjustedRatioStatistic):
        if isinstance(stat.m_statistic_post, SampleMeanStatistic):
            m_statistic = SampleMeanStatistic(
                n=stat.m_statistic_post.n,
                sum=stat.m_statistic_post.sum,
                sum_squares=stat.m_statistic_post.sum_squares,
            )
        else:
            m_statistic = ProportionStatistic(
                n=stat.m_statistic_post.n, sum=stat.m_statistic_post.sum
            )
        if isinstance(stat.d_statistic_post, SampleMeanStatistic):
            d_statistic = SampleMeanStatistic(
                n=stat.d_statistic_post.n,
                sum=stat.d_statistic_post.sum,
                sum_squares=stat.d_statistic_post.sum_squares,
            )
        else:
            d_statistic = ProportionStatistic(
                n=stat.d_statistic_post.n, sum=stat.d_statistic_post.sum
            )
        return RatioStatistic(
            n=stat.n,
            m_statistic=m_statistic,
            d_statistic=d_statistic,
            m_d_sum_of_products=stat.m_post_d_post_sum_of_products,
        )
    return stat


def test_post_strat_eligible(
    metric: MetricSettingsForStatsEngine, analysis: AnalysisSettingsForStatsEngine
) -> bool:
    return analysis.post_stratification_enabled and metric.statistic_type not in [
        "quantile_event",
        "quantile_unit",
    ]


def get_pre_exposure_statistics(
    stat_a: TestStatistic,
    stat_b: TestStatistic,
) -> Tuple[TestStatistic, TestStatistic]:

    stat_empty = SampleMeanStatistic(
        n=int(0),
        sum=0.0,
        sum_squares=0.0,
    )
    pre_stat_a = copy.deepcopy(stat_empty)
    pre_stat_b = copy.deepcopy(stat_empty)

    if (
        isinstance(stat_a, RegressionAdjustedStatistic)
        and isinstance(stat_b, RegressionAdjustedStatistic)
        and isinstance(stat_a.pre_statistic, SampleMeanStatistic)
        and isinstance(stat_b.pre_statistic, SampleMeanStatistic)
    ):
        pre_stat_a = SampleMeanStatistic(
            n=stat_a.n,
            sum=stat_a.pre_statistic.sum,
            sum_squares=stat_a.pre_statistic.sum_squares,
        )
        pre_stat_b = SampleMeanStatistic(
            n=stat_b.n,
            sum=stat_b.pre_statistic.sum,
            sum_squares=stat_b.pre_statistic.sum_squares,
        )
    elif (
        isinstance(stat_a, RegressionAdjustedStatistic)
        and isinstance(stat_b, RegressionAdjustedStatistic)
        and isinstance(stat_a.pre_statistic, ProportionStatistic)
        and isinstance(stat_b.pre_statistic, ProportionStatistic)
    ):
        pre_stat_a = ProportionStatistic(
            n=stat_a.n,
            sum=stat_a.pre_statistic.sum,
        )
        pre_stat_b = ProportionStatistic(
            n=stat_b.n,
            sum=stat_b.pre_statistic.sum,
        )
    elif isinstance(stat_a, RegressionAdjustedRatioStatistic) and isinstance(
        stat_b, RegressionAdjustedRatioStatistic
    ):
        pre_stat_a = RatioStatistic(
            n=stat_a.n,
            m_statistic=stat_a.m_statistic_pre,
            d_statistic=stat_a.d_statistic_pre,
            m_d_sum_of_products=stat_a.m_pre_d_pre_sum_of_products,
        )
        pre_stat_b = RatioStatistic(
            n=stat_b.n,
            m_statistic=stat_b.m_statistic_pre,
            d_statistic=stat_b.d_statistic_pre,
            m_d_sum_of_products=stat_b.m_pre_d_pre_sum_of_products,
        )
    return pre_stat_a, pre_stat_b


# Run A/B test analysis for each variation and dimension
def analyze_metric_df(
    metric_data: List[DimensionMetricData],
    num_variations: int,
    metric: MetricSettingsForStatsEngine,
    analysis: AnalysisSettingsForStatsEngine,
) -> List[DimensionResponseIndividual]:

    def analyze_dimension(
        dimensionData: DimensionMetricData,
    ) -> DimensionResponseIndividual:
        d = dimensionData.data
        variation_data = []
        baseline_stat: Optional[TestStatistic] = None

        # Loop through each non-baseline variation and run an analysis
        for i in range(1, num_variations):
            control_stats = []
            variation_stats = []
            # get one statistic per row (should be one row for non-post-stratified tests)
            for _, row in d.iterrows():
                stat_control = variation_statistic_from_metric_row(
                    row, "baseline", metric
                )
                stat_variation = variation_statistic_from_metric_row(
                    row, f"v{i}", metric
                )
                if analysis.use_covariate_as_response:
                    stat_control, stat_variation = get_pre_exposure_statistics(
                        stat_control, stat_variation
                    )
                control_stats.append(stat_control)
                variation_stats.append(stat_variation)

            stats = list(zip(control_stats, variation_stats))

            # TODO(post-stratification): throw error if post-stratify is false and there are 2+ rows?
            post_stratify = test_post_strat_eligible(metric, analysis)
            test = get_configured_test(
                stats,
                dimensionData.total_units,
                analysis=analysis,
                metric=metric,
                post_stratify=post_stratify,
            )
            res = test.compute_result()
            realized_settings = test.realized_settings
            baseline_stat = test.stat_a  # Capture for baseline response

            power_response: Optional[PowerResponse] = None
            if decision_making_conditions(metric, analysis):
                power_response = run_mid_experiment_power(
                    dimensionData.total_units,
                    num_variations,
                    test.moments_result,
                    res,
                    metric,
                    analysis,
                )

            metric_response = get_metric_response(
                d,
                test.stat_b,
                i,
                metric.statistic_type in ["quantile_event", "quantile_unit"],
            )
            # Create base variation response first
            base_variation_response = BaselineResponse(
                **asdict(metric_response),
            )
            # Safely build specific response type from base response
            if isinstance(res, BayesianTestResult):
                variation_response = BayesianVariationResponseIndividual(
                    **asdict(base_variation_response),
                    **asdict(res),
                    realizedSettings=realized_settings,
                    power=(
                        power_response
                        if isinstance(power_response, PowerResponse)
                        else None
                    ),
                )
                variation_data.append(variation_response)
            elif isinstance(res, FrequentistTestResult):
                variation_response = FrequentistVariationResponseIndividual(
                    **asdict(base_variation_response),
                    **asdict(res),
                    realizedSettings=realized_settings,
                    power=(
                        power_response
                        if isinstance(power_response, PowerResponse)
                        else None
                    ),
                )
                variation_data.append(variation_response)
            else:
                raise ValueError(f"Unexpected test result type: {type(res)}")

        # TODO check front-end SRM matches this SRM
        srm_p = check_srm(
            [d["baseline_users"].sum()]
            + [d[f"v{i}_users"].sum() for i in range(1, num_variations)],
            analysis.weights,
        )

        # insert baseline data in the appropriate position, uses test from last variation
        # but should be the same for the baseline (stat_a is the control/baseline statistic)
        if baseline_stat is None:
            # Edge case: no treatment variations, compute baseline stat directly
            control_stats = []
            for _, row in d.iterrows():
                control_stats.append(
                    variation_statistic_from_metric_row(row, "baseline", metric)
                )
            stats = list(zip(control_stats, control_stats))
            stat_a_summed, _ = sum_stats(stats)
            baseline_stat = stat_a_summed
        baseline_data = get_metric_response(
            d,
            baseline_stat,
            0,
            metric.statistic_type in ["quantile_event", "quantile_unit"],
        )
        variation_data.insert(analysis.baseline_index, baseline_data)

        return DimensionResponseIndividual(
            dimension=dimensionData.dimension, srm=srm_p, variations=variation_data
        )

    return [analyze_dimension(mdat) for mdat in metric_data]


def get_metric_response(
    metric_row: pd.DataFrame, statistic: TestStatistic, v: int, is_quantile: bool
) -> BaselineResponse:
    prefix = f"v{v}" if v > 0 else "baseline"

    count = metric_row[f"{prefix}_count"].sum()
    if is_quantile:
        # replace count with quantile_n for quantile metrics
        count = metric_row[f"{prefix}_quantile_n"].sum()
    stats = MetricStats(
        users=metric_row[f"{prefix}_users"].sum(),
        count=count,
        stddev=statistic.stddev,
        mean=statistic.unadjusted_mean,
    )
    return BaselineResponse(
        cr=statistic.unadjusted_mean,
        value=metric_row[f"{prefix}_main_sum"].sum(),
        users=metric_row[f"{prefix}_users"].sum(),
        denominator=metric_row[f"{prefix}_denominator_sum"].sum(),
        stats=stats,
    )


def variation_statistic_from_metric_row(
    row: pd.Series,
    prefix: str,
    metric: MetricSettingsForStatsEngine,
) -> TestStatistic:
    if metric.statistic_type == "quantile_event":
        if metric.quantile_value is None:
            raise ValueError("quantile_value must be set for quantile_event metric")
        return QuantileClusteredStatistic(
            n=row[f"{prefix}_quantile_n"],
            n_star=row[f"{prefix}_quantile_nstar"],
            nu=metric.quantile_value,
            quantile_hat=row[f"{prefix}_quantile"],
            quantile_lower=row[f"{prefix}_quantile_lower"],
            quantile_upper=row[f"{prefix}_quantile_upper"],
            main_sum=row[f"{prefix}_main_sum"],
            main_sum_squares=row[f"{prefix}_main_sum_squares"],
            denominator_sum=row[f"{prefix}_denominator_sum"],
            denominator_sum_squares=row[f"{prefix}_denominator_sum_squares"],
            main_denominator_sum_product=row[f"{prefix}_main_denominator_sum_product"],
            n_clusters=row[f"{prefix}_users"],
        )
    elif metric.statistic_type == "quantile_unit":
        if metric.quantile_value is None:
            raise ValueError("quantile_value must be set for quantile_unit metric")
        return QuantileStatistic(
            n=row[f"{prefix}_quantile_n"],
            n_star=row[f"{prefix}_quantile_nstar"],
            nu=metric.quantile_value,
            quantile_hat=row[f"{prefix}_quantile"],
            quantile_lower=row[f"{prefix}_quantile_lower"],
            quantile_upper=row[f"{prefix}_quantile_upper"],
        )
    elif metric.statistic_type == "ratio_ra":
        m_statistic_post = base_statistic_from_metric_row(
            row, prefix, "main", metric.main_metric_type
        )
        d_statistic_post = base_statistic_from_metric_row(
            row, prefix, "denominator", metric.denominator_metric_type
        )
        m_statistic_pre = base_statistic_from_metric_row(
            row, prefix, "covariate", metric.main_metric_type
        )
        d_statistic_pre = base_statistic_from_metric_row(
            row, prefix, "denominator_pre", metric.denominator_metric_type
        )
        m_post_m_pre_sum_of_products = row[f"{prefix}_main_covariate_sum_product"]
        d_post_d_pre_sum_of_products = row[
            f"{prefix}_denominator_post_denominator_pre_sum_product"
        ]
        m_pre_d_pre_sum_of_products = row[
            f"{prefix}_main_pre_denominator_pre_sum_product"
        ]
        m_post_d_post_sum_of_products = row[f"{prefix}_main_denominator_sum_product"]
        m_post_d_pre_sum_of_products = row[
            f"{prefix}_main_post_denominator_pre_sum_product"
        ]
        m_pre_d_post_sum_of_products = row[
            f"{prefix}_main_pre_denominator_post_sum_product"
        ]
        return RegressionAdjustedRatioStatistic(
            n=row[f"{prefix}_users"],
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
    elif metric.statistic_type == "ratio":
        m_d_sum_of_products = row[f"{prefix}_main_denominator_sum_product"]
        return RatioStatistic(
            m_statistic=base_statistic_from_metric_row(
                row, prefix, "main", metric.main_metric_type
            ),
            d_statistic=base_statistic_from_metric_row(
                row, prefix, "denominator", metric.denominator_metric_type
            ),
            m_d_sum_of_products=m_d_sum_of_products,
            n=row[f"{prefix}_users"],
        )
    elif metric.statistic_type == "mean":
        return base_statistic_from_metric_row(
            row, prefix, "main", metric.main_metric_type
        )
    elif metric.statistic_type == "mean_ra":
        post_statistic = base_statistic_from_metric_row(
            row, prefix, "main", metric.main_metric_type
        )
        pre_statistic = base_statistic_from_metric_row(
            row, prefix, "covariate", metric.covariate_metric_type
        )
        post_pre_sum_of_products = row[f"{prefix}_main_covariate_sum_product"]
        n = row[f"{prefix}_users"]
        # Theta will be overriden with correct value later for A/B tests, needs to be passed in for bandits
        theta = None
        if metric.keep_theta:
            theta = row[f"{prefix}_theta"] if f"{prefix}_theta" in row.index else 0
        return RegressionAdjustedStatistic(
            post_statistic=post_statistic,
            pre_statistic=pre_statistic,
            post_pre_sum_of_products=post_pre_sum_of_products,
            n=n,
            theta=theta,
        )
    else:
        raise ValueError(f"Unexpected statistic_type: {metric.statistic_type}")


def base_statistic_from_metric_row(
    row: pd.Series,
    prefix: str,
    component: str,
    metric_type: Optional[MetricType],
) -> Union[ProportionStatistic, SampleMeanStatistic]:
    if metric_type:
        if metric_type == "binomial":
            return ProportionStatistic(
                sum=row[f"{prefix}_{component}_sum"], n=row[f"{prefix}_count"]
            )
        elif metric_type == "count":
            return SampleMeanStatistic(
                sum=row[f"{prefix}_{component}_sum"],
                sum_squares=row[f"{prefix}_{component}_sum_squares"],
                n=row[f"{prefix}_count"],
            )
        else:
            raise ValueError(f"Unexpected metric_type: {metric_type}")
    else:
        raise ValueError("Unexpectedly metric_type was None")


# Run a specific analysis given data and configuration settings
def process_analysis(
    rows: pd.DataFrame,
    var_id_map: VarIdMap,
    metric: MetricSettingsForStatsEngine,
    analysis: AnalysisSettingsForStatsEngine,
) -> List[DimensionResponse]:
    # diff data, convert raw sql into df of dimensions, and get rid of extra dimensions
    var_names = analysis.var_names
    max_dimensions = analysis.max_dimensions
    # Convert raw SQL result into a dataframe of dimensions
    metric_data = get_metric_dfs(
        rows=rows,
        var_id_map=var_id_map,
        var_names=var_names,
        dimension=analysis.dimension,
        post_stratify=analysis.post_stratification_enabled,
    )
    # inputs for reduce_dimensionality method
    # Limit to the top X dimensions with the most users
    # not possible to just re-sum for quantile metrics,
    # so we throw away "other" dimension
    keep_other = True
    if metric.statistic_type in ["quantile_event", "quantile_unit"]:
        keep_other = False
    if metric.keep_theta and metric.statistic_type == "mean_ra":
        keep_other = False

    num_variations = len(var_names)
    reduced_metric_data = reduce_dimensionality(
        metric_data=metric_data,
        num_variations=num_variations,
        max=max_dimensions,
        keep_other=keep_other,
        combine_strata=not analysis.post_stratification_enabled,
    )

    result = create_core_and_supplemental_results(
        reduced_metric_data=reduced_metric_data,
        num_variations=num_variations,
        metric=metric,
        analysis=analysis,
    )
    return result


def replace_with_uncapped(df: pd.DataFrame) -> pd.DataFrame:
    """
    Replaces values in columns with their counterparts ending in '_uncapped'.

    Args:
        df: Input pandas DataFrame.

    Returns:
        A DataFrame with updated values and '_uncapped' columns removed.
    """
    # Create a copy to avoid SettingWithCopy warnings or mutating the original
    df = df.copy()

    # Identify all columns that end with the suffix
    uncapped_cols = [col for col in df.columns if col.endswith("_uncapped")]

    for uncapped_col in uncapped_cols:
        # Determine the target column name (e.g., 'foo_capped' -> 'foo')
        original_col = uncapped_col.replace("_uncapped", "")

        # Check if the original column exists before trying to replace it
        if original_col in df.columns:
            df[original_col] = df[uncapped_col]

    return df


def create_core_and_supplemental_results(
    reduced_metric_data: List[DimensionMetricData],
    num_variations: int,
    metric: MetricSettingsForStatsEngine,
    analysis: AnalysisSettingsForStatsEngine,
) -> List[DimensionResponse]:

    core_result = analyze_metric_df(
        metric_data=reduced_metric_data,
        num_variations=num_variations,
        metric=metric,
        analysis=analysis,
    )

    cuped_adjusted = metric.statistic_type in ["ratio_ra", "mean_ra"]
    compute_uncapped_metric = metric.compute_uncapped_metric
    analysis_bayesian = analysis.stats_engine == "bayesian" and metric.prior_proper
    post_stratify = test_post_strat_eligible(metric, analysis)

    if cuped_adjusted:
        metric_cuped_unadjusted = dataclasses.replace(
            metric,
            statistic_type="mean" if metric.statistic_type == "mean_ra" else "ratio",
        )
        result_cuped_unadjusted = analyze_metric_df(
            metric_data=reduced_metric_data,
            num_variations=num_variations,
            metric=metric_cuped_unadjusted,
            analysis=analysis,
        )
        if post_stratify:
            analysis_unstratified = dataclasses.replace(
                analysis, post_stratification_enabled=False
            )
            result_unstratified = analyze_metric_df(
                metric_data=reduced_metric_data,
                num_variations=num_variations,
                metric=metric,
                analysis=analysis_unstratified,
            )
            result_no_variance_reduction = analyze_metric_df(
                metric_data=reduced_metric_data,
                num_variations=num_variations,
                metric=metric_cuped_unadjusted,
                analysis=analysis_unstratified,
            )
        else:
            result_unstratified = None
            result_no_variance_reduction = None
    else:
        result_cuped_unadjusted = None
        result_no_variance_reduction = None
        if post_stratify:
            analysis_unstratified = dataclasses.replace(
                analysis, post_stratification_enabled=False
            )
            result_unstratified = analyze_metric_df(
                metric_data=reduced_metric_data,
                num_variations=num_variations,
                metric=metric,
                analysis=analysis_unstratified,
            )
        else:
            result_unstratified = None
    if compute_uncapped_metric:
        reduced_metric_data_uncapped = copy.deepcopy(reduced_metric_data)
        for d in reduced_metric_data_uncapped:
            d.data = replace_with_uncapped(d.data)
        result_uncapped = analyze_metric_df(
            metric_data=reduced_metric_data_uncapped,
            num_variations=num_variations,
            metric=metric,
            analysis=analysis,
        )
    else:
        result_uncapped = None
    if analysis_bayesian:
        metric_flat_prior = dataclasses.replace(metric, prior_proper=False)
        result_flat_prior = analyze_metric_df(
            metric_data=reduced_metric_data,
            num_variations=num_variations,
            metric=metric_flat_prior,
            analysis=analysis,
        )
    else:
        result_flat_prior = None

    result = combine_core_and_supplemental_results(
        core_result,
        result_cuped_unadjusted,
        result_uncapped,
        result_flat_prior,
        result_unstratified,
        result_no_variance_reduction,
    )

    return result


def combine_core_and_supplemental_results(
    core_result: List[DimensionResponseIndividual],
    result_cuped_unadjusted: Optional[List[DimensionResponseIndividual]],
    result_uncapped: Optional[List[DimensionResponseIndividual]],
    result_flat_prior: Optional[List[DimensionResponseIndividual]],
    result_unstratified: Optional[List[DimensionResponseIndividual]],
    result_no_variance_reduction: Optional[List[DimensionResponseIndividual]],
) -> List[DimensionResponse]:
    # Map supplemental result lists to their attribute names
    supplemental_mappings = [
        (result_cuped_unadjusted, "cupedUnadjusted"),
        (result_uncapped, "uncapped"),
        (result_flat_prior, "flatPrior"),
        (result_unstratified, "unstratified"),
        (result_no_variance_reduction, "noVarianceReduction"),
    ]

    result = []
    for dim_i, dim_result in enumerate(core_result):
        variations: List[VariationResponse] = []
        for variation_i, variation in enumerate(dim_result.variations):
            is_bayesian = isinstance(variation, BayesianVariationResponseIndividual)
            is_frequentist = isinstance(
                variation, FrequentistVariationResponseIndividual
            )
            is_baseline = isinstance(variation, BaselineResponse)

            if not (is_frequentist or is_bayesian or is_baseline):
                continue
            # Create the variation response object
            if is_bayesian:
                variation_response = BayesianVariationResponse(
                    **asdict(variation),
                    supplementalResults=SupplementalResults(),
                )
            elif is_frequentist:
                variation_response = FrequentistVariationResponse(
                    **asdict(variation),
                    supplementalResults=SupplementalResults(),
                )
            else:
                variation_response = BaselineResponseWithSupplementalResults(
                    **asdict(variation),
                    supplementalResults=SupplementalResults(),
                )

            # Set all supplemental results
            for supplemental_result, attribute_name in supplemental_mappings:
                if (
                    supplemental_result is not None
                    and len(supplemental_result) > dim_i
                    and len(supplemental_result[dim_i].variations) > variation_i
                    and supplemental_result[dim_i].variations[variation_i] is not None
                ):
                    setattr(
                        variation_response.supplementalResults,
                        attribute_name,
                        supplemental_result[dim_i].variations[variation_i],
                    )

            variations.append(variation_response)

        result.append(
            DimensionResponse(
                dimension=dim_result.dimension,
                srm=dim_result.srm,
                variations=variations,
            )
        )

    return result


def get_var_id_map(var_ids: List[str]) -> VarIdMap:
    return {v: i for i, v in enumerate(var_ids)}


def variation_index_from_row(
    variation: Any,
    var_id_map: VarIdMap,
    num_variations: int,
) -> Optional[int]:
    """Map a query-row ``variation`` cell (id or numeric index string) to 0..n-1."""
    if variation is None:
        return None
    key = str(variation)
    if key in var_id_map:
        return var_id_map[key]
    try:
        index = int(key)
        if 0 <= index < num_variations:
            return index
    except ValueError:
        pass
    return None


def _numeric_cell_for_metric_series(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return float(value.flat[0])
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value)
    return value


def _sum_aggregate_metric_field(values: List[Any]) -> Any:
    if not values:
        return 0
    total = sum(float(np.asarray(x).flat[0]) for x in values)
    v0 = values[0]
    if isinstance(v0, np.ndarray):
        return np.array([total])
    if isinstance(v0, (bool, np.bool_)):
        return bool(round(total))
    if isinstance(v0, (int, np.integer)):
        return int(round(total))
    if isinstance(v0, (float, np.floating)):
        return float(total)
    return float(total)


def _merge_summable_experiment_metric_rows(
    rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if not rows:
        return {}
    out: Dict[str, Any] = dict(rows[0])
    for col in SUM_COLS:
        vals = [r[col] for r in rows if col in r]
        if vals:
            out[col] = _sum_aggregate_metric_field(vals)
        elif col not in out:
            out[col] = 0
    return out


def _empty_prefixed_metric_series(prefix: str) -> pd.Series:
    return pd.Series({f"{prefix}_{col}": 0 for col in ROW_COLS})


def _narrow_experiment_metric_row_to_prefixed_series(
    row: Dict[str, Any], prefix: str
) -> pd.Series:
    data: Dict[str, Any] = {f"{prefix}_{col}": 0 for col in ROW_COLS}
    for col in ROW_COLS:
        if col in row:
            data[f"{prefix}_{col}"] = _numeric_cell_for_metric_series(row[col])
    if "users" in row:
        data[f"{prefix}_users"] = _numeric_cell_for_metric_series(row["users"])
    if "count" in row:
        data[f"{prefix}_count"] = _numeric_cell_for_metric_series(row["count"])
    elif "users" in row:
        data[f"{prefix}_count"] = data[f"{prefix}_users"]
    return pd.Series(data)


def _summable_statistic_for_variation_row_group(
    metric_settings: MetricSettingsForStatsEngine,
    grp: List[Dict[str, Any]],
) -> SummableStatistic:
    """Produce one summable statistic for a list of rows that all belong to the same variation arm."""
    merged = _merge_summable_experiment_metric_rows(grp) if grp else None
    series = (
        _narrow_experiment_metric_row_to_prefixed_series(merged, "baseline")
        if merged
        else _empty_prefixed_metric_series("baseline")
    )
    raw_stat = variation_statistic_from_metric_row(series, "baseline", metric_settings)
    if not isinstance(raw_stat, SummableStatistic):
        raise TypeError(f"Expected SummableStatistic, got {type(raw_stat).__name__}")
    return raw_stat


def summable_statistics_per_variation_from_experiment_metric_rows(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    var_ids: List[str],
) -> List[SummableStatistic]:
    """One SummableStatistic per variation index (k -> var_ids[k]); quantile metrics unsupported."""
    if metric.statistic_type in ("quantile_event", "quantile_unit"):
        raise ValueError(
            "summable_statistics_per_variation_from_experiment_metric_rows "
            f"does not support statistic_type={metric.statistic_type!r}"
        )
    var_id_map = get_var_id_map(var_ids)
    num_variations = len(var_ids)
    by_idx: Dict[int, List[Dict[str, Any]]] = {}
    for row in rows:
        vid = row.get("variation")
        if vid is None:
            continue
        idx = var_id_map.get(str(vid))
        if idx is None:
            continue
        by_idx.setdefault(idx, []).append(row)

    summable_types = (
        ProportionStatistic,
        SampleMeanStatistic,
        RegressionAdjustedStatistic,
        RatioStatistic,
        RegressionAdjustedRatioStatistic,
    )
    out: List[SummableStatistic] = []
    for k in range(num_variations):
        grp = by_idx.get(k, [])
        merged = _merge_summable_experiment_metric_rows(grp)
        series = (
            _narrow_experiment_metric_row_to_prefixed_series(merged, "baseline")
            if merged
            else _empty_prefixed_metric_series("baseline")
        )
        raw_stat = variation_statistic_from_metric_row(series, "baseline", metric)
        if not isinstance(raw_stat, summable_types):
            raise TypeError(
                f"Expected SummableStatistic, got {type(raw_stat).__name__}"
            )
        out.append(raw_stat)
    return out


def process_single_metric(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    analyses: List[AnalysisSettingsForStatsEngine],
) -> ExperimentMetricAnalysis:
    # If no data return blank results
    if len(rows) == 0:
        return ExperimentMetricAnalysis(
            metric=metric.id,
            analyses=[
                ExperimentMetricAnalysisResult(
                    unknownVariations=[],
                    dimensions=[],
                    multipleExposures=0,
                )
                for _ in analyses
            ],
        )
    pdrows = pd.DataFrame(rows)

    # TODO validate data in rows matches metric settings

    # Detect any variations that are not in the returned metric rows
    all_var_ids: Set[str] = set([v for a in analyses for v in a.var_ids])
    unknown_var_ids = detect_unknown_variations(rows=pdrows, var_ids=all_var_ids)

    results: List[List[DimensionResponse]] = []
    for a in analyses:
        # skip pre-computed dimension reaggregation for quantile metrics
        attempted_quantile_dimension_reaggregation = a.dimension.startswith(
            "precomputed:"
        ) and metric.statistic_type in ["quantile_event", "quantile_unit"]
        attempted_quantile_overall_reaggregation = (
            a.dimension == ""
            and metric.statistic_type in ["quantile_event", "quantile_unit"]
            and pdrows.columns.__contains__("dim_exp")
        )
        if (
            attempted_quantile_dimension_reaggregation
            or attempted_quantile_overall_reaggregation
        ):
            continue
        results.append(
            process_analysis(
                rows=pdrows,
                var_id_map=get_var_id_map(a.var_ids),
                metric=metric,
                analysis=a,
            )
        )
    return ExperimentMetricAnalysis(
        metric=metric.id,
        analyses=[
            ExperimentMetricAnalysisResult(
                unknownVariations=list(unknown_var_ids),
                dimensions=r,
                multipleExposures=0,
            )
            for r in results
        ],
    )


def create_bandit_statistics(
    metric_data: pd.Series,
    metric: MetricSettingsForStatsEngine,
    num_variations: int,
) -> List[BanditStatistic]:
    stats = []
    for i in range(0, num_variations):
        prefix = f"v{i}" if i > 0 else "baseline"
        # TODO only one row per dimension for bandits
        stat = variation_statistic_from_metric_row(
            row=metric_data, prefix=prefix, metric=metric
        )
        # recast proportion metrics in case they slipped through
        # for bandits we weight by period; iid data over periods no longer holds
        if isinstance(stat, ProportionStatistic):
            stat = SampleMeanStatistic(
                n=stat.n,
                sum=stat.sum,
                sum_squares=stat.sum,
            )
        if isinstance(stat, QuantileStatistic):
            raise ValueError("QuantileStatistic not supported for bandits")
        stats.append(stat)
    return stats


def preprocess_bandits(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    bandit_settings: BanditSettingsForStatsEngine,
    alpha: float,
    dimension: str,
) -> Union[BanditsSimple, BanditsCuped, BanditsRatio]:
    if len(rows) == 0:
        bandit_stats = {}
    else:
        pdrows = pd.DataFrame(rows)
        pdrows = pdrows.loc[pdrows[BANDIT_DIMENSION["column"]] == dimension]
        metric_data = get_metric_dfs(
            rows=pdrows,
            var_id_map=get_var_id_map(bandit_settings.var_ids),
            var_names=bandit_settings.var_names,
            dimension=dimension,
        )
        # Bandit analyses only have one dimension and one row as period reduction is done in SQL
        bandit_stats = create_bandit_statistics(
            metric_data[0].data.iloc[0], metric, len(bandit_settings.var_names)
        )
    bandit_prior = GaussianPrior(mean=0, variance=float(1e4), proper=True)
    bandit_weights_rng = bandit_settings.bandit_weights_rng
    bandit_config = BanditConfig(
        prior_distribution=bandit_prior,
        bandit_weights_rng=bandit_weights_rng,
        weight_by_period=bandit_settings.weight_by_period,
        top_two=bandit_settings.top_two,
        alpha=alpha,
        inverse=metric.inverse,
    )
    if isinstance(bandit_stats[0], RatioStatistic):
        return BanditsRatio(bandit_stats, bandit_settings.current_weights, bandit_config)  # type: ignore
    elif isinstance(bandit_stats[0], RegressionAdjustedStatistic):
        return BanditsCuped(bandit_stats, bandit_settings.current_weights, bandit_config)  # type: ignore
    else:
        return BanditsSimple(bandit_stats, bandit_settings.current_weights, bandit_config)  # type: ignore


def get_bandit_result(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    settings: AnalysisSettingsForStatsEngine,
    bandit_settings: BanditSettingsForStatsEngine,
) -> BanditResult:
    single_variation_results = None
    # "All" is a special dimension that gbstats can handle if there is no dimension
    # column specified
    b = preprocess_bandits(
        rows, metric, bandit_settings, settings.alpha, BANDIT_DIMENSION["value"]
    )
    if b:
        if any(value is None for value in b.stats):
            return get_error_bandit_result(
                single_variation_results=None,
                update_message="not updated",
                error="not all statistics are instance of type BanditStatistic",
                reweight=bandit_settings.reweight,
                current_weights=bandit_settings.current_weights,
            )
        bandit_result = b.compute_result()
        if bandit_result.ci:
            single_variation_results = [
                SingleVariationResult(
                    users=n,
                    cr=mn,
                    variationVariances=v,
                    ci=ci,
                )
                for n, mn, v, ci in zip(
                    b.variation_counts,
                    bandit_result.cr or [],
                    bandit_result.variance or [],
                    bandit_result.ci,
                )
            ]
            if not bandit_result.enough_units:
                return get_error_bandit_result(
                    single_variation_results=single_variation_results,
                    update_message=bandit_result.bandit_update_message,
                    error="",
                    reweight=bandit_settings.reweight,
                    current_weights=bandit_settings.current_weights,
                )
            if (
                bandit_result.bandit_update_message == "successfully updated"
                and bandit_result.bandit_weights
            ):
                weights_were_updated = (
                    bandit_settings.current_weights != bandit_result.bandit_weights
                    and bandit_settings.reweight
                )
                return BanditResult(
                    singleVariationResults=single_variation_results,
                    currentWeights=bandit_settings.current_weights,
                    updatedWeights=(
                        bandit_result.bandit_weights
                        if bandit_settings.reweight
                        else bandit_settings.current_weights
                    ),
                    bestArmProbabilities=bandit_result.best_arm_probabilities,
                    seed=0,
                    updateMessage=bandit_result.bandit_update_message,
                    error="",
                    reweight=bandit_settings.reweight,
                    weightsWereUpdated=weights_were_updated,
                )
        else:
            error_message = (
                bandit_result.bandit_update_message
                if bandit_result.bandit_update_message
                else "unknown error in get_bandit_result"
            )
            return get_error_bandit_result(
                single_variation_results=None,
                update_message="not updated",
                error=error_message,
                reweight=bandit_settings.reweight,
                current_weights=bandit_settings.current_weights,
            )
    return get_error_bandit_result(
        single_variation_results=None,
        update_message="not updated",
        error="no data froms sql query matches dimension",
        reweight=bandit_settings.reweight,
        current_weights=bandit_settings.current_weights,
    )


class ContextualBanditWeightsLookup:
    """Match ``ContextualBanditResponse.context`` conditions to observed attributes and return ``updatedWeights``."""

    @staticmethod
    def observed_from_tuple(
        attributes: Sequence[str], context_tuple: tuple[str, ...]
    ) -> dict[str, str]:
        """Zip SQL-style context tuple with attribute names (same order as bandit ``attributes``)."""
        if len(attributes) != len(context_tuple):
            raise ValueError(
                f"attributes length {len(attributes)} != context tuple length {len(context_tuple)}"
            )
        return {str(a): str(v) for a, v in zip(attributes, context_tuple)}

    @staticmethod
    def _singleton_condition_value(spec: Any) -> Optional[str]:
        """Extract a single allowed value from a ``$in`` clause or scalar condition."""
        if isinstance(spec, dict) and "$in" in spec:
            allowed = spec["$in"]
            if isinstance(allowed, (list, tuple)) and len(allowed) == 1:
                return str(allowed[0])
            return None
        if isinstance(spec, dict):
            return None
        return str(spec)

    @staticmethod
    def index_responses_by_attribute_singleton(
        responses: Sequence[ContextualBanditResponse],
        attribute: str,
    ) -> dict[str, ContextualBanditResponse]:
        """Map one response per distinct single-value condition on ``attribute`` (e.g. ``leaf_id``)."""
        out: dict[str, ContextualBanditResponse] = {}
        for r in responses:
            if attribute not in r.context:
                continue
            value = ContextualBanditWeightsLookup._singleton_condition_value(
                r.context[attribute]
            )
            if value is not None:
                out[value] = r
        return out


class UpdateWeightsContextualBandit:
    """Updates variation weights per context; call compute_result() for per-context BanditResults."""

    def __init__(
        self,
        rows: ExperimentMetricQueryResponseRows,
        metric_settings: MetricSettingsForStatsEngine,
        analysis_settings: AnalysisSettingsForStatsEngine,
        contextual_bandit_settings: ContextualBanditSettingsForStatsEngine,
    ):
        self.rows = rows
        self.metric_settings = metric_settings
        self.analysis_settings = analysis_settings
        self.contextual_bandit_settings = contextual_bandit_settings

    @property
    def num_variations(self) -> int:
        return len(self.contextual_bandit_settings.var_ids)

    @staticmethod
    def default_contextual_weights(num_variations: int) -> list[float]:
        if num_variations < 1:
            raise ValueError("need positive number of variations in contextual bandit")
        return [1.0 / num_variations] * num_variations

    @staticmethod
    def no_update_response(
        context: Context, num_variations: int, update_message: str
    ) -> ContextualBanditResponse:
        default_weights = UpdateWeightsContextualBandit.default_contextual_weights(
            num_variations
        )
        return ContextualBanditResponse(
            context=context,
            sampleSizePerVariation=None,
            variationMeans=None,
            variationVariances=None,
            updatedWeights=default_weights,
            bestArmProbabilities=None,
            updateMessage=update_message,
            error=None,
        )

    @staticmethod
    def no_update_result(
        attributes: list[str], num_variations: int, update_message: str
    ) -> ContextualBanditNoTreeResult:
        return ContextualBanditNoTreeResult(
            attributes=attributes,
            responses=[
                UpdateWeightsContextualBandit.no_update_response(
                    context={},
                    num_variations=num_variations,
                    update_message=update_message,
                )
            ],
        )

    @staticmethod
    def _rows_for_bandit(
        rows: ExperimentMetricQueryResponseRows,
        dimension_value: str = CONTEXTUAL_BANDIT_DIMENSION_VALUE,
    ) -> ExperimentMetricQueryResponseRows:
        """Copy rows and set dimension column to value so get_bandit_result's filter passes."""
        out = []
        for r in rows:
            row = copy.copy(r)
            row[CONTEXTUAL_BANDIT_DIMENSION_COLUMN] = dimension_value
            out.append(row)
        return out

    @staticmethod
    def create_contexts(
        rows: ExperimentMetricQueryResponseRows, context_columns: list[str]
    ) -> list[tuple[str, ...]]:
        """Unique context tuples from rows, one value per dimension column in context_columns."""
        return sorted(set(context_tuple_from_row(row, context_columns) for row in rows))

    @staticmethod
    def create_rows_by_context(
        rows: ExperimentMetricQueryResponseRows,
        context_columns: list[str],
        unique_contexts: list[tuple[str, ...]],
    ) -> dict[tuple[str, ...], ExperimentMetricQueryResponseRows]:
        return {
            ctx: [r for r in rows if context_tuple_from_row(r, context_columns) == ctx]
            for ctx in unique_contexts
        }

    def compute_result(self) -> ContextualBanditNoTreeResult:
        """Run a bandit per context and return per-context BanditResult."""
        num_variations = len(self.contextual_bandit_settings.var_ids)
        default_weights = (
            list(self.analysis_settings.weights)
            if getattr(self.analysis_settings, "weights", None)
            else [1.0 / num_variations] * num_variations
        )

        if not self.rows:
            update_message = "no rows"
            return self.no_update_result([], num_variations, update_message)

        elif not self.contextual_bandit_settings.attributes:
            update_message = "no context columns configured"
            return self.no_update_result([], num_variations, update_message)

        else:
            contexts = self.create_contexts(
                self.rows, self.contextual_bandit_settings.attributes
            )
            rows_by_ctx = self.create_rows_by_context(
                self.rows, self.contextual_bandit_settings.attributes, contexts
            )
            responses = []
            for ctx in contexts:
                # TODO: get current weights from contextual bandit settings
                current_weights = default_weights.copy()
                rows_for_bandit = self._rows_for_bandit(
                    rows_by_ctx[ctx], CONTEXTUAL_BANDIT_DIMENSION_VALUE
                )
                bandit_settings = BanditSettingsForStatsEngine(
                    var_names=self.contextual_bandit_settings.var_names,
                    var_ids=self.contextual_bandit_settings.var_ids,
                    current_weights=current_weights,
                    reweight=self.contextual_bandit_settings.reweight,
                    decision_metric=self.contextual_bandit_settings.decision_metric,
                    bandit_weights_rng=self.contextual_bandit_settings.bandit_weights_rng,
                    weight_by_period=self.contextual_bandit_settings.weight_by_period,
                    top_two=self.contextual_bandit_settings.top_two,
                )
                r = get_bandit_result(
                    rows=rows_for_bandit,
                    metric=self.metric_settings,
                    settings=self.analysis_settings,
                    bandit_settings=bandit_settings,
                )
                sample_size_per_variation = (
                    [float(v.users or 0) for v in r.singleVariationResults]
                    if r.singleVariationResults
                    else None
                )
                variation_means = (
                    [float(v.cr or 0) for v in r.singleVariationResults]
                    if r.singleVariationResults
                    else None
                )
                variation_variances = (
                    [float(v.variationVariances or 0) for v in r.singleVariationResults]
                    if r.singleVariationResults
                    else None
                )
                context_rule = {
                    attr: {"$in": [ctx[i]]}
                    for i, attr in enumerate(self.contextual_bandit_settings.attributes)
                }
                contextual_result = ContextualBanditResponse(
                    context=context_rule,
                    sampleSizePerVariation=sample_size_per_variation,
                    variationMeans=variation_means,
                    variationVariances=variation_variances,
                    updatedWeights=r.updatedWeights,
                    bestArmProbabilities=r.bestArmProbabilities,
                    updateMessage=r.updateMessage,
                    error=r.error,
                )
                responses.append(contextual_result)

            return ContextualBanditNoTreeResult(
                attributes=self.contextual_bandit_settings.attributes,
                responses=responses,
            )


LEAF_ID_COLUMN = "leaf_id"

ContextKey = Union[str, Tuple[str, ...]]

COMBINED_CONTEXT_ATTRIBUTE_VALUE = "Combined"


def context_tuple_from_row(
    row: Dict[str, Any],
    context_columns: list[str],
) -> tuple[str, ...]:
    """Read context tuple from a metric row; missing attrs bucket to Combined."""
    return tuple(
        str(row.get(col, COMBINED_CONTEXT_ATTRIBUTE_VALUE)) for col in context_columns
    )


@dataclass(frozen=True)
class RowsByContextWithData:
    """Partition of metric rows keyed by context tuple, with sorted ``unique_keys``."""

    rows_with_data: dict[tuple[str, ...], ExperimentMetricQueryResponseRows]
    unique_keys: list[tuple[str, ...]]

    @classmethod
    def from_rows_by_context(
        cls,
        rows_by_context: dict[tuple[str, ...], ExperimentMetricQueryResponseRows],
    ) -> "RowsByContextWithData":
        """Drop empty context buckets and return a partition with sorted ``unique_keys``."""
        rows_with_data = {ctx: r for ctx, r in rows_by_context.items() if r}
        unique_keys = sorted(rows_with_data.keys())
        return cls(rows_with_data=rows_with_data, unique_keys=unique_keys)

    @classmethod
    def from_experiment_rows(
        cls,
        rows: ExperimentMetricQueryResponseRows,
        bandit_settings: ContextualBanditSettingsForStatsEngine,
    ) -> "RowsByContextWithData":
        """Partition ``rows`` by ``bandit_settings.attributes``."""
        if not rows:
            return cls(rows_with_data={}, unique_keys=[])
        context_columns = bandit_settings.attributes
        rows_by_context: dict[tuple[str, ...], ExperimentMetricQueryResponseRows] = {}
        for row in rows:
            ctx = context_tuple_from_row(row, context_columns)
            rows_by_context.setdefault(ctx, []).append(row)
        return cls.from_rows_by_context(rows_by_context)


def no_update_result(weights: list, update_message: str | None = None) -> BanditResult:
    """Build a BanditResult that leaves weights unchanged (no update)."""
    w = weights.copy()
    return BanditResult(
        singleVariationResults=None,
        currentWeights=w,
        updatedWeights=w,
        bestArmProbabilities=w,
        seed=0,
        updateMessage=update_message,
        error=None,
        reweight=False,
        weightsWereUpdated=False,
    )


def bandit_result_to_contextual_response(
    context: Context, r: BanditResult
) -> ContextualBanditResponse:
    sample_size_per_variation = (
        [float(v.users or 0) for v in r.singleVariationResults]
        if r.singleVariationResults
        else None
    )
    variation_means = (
        [float(v.cr or 0) for v in r.singleVariationResults]
        if r.singleVariationResults
        else None
    )
    variation_variances = (
        [float(v.variationVariances or 0) for v in r.singleVariationResults]
        if r.singleVariationResults
        else None
    )
    return ContextualBanditResponse(
        context=context,
        sampleSizePerVariation=sample_size_per_variation,
        variationMeans=variation_means,
        variationVariances=variation_variances,
        updatedWeights=r.updatedWeights,
        bestArmProbabilities=r.bestArmProbabilities,
        updateMessage=r.updateMessage,
        error=r.error,
    )


def context_rule_for_context_key(ctx: ContextKey, attributes: List[str]) -> Context:
    """Build a targeting ``context`` dict from a partition key (tuple or scalar)."""
    if isinstance(ctx, tuple):
        return {attr: {"$in": [ctx[i]]} for i, attr in enumerate(attributes)}
    return {attributes[0]: {"$in": [str(ctx)]}}


def contextual_response_for_context_key(
    ctx: ContextKey,
    attributes: List[str],
    source: ContextualBanditResponse,
) -> ContextualBanditResponse:
    """Copy leaf-level snapshot fields onto the real per-context condition."""
    context_rule = context_rule_for_context_key(ctx, attributes)
    return ContextualBanditResponse(
        context=context_rule,
        sampleSizePerVariation=source.sampleSizePerVariation,
        variationMeans=source.variationMeans,
        variationVariances=source.variationVariances,
        updatedWeights=source.updatedWeights,
        bestArmProbabilities=source.bestArmProbabilities,
        updateMessage=source.updateMessage,
        error=source.error,
    )


class UpdateWeightsContextualTree:
    """Fits a tree over contexts and updates variation weights per leaf via UpdateWeightsContextualBandit."""

    def __init__(
        self,
        rows: ExperimentMetricQueryResponseRows,
        metric_settings: MetricSettingsForStatsEngine,
        analysis_settings: AnalysisSettingsForStatsEngine,
        bandit_settings: ContextualBanditSettingsForStatsEngine,
    ):
        self.rows = rows
        self.metric_settings = metric_settings
        self.analysis_settings = analysis_settings
        self.bandit_settings = bandit_settings
        self.var_id_map = get_var_id_map(list(self.bandit_settings.var_ids))
        self.partition = RowsByContextWithData.from_experiment_rows(
            rows,
            bandit_settings,
        )
        self.max_leaves = getattr(bandit_settings, "max_leaves")
        self.num_variations = len(bandit_settings.var_ids)
        self.constant_weights = list[float](
            [1.0 / self.num_variations] * self.num_variations
        )
        self.rng = bandit_settings.bandit_weights_rng
        self.leaf_ids = []
        self.leaf_map = {}
        self.merge_combined_rows = lambda a, b: (a or []) + (b or [])

    @staticmethod
    def summable_statistics_per_variation_from_experiment_metric_rows(
        partition: RowsByContextWithData,
        metric_settings: MetricSettingsForStatsEngine,
        bandit_settings: ContextualBanditSettingsForStatsEngine,
        var_id_map: VarIdMap,
    ) -> pd.DataFrame:
        """Build a DataFrame with context columns plus one merged summable statistic per ``var_id`` per context."""
        var_ids = list(var_id_map.keys())
        num_variations = len(var_ids)
        context_columns = bandit_settings.attributes
        out_columns = list(context_columns) + list(var_ids)

        records: List[Dict[str, Any]] = []
        for ctx in partition.unique_keys:
            rows_ctx = partition.rows_with_data[ctx]
            record: Dict[str, Any] = {
                context_columns[i]: ctx[i] for i in range(len(context_columns))
            }
            for variation_index in range(num_variations):
                grp = [
                    r
                    for r in rows_ctx
                    if variation_index_from_row(
                        r.get("variation"), var_id_map, num_variations
                    )
                    == variation_index
                ]
                record[var_ids[variation_index]] = (
                    _summable_statistic_for_variation_row_group(metric_settings, grp)
                )
            records.append(record)
        return pd.DataFrame.from_records(records, columns=out_columns)

    @staticmethod
    def contextual_bandit_settings_for_tree(
        tree_settings: ContextualBanditSettingsForStatsEngine,
    ) -> ContextualBanditSettingsForStatsEngine:
        """Build a leaf-keyed bandit settings from tree settings; omits ``max_leaves``."""
        bandit_fields = {
            k: v
            for k, v in asdict(tree_settings).items()
            if k in ContextualBanditSettingsForStatsEngine.__dataclass_fields__
        }
        bandit_fields["attributes"] = ["leaf_id"]
        return ContextualBanditSettingsForStatsEngine(**bandit_fields)

    @property
    def contexts_by_leaf(self) -> dict:
        """Leaf id -> list of contexts in that leaf."""
        out: dict = {}
        for ctx, leaf_id in self.leaf_map.items():
            out.setdefault(leaf_id, []).append(ctx)
        return out

    def set_leaf_structure(self, leaf_map: dict):
        self.leaf_map = leaf_map
        self.leaf_ids = sorted(set(leaf_map.values()))

    def rows_to_rows_by_context(
        self, rows: ExperimentMetricQueryResponseRows
    ) -> dict[tuple, ExperimentMetricQueryResponseRows]:
        """Partition flat rows into dict keyed by context tuple (per bandit_settings.attributes)."""
        if not rows:
            return {}
        out: dict[tuple, ExperimentMetricQueryResponseRows] = {}
        for row in rows:
            ctx = tuple(
                str(row.get(attribute, CONTEXTUAL_BANDIT_DIMENSION_VALUE))
                for attribute in self.bandit_settings.attributes
            )
            out.setdefault(ctx, []).append(row)
        return out

    @staticmethod
    def aggregate_variation_columns(
        df: pd.DataFrame, variation_columns: List[str]
    ) -> Dict[str, SummableStatistic]:
        """Pool each named variation column in ``df`` into summed statistics and variance values."""
        if df.empty:
            return {}
        summed: Dict[str, SummableStatistic] = {}
        for col in variation_columns:
            if col not in df.columns:
                raise KeyError(f"variation column {col!r} not in dataframe")
            stat = df[col].sum()
            summed[col] = stat
        return summed

    @staticmethod
    def ordered_variation_statistics(
        summed: Dict[str, SummableStatistic], variation_columns: List[str]
    ) -> list[SummableStatistic]:
        return list(summed[col] for col in variation_columns)

    @staticmethod
    def calculate_sse(d: Dict[str, SummableStatistic]) -> np.ndarray:
        """Calculate the sum of squared errors for a dictionary of summable statistics."""
        return np.array([(stat.n - 1) * stat.variance for stat in d.values()])

    @staticmethod
    def identify_update(
        stats_encoded: pd.DataFrame,
        one_hot_encoded_feature_names: List[str],
        variation_columns: List[str],
        analysis_settings: AnalysisSettingsForStatsEngine,
        metric_settings: MetricSettingsForStatsEngine,
        rng: np.random.Generator,
    ) -> tuple[int, int, float]:
        """Pick the (feature, leaf) split that most reduces SSE under the current tree."""
        num_features = len(one_hot_encoded_feature_names)
        num_variations = len(variation_columns)
        num_leaves_current = len(np.unique(stats_encoded["current_leaf"]))
        sse_current = np.zeros((num_leaves_current, num_variations))
        sse_split = np.zeros((num_features, num_leaves_current, num_variations))

        for leaf_index in range(num_leaves_current):
            this_leaf = stats_encoded[stats_encoded["current_leaf"] == leaf_index]
            aggregated = UpdateWeightsContextualTree.aggregate_variation_columns(
                this_leaf, variation_columns
            )
            sse_current[leaf_index, :] = [
                (stat.n - 1) * stat.variance for stat in aggregated.values()
            ]
            for feature_index in range(num_features):
                stats_df_0 = this_leaf[
                    this_leaf[one_hot_encoded_feature_names[feature_index]] == 0
                ]
                stats_df_1 = this_leaf[
                    this_leaf[one_hot_encoded_feature_names[feature_index]] == 1
                ]
                if len(stats_df_0) == 0 or len(stats_df_1) == 0:
                    sse_split[feature_index, leaf_index, :] = sse_current[leaf_index, :]
                else:
                    b_0 = UpdateWeightsContextualTree.aggregate_variation_columns(
                        stats_df_0, variation_columns
                    )
                    b_1 = UpdateWeightsContextualTree.aggregate_variation_columns(
                        stats_df_1, variation_columns
                    )
                    sse_0 = np.array(
                        [(stat.n - 1) * stat.variance for stat in b_0.values()]
                    )
                    sse_1 = np.array(
                        [(stat.n - 1) * stat.variance for stat in b_1.values()]
                    )
                    sse_split[feature_index, leaf_index, :] = sse_0 + sse_1

        sse_current_across_variations = np.sum(sse_current, axis=1)
        sse_split_across_variations = np.sum(sse_split, axis=2)
        diff = (
            np.tile(sse_current_across_variations, (num_features, 1))
            - sse_split_across_variations
        )
        idx = np.argmax(diff)
        pos = np.unravel_index(idx, diff.shape)
        sse_current_sum = np.sum(sse_current_across_variations)
        return (int(pos[0]), int(pos[1]), sse_current_sum)

    @staticmethod
    def create_stats_df(
        partition: RowsByContextWithData,
        metric_settings: MetricSettingsForStatsEngine,
        bandit_settings: ContextualBanditSettingsForStatsEngine,
    ) -> pd.DataFrame:
        """Build a DataFrame with context columns plus one merged summable statistic per ``var_id`` per context."""
        stats_df = UpdateWeightsContextualTree.summable_statistics_per_variation_from_experiment_metric_rows(
            partition,
            metric_settings,
            bandit_settings,
            get_var_id_map(list(bandit_settings.var_ids)),
        )
        stats_df["key"] = list(
            zip(*(stats_df[c].astype(str) for c in bandit_settings.attributes))
        )
        return stats_df

    @staticmethod
    def one_hot_encode(
        df: pd.DataFrame,
        columns: List[str],
        prefix: Optional[List[str]] = None,
        dtype: type = float,
    ) -> pd.DataFrame:
        """Subset of ``pd.get_dummies``: replace ``columns`` with sorted indicator columns ``{prefix}_{cat}``."""
        prefixes = prefix if prefix is not None else columns
        if len(prefixes) != len(columns):
            raise ValueError("prefix must have the same length as columns")

        encode_set = set(columns)
        # Non-encoded columns keep their original order and dtype (pandas places
        # them ahead of the generated indicator columns).
        parts: List[pd.DataFrame] = [df[[c for c in df.columns if c not in encode_set]]]

        for col, pre in zip(columns, prefixes):
            series = df[col]
            categories = sorted(c for c in series.unique() if pd.notna(c))
            parts.append(
                pd.DataFrame(
                    {
                        f"{pre}_{category}": (series == category).astype(dtype)
                        for category in categories
                    },
                    index=df.index,
                )
            )

        # Join all blocks at once to avoid the DataFrame fragmentation that
        # repeated single-column inserts cause (matches pandas' internal concat).
        return pd.concat(parts, axis=1)

    @staticmethod
    def create_stats_encoded(
        stats_df: pd.DataFrame,
        bandit_settings: ContextualBanditSettingsForStatsEngine,
    ) -> pd.DataFrame:
        """One-hot encode contextual attribute columns, keeping variation statistic columns as-is."""
        stats_encoded = UpdateWeightsContextualTree.one_hot_encode(
            stats_df,
            columns=bandit_settings.attributes,
            prefix=bandit_settings.attributes,
            dtype=float,
        )
        return stats_encoded

    @staticmethod
    def calculate_sse_final(
        stats_encoded: pd.DataFrame, variation_columns: List[str]
    ) -> float:
        """Calculate the final SSE for the tree."""
        sse_final = 0
        for leaf_id in np.unique(stats_encoded["current_leaf"]):
            this_leaf = stats_encoded[stats_encoded["current_leaf"] == leaf_id]
            aggregated = UpdateWeightsContextualTree.aggregate_variation_columns(
                this_leaf, variation_columns
            )
            sse_final += sum(
                [(stat.n - 1) * stat.variance for stat in aggregated.values()]
            )
        return sse_final

    def _build_by_leaf_cumulative(self, rows_by_context: dict) -> dict:
        """Merge per-context rows into per-leaf rows using ``leaf_map``."""
        by_leaf_cumulative = {}
        for leaf_id in self.leaf_ids:
            rows_leaf = None
            for ctx in self.partition.unique_keys:
                if self.leaf_map.get(ctx) == leaf_id and rows_by_context.get(ctx):
                    if rows_leaf is None:
                        rows_leaf = copy.deepcopy(rows_by_context[ctx])
                    else:
                        rows_leaf = self.merge_combined_rows(
                            rows_leaf, rows_by_context[ctx]
                        )
            if rows_leaf is not None:
                by_leaf_cumulative[leaf_id] = rows_leaf
        return by_leaf_cumulative

    def _aggregate_leaf_rows_for_bandit(
        self, rows: ExperimentMetricQueryResponseRows, leaf_id: int
    ) -> ExperimentMetricQueryResponseRows:
        """Merge all rows in a leaf into one row per variation; sets LEAF_ID_COLUMN."""
        if not rows:
            return []
        sum_cols_active = [c for c in SUM_COLS if any(c in r for r in rows)]
        by_var: dict[int, list[dict[str, Any]]] = {}
        for r in rows:
            v = variation_index_from_row(
                r.get("variation"), self.var_id_map, self.num_variations
            )
            if v is None:
                raise ValueError(
                    f"Unknown variation {r.get('variation')!r}; expected one of "
                    f"{list(self.bandit_settings.var_ids)} or index "
                    f"0..{self.num_variations - 1}"
                )
            by_var.setdefault(v, []).append(r)
        var_ids_canon = [str(v) for v in list(self.bandit_settings.var_ids)]
        out: ExperimentMetricQueryResponseRows = []
        for v in range(self.num_variations):
            grp = by_var.get(v, [])
            row: dict[str, Any] = {
                LEAF_ID_COLUMN: leaf_id,
                "dimension": CONTEXTUAL_BANDIT_DIMENSION_VALUE,
                "variation": var_ids_canon[v],
            }
            for col in sum_cols_active:
                if not grp:
                    row[col] = 0
                    continue
                vals = [r[col] for r in grp if col in r]
                row[col] = sum(vals)
            out.append(row)
        return out

    def build_tree(self):
        """Build context leaves by iterative ``identify_update`` splits on one-hot encoded attributes."""
        self.stats_df = self.create_stats_df(
            self.partition,
            self.metric_settings,
            self.bandit_settings,
        )
        self.stats_encoded = self.create_stats_encoded(
            self.stats_df, self.bandit_settings
        )

        self.stats_encoded["leaf_0"] = 0
        self.stats_encoded["current_leaf"] = copy.deepcopy(
            self.stats_encoded["leaf_0"].astype(int)
        )

        one_hot_encoded_feature_names = [
            c for c in self.stats_encoded.columns if c not in self.stats_df.columns
        ]
        variation_columns = [str(v) for v in list(self.bandit_settings.var_ids)]
        sse_current_sums = np.zeros(self.max_leaves)

        for current_leaf in range(0, self.max_leaves - 1):
            feature_to_update, leaf_to_update, sse_current_sum = self.identify_update(
                self.stats_encoded,
                one_hot_encoded_feature_names,
                variation_columns,
                self.analysis_settings,
                self.metric_settings,
                self.rng,
            )
            sse_current_sums[current_leaf] = sse_current_sum
            new_leaf = current_leaf + 1
            matches_update_leaf = self.stats_encoded["current_leaf"] == int(
                leaf_to_update
            )
            matches_update_features = (
                self.stats_encoded[
                    one_hot_encoded_feature_names[int(feature_to_update)]
                ]
                == 1.0
            )
            mask = matches_update_leaf & matches_update_features
            self.stats_encoded.loc[mask, "current_leaf"] = int(new_leaf)  # type: ignore
            # Snapshot column (must use df[col] = …, not df.loc[col] — loc[col] is row indexing).
            update_column = "leaf_" + str(new_leaf)
            self.stats_encoded[update_column] = self.stats_encoded[
                "current_leaf"
            ].copy()

        self.leaf_map = dict(
            zip(
                self.stats_encoded["key"],
                self.stats_encoded["current_leaf"].astype(int),
            )
        )
        self.set_leaf_structure(self.leaf_map)
        self.sse_final = self.calculate_sse_final(self.stats_encoded, variation_columns)

    def compute_result(self) -> ContextualBanditResult:
        """Fit tree, run one leaf-keyed bandit, then map leaf results back onto each real context."""
        self.build_tree()
        if not self.leaf_ids:
            no_leaf_responses: List[ContextualBanditContextSummary] = []
            for ctx in self.partition.unique_keys:
                context_rule = context_rule_for_context_key(
                    ctx, self.bandit_settings.attributes
                )
                no_leaf_responses.append(
                    ContextualBanditContextSummary(
                        context=context_rule,
                        sampleSizePerVariation=None,
                        sampleMeans=None,
                        sampleVariances=None,
                        bestArmProbabilities=None,
                        error=None,
                        updatedWeights=list(self.constant_weights),
                        updateMessage="No update",
                    )
                )
            return ContextualBanditResult(
                attributes=self.bandit_settings.attributes,
                responses=[],
                responsesContext=no_leaf_responses,
                leafMap=copy.copy(self.leaf_map),
            )
        by_leaf_cumulative = self._build_by_leaf_cumulative(
            self.partition.rows_with_data
        )

        rows_all: ExperimentMetricQueryResponseRows = []

        for leaf_id in self.leaf_ids:
            rows_leaf = by_leaf_cumulative.get(leaf_id) or []
            if not rows_leaf:
                raise ValueError(f"No rows for leaf {leaf_id}")
            rows_all.extend(
                self._aggregate_leaf_rows_for_bandit(rows_leaf, leaf_id=leaf_id)
            )

        leaf_bandit_settings = self.contextual_bandit_settings_for_tree(
            self.bandit_settings
        )

        leaf_bandit = UpdateWeightsContextualBandit(
            rows_all,
            self.metric_settings,
            self.analysis_settings,
            leaf_bandit_settings,
        )
        leaf_response = leaf_bandit.compute_result()
        leaf_responses_by_id = (
            ContextualBanditWeightsLookup.index_responses_by_attribute_singleton(
                leaf_response.responses, LEAF_ID_COLUMN
            )
        )

        responses_leaf: List[ContextualBanditResponse] = []
        for leaf_id in self.leaf_ids:
            leaf_snapshot = leaf_responses_by_id.get(str(leaf_id))
            if leaf_snapshot is not None:
                responses_leaf.append(leaf_snapshot)
            else:
                responses_leaf.append(
                    bandit_result_to_contextual_response(
                        {LEAF_ID_COLUMN: {"$in": [str(leaf_id)]}},
                        no_update_result(list(self.constant_weights)),
                    )
                )

        # Per-context responses for deep diving.
        responses_context: List[ContextualBanditContextSummary] = []
        var_ids = list(self.bandit_settings.var_ids)
        for ctx in self.partition.unique_keys:
            context_rule = context_rule_for_context_key(
                ctx, self.bandit_settings.attributes
            )

            ctx_stats = summable_statistics_per_variation_from_experiment_metric_rows(
                self.partition.rows_with_data.get(ctx) or [],
                self.metric_settings,
                var_ids,
            )
            sample_size_per_variation = [float(s.n) for s in ctx_stats]
            sample_means = [float(s.unadjusted_mean) for s in ctx_stats]
            sample_variances = [float(s.unadjusted_variance) for s in ctx_stats]

            # Reuse the per-leaf weights for every context that maps to that leaf.
            leaf_id = self.leaf_map.get(ctx)
            leaf_snapshot = (
                leaf_responses_by_id.get(str(leaf_id)) if leaf_id is not None else None
            )
            if leaf_snapshot is not None:
                updated_weights = leaf_snapshot.updatedWeights
                best_arm_probabilities = leaf_snapshot.bestArmProbabilities
                update_message = leaf_snapshot.updateMessage
                error = leaf_snapshot.error
            else:
                updated_weights = list(self.constant_weights)
                best_arm_probabilities = None
                update_message = "No update"
                error = None

            responses_context.append(
                ContextualBanditContextSummary(
                    context=context_rule,
                    sampleSizePerVariation=sample_size_per_variation,
                    sampleMeans=sample_means,
                    sampleVariances=sample_variances,
                    updatedWeights=updated_weights,
                    bestArmProbabilities=best_arm_probabilities,
                    updateMessage=update_message,
                    error=error,
                )
            )

        return ContextualBanditResult(
            attributes=self.bandit_settings.attributes,
            responses=responses_leaf,
            responsesContext=responses_context,
            leafMap=copy.copy(self.leaf_map),
        )


# Get just the columns for a single metric
def filter_query_rows(
    query_rows: ExperimentMetricQueryResponseRows, metric_index: int
) -> ExperimentMetricQueryResponseRows:
    prefix = f"m{metric_index}_"
    return [
        {
            k.replace(prefix, ""): v
            for (k, v) in r.items()
            if k.startswith(prefix) or not re.match(r"^m\d+_", k)
        }
        for r in query_rows
    ]


def process_data_dict(data: Dict[str, Any]) -> DataForStatsEngine:
    return DataForStatsEngine(
        metrics={
            k: MetricSettingsForStatsEngine(**v) for k, v in data["metrics"].items()
        },
        analyses=[AnalysisSettingsForStatsEngine(**a) for a in data["analyses"]],
        query_results=[QueryResultsForStatsEngine(**q) for q in data["query_results"]],
        bandit_settings=get_bandit_settings(data),
        contextual_bandit_settings=get_contextual_bandit_settings(data),
    )


def get_contextual_bandit_result(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    settings: AnalysisSettingsForStatsEngine,
    contextual_bandit_settings: ContextualBanditSettingsForStatsEngine,
) -> ContextualBanditResult:
    result = UpdateWeightsContextualTree(
        rows=rows,
        metric_settings=metric,
        analysis_settings=settings,
        bandit_settings=contextual_bandit_settings,
    ).compute_result()
    # Tuple-keyed leafMap -> JSON-serializable entries before leaving the stats engine.
    result.leafMap = (
        serialize_leaf_map_for_json(result.leafMap, list(result.attributes))
        if result.leafMap
        else []
    )
    return result


def serialize_leaf_map_for_json(
    leaf_map: dict,
    attributes: List[str],
) -> List[ContextualLeafMapEntry]:
    """Convert internal tuple-keyed leaf_map to JSON-serializable entries."""
    entries: List[ContextualLeafMapEntry] = []
    for ctx, leaf_id in leaf_map.items():
        if isinstance(ctx, tuple):
            context = ContextualBanditWeightsLookup.observed_from_tuple(attributes, ctx)
        elif isinstance(ctx, str):
            context = {attributes[0]: ctx} if attributes else {}
        else:
            continue
        entries.append(ContextualLeafMapEntry(context=context, leafId=int(leaf_id)))
    return entries


def process_experiment_results(data: Dict[str, Any]) -> Tuple[
    List[ExperimentMetricAnalysis],
    Optional[BanditResult],
    Optional[ContextualBanditResult],
]:
    d = process_data_dict(data)
    results: List[ExperimentMetricAnalysis] = []
    bandit_result: Optional[BanditResult] = None
    contextual_bandit_result: Optional[ContextualBanditResult] = None
    for query_result in d.query_results:
        for i, metric in enumerate(query_result.metrics):
            if metric in d.metrics:
                this_metric = d.metrics[metric]
                rows = filter_query_rows(query_result.rows, i)
                if len(rows):
                    if d.contextual_bandit_settings:
                        contextual_bandit_result = get_contextual_bandit_result(
                            rows=rows,
                            metric=this_metric,
                            settings=d.analyses[0],
                            contextual_bandit_settings=d.contextual_bandit_settings,
                        )
                        continue
                    if d.bandit_settings:
                        metric_settings_bandit = copy.deepcopy(this_metric)
                        # when using multi-period data, binomial is no longer iid and variance is wrong
                        if metric_settings_bandit.main_metric_type == "binomial":
                            metric_settings_bandit.main_metric_type = "count"
                        if metric_settings_bandit.covariate_metric_type == "binomial":
                            metric_settings_bandit.covariate_metric_type = "count"
                        # TODO: after we have added the functionality for ratio_ra, remove this
                        if metric_settings_bandit.statistic_type == "ratio_ra":
                            metric_settings_bandit.statistic_type = "ratio"
                        if (
                            metric == d.bandit_settings.decision_metric
                            and not d.analyses[0].dimension
                        ):
                            if bandit_result is not None:
                                raise ValueError("Bandit weights already computed")
                            bandit_result = get_bandit_result(
                                rows=rows,
                                metric=metric_settings_bandit,
                                settings=d.analyses[0],
                                bandit_settings=d.bandit_settings,
                            )
                        results.append(
                            process_single_metric(
                                rows=rows,
                                metric=metric_settings_bandit,
                                analyses=d.analyses,
                            )
                        )
                    else:
                        results.append(
                            process_single_metric(
                                rows=rows,
                                metric=this_metric,
                                analyses=d.analyses,
                            )
                        )

    if d.bandit_settings and bandit_result is None:
        bandit_result = get_error_bandit_result(
            single_variation_results=None,
            update_message="not updated",
            error="no rows",
            reweight=d.bandit_settings.reweight,
            current_weights=d.bandit_settings.current_weights,
        )
    return results, bandit_result, contextual_bandit_result


def process_multiple_experiment_results(
    data: List[Dict[str, Any]]
) -> List[MultipleExperimentMetricAnalysis]:
    results: List[MultipleExperimentMetricAnalysis] = []
    for exp_data in data:
        try:
            exp_data_proc = ExperimentDataForStatsEngine(**exp_data)
            fixed_results, bandit_result, contextual_bandit_result = (
                process_experiment_results(exp_data_proc.data)
            )
            results.append(
                MultipleExperimentMetricAnalysis(
                    id=exp_data_proc.id,
                    results=fixed_results,
                    banditResult=bandit_result,
                    contextualBanditResult=contextual_bandit_result,
                    error=None,
                    traceback=None,
                )
            )
        except Exception as e:
            results.append(
                MultipleExperimentMetricAnalysis(
                    id=exp_data["id"],
                    results=[],
                    banditResult=None,
                    contextualBanditResult=None,
                    error=str(e),
                    traceback=traceback.format_exc(),
                )
            )
    return results
