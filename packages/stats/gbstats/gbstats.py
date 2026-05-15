from dataclasses import asdict, dataclass
import dataclasses
import re
import traceback
import copy
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import numpy as np
import pandas as pd

from gbstats.bayesian.contextual import BuildClassificationTree
from gbstats.contextual_weights_lookup import ContextualBanditWeightsLookup
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
    ContextualBanditResult,
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


def summable_statistics_per_variation_from_experiment_metric_rows(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    var_ids: List[str],
) -> List[SummableStatistic]:
    """Build one :class:`~gbstats.models.statistics.SummableStatistic` per variation index.

    ``rows`` must be the SQL-style narrow rows for a **single** context (or any set where
    each row's ``variation`` identifies an arm). Rows for the same ``variation`` are merged
    by summing :data:`SUM_COLS` like :func:`get_metric_dfs`. The *k*th list entry is the
    statistic for ``var_ids[k]`` (same order as :func:`get_var_id_map`).

    Quantile metric types are not supported (they are not ``SummableStatistic``).
    """
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
                SingleVariationResult(n, mn, ci)
                for n, mn, ci in zip(
                    b.variation_counts,
                    b.posterior_mean,
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


class UpdateWeightsContextualBandit:
    """Updates variation weights per context. rows (ExperimentMetricQueryResponseRows) is an input; contexts are derived from analysis_settings.dimension. Call compute_result() to get per-context BanditResults (optionally pass rows to override, and current_weights_by_context for priors)."""

    def __init__(
        self,
        rows: ExperimentMetricQueryResponseRows,
        metric_settings: MetricSettingsForStatsEngine,
        analysis_settings: AnalysisSettingsForStatsEngine,
        contextual_bandit_settings: ContextualBanditSettingsForStatsEngine,
    ):
        """Store rows, metric/analysis settings, and contextual bandit settings for later use in compute_result()."""
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
            updatedWeights=default_weights,
            bestArmProbabilities=None,
            updateMessage=update_message,
            error=None,
        )

    @staticmethod
    def no_update_result(
        attributes: list[str], num_variations: int, update_message: str
    ) -> ContextualBanditResult:
        return ContextualBanditResult(
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
        for row in rows:
            for col in context_columns:
                if col not in row:
                    raise ValueError(f"Column {col} not found in row {row}")

        return sorted(
            set(tuple(str(row[col]) for col in context_columns) for row in rows)
        )

    @staticmethod
    def create_rows_by_context(
        rows: ExperimentMetricQueryResponseRows,
        context_columns: list[str],
        unique_contexts: list[tuple[str, ...]],
    ) -> dict[tuple[str, ...], ExperimentMetricQueryResponseRows]:
        return {
            ctx: [
                r for r in rows if tuple(str(r[col]) for col in context_columns) == ctx
            ]
            for ctx in unique_contexts
        }

    def compute_result(self) -> ContextualBanditResult:
        """Derive contexts from rows and contextual_bandit_settings.contexts (list of column names); run bandit per context; return per-context BanditResult. If current_weights is provided per context, use it as prior; otherwise use analysis_settings.weights."""
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
            # Unique contexts: one tuple per combination of (col0, col1, ...) across rows
            contexts = self.create_contexts(
                self.rows, self.contextual_bandit_settings.attributes
            )
            # a row for each context
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

                context_rule = {
                    attr: {"$in": [ctx[i]]}
                    for i, attr in enumerate(self.contextual_bandit_settings.attributes)
                }
                contextual_result = ContextualBanditResponse(
                    context=context_rule,
                    sampleSizePerVariation=sample_size_per_variation,
                    variationMeans=variation_means,
                    updatedWeights=r.updatedWeights,
                    bestArmProbabilities=r.bestArmProbabilities,
                    updateMessage=r.updateMessage,
                    error=r.error,
                )
                responses.append(contextual_result)

            return ContextualBanditResult(
                attributes=self.contextual_bandit_settings.attributes,
                responses=responses,
            )


class UpdateWeightsContextualTree:
    """Fits a tree over contexts and updates variation weights per leaf via UpdateWeightsContextualBandit. Same constructor args as UpdateWeightsContextualBandit except bandit_settings is ContextualBanditSettingsForStatsEngine."""

    def __init__(
        self,
        rows: ExperimentMetricQueryResponseRows,
        metric_settings: MetricSettingsForStatsEngine,
        analysis_settings: AnalysisSettingsForStatsEngine,
        contextual_bandit_settings: ContextualBanditSettingsForStatsEngine,
    ):
        """Initialize the tree with rows and settings; derive contexts from rows and analysis_settings.dimension, and set up leaf structure and internal bandit for per-leaf weight updates."""
        self.rows = rows
        self.metric_settings = metric_settings
        self.analysis_settings = analysis_settings
        self.contextual_bandit_settings = contextual_bandit_settings
        self.max_leaf_nodes = getattr(contextual_bandit_settings, "max_leaf_nodes", 12)
        num_vars = len(
            contextual_bandit_settings.var_ids or contextual_bandit_settings.var_names
        )
        if num_vars == 0:
            raise ValueError("No variations found in bandit settings")
        default_w = getattr(analysis_settings, "weights", None)
        self.initial_weights = (
            list(default_w) if default_w is not None else [1.0 / num_vars] * num_vars
        )
        self.num_variations = num_vars
        self.rng = contextual_bandit_settings.bandit_weights_rng
        self.contexts = UpdateWeightsContextualBandit.create_contexts(
            rows, self.contextual_bandit_settings.attributes
        )
        self.leaf_ids = []
        self.leaf_map = {}
        self.merge_combined_rows = lambda a, b: (a or []) + (b or [])

    @property
    def contexts_by_leaf(self) -> dict:
        """Leaf id -> list of contexts in that leaf. Derived from leaf_map."""
        out: dict = {}
        for ctx, leaf_id in self.leaf_map.items():
            out.setdefault(leaf_id, []).append(ctx)
        return out

    def set_leaf_structure(self, leaf_map: dict, leaf_ids: list):
        """Set leaf structure (called by build_tree)."""
        self.leaf_map = leaf_map
        self.leaf_ids = leaf_ids

    def rows_to_rows_by_context(
        self, rows: ExperimentMetricQueryResponseRows
    ) -> dict[tuple, ExperimentMetricQueryResponseRows]:
        """Transform flat ExperimentMetricQueryResponseRows into the structure expected by build_tree: dict mapping context (tuple of dimension values) -> list of rows.
        Uses bandit_settings.dimension for column names (arbitrary number of dimensions), falling back to analysis_settings.dimension for a single dimension.
        Example:
        rows = [
            {"dimension": "A", "variation": 0, "users": 100, "main_sum": 1000},
            {"dimension": "A", "variation": 1, "users": 200, "main_sum": 2000},
            {"dimension": "B", "variation": 0, "users": 150, "main_sum": 1500},
        ]
        """
        if not rows:
            return {}
        out: dict[tuple, ExperimentMetricQueryResponseRows] = {}
        for row in rows:
            ctx = tuple(
                str(row.get(attribute, CONTEXTUAL_BANDIT_DIMENSION_VALUE))
                for attribute in self.contextual_bandit_settings.attributes
            )
            out.setdefault(ctx, []).append(row)
        return out

    def build_tree(self, rows_by_context: dict):
        """Delegate tree fitting to :class:`BuildClassificationTree`."""
        builder = BuildClassificationTree(
            contexts=self.contexts,
            num_variations=self.num_variations,
            max_leaf_nodes=self.max_leaf_nodes,
            rng=self.rng,
            bandit_settings=self.contextual_bandit_settings,
        )
        builder.build(rows_by_context)
        self.set_leaf_structure(builder.leaf_map, builder.leaf_ids)
        self._last_fitted_tree = builder.fitted_tree
        self._last_tree_feature_names = builder.tree_feature_names

    def _build_by_leaf_cumulative(self, rows_by_context: dict) -> dict:
        """Aggregate rows_by_context (context -> rows) into per-leaf rows by merging all contexts that map to the same leaf_id. Returns dict mapping leaf_id -> merged list of rows."""
        by_leaf_cumulative = {}
        for leaf_id in self.leaf_ids:
            rows_leaf = None
            for ctx in self.contexts:
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

    @staticmethod
    def _zero_like_aggregate(sample: Any) -> Any:
        """Default for an empty variation group, matching the type of an observed value."""
        if isinstance(sample, np.ndarray):
            return np.array([0.0])
        if isinstance(sample, (bool, np.bool_)):
            return False
        if isinstance(sample, (int, np.integer)):
            return 0
        if isinstance(sample, (float, np.floating)):
            return 0.0
        return 0

    @staticmethod
    def _sum_aggregate_field(values: list[Any]) -> Any:
        """Sum numeric or 0-d / 1-d array values; output type follows the first value."""
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

    def _aggregate_leaf_rows_for_bandit(
        self, rows: ExperimentMetricQueryResponseRows, leaf_id: int
    ) -> ExperimentMetricQueryResponseRows:
        """Merge all rows in a leaf (many contexts × variations) into one row per variation.

        Sums every field in SUM_COLS that appears on any input row. Sets LEAF_ID_COLUMN for
        UpdateWeightsContextualBandit (leaf as context).
        """
        if not rows:
            return []
        sum_cols_active = [c for c in SUM_COLS if any(c in r for r in rows)]
        by_var: dict[int, list[dict[str, Any]]] = {}
        for r in rows:
            v = int(r["variation"])
            by_var.setdefault(v, []).append(r)
        bandit_period = rows[0].get("bandit_period", 0)
        out: ExperimentMetricQueryResponseRows = []
        for v in range(self.num_variations):
            grp = by_var.get(v, [])
            row: dict[str, Any] = {
                LEAF_ID_COLUMN: leaf_id,
                "dimension": CONTEXTUAL_BANDIT_DIMENSION_COLUMN,
                "bandit_period": bandit_period,
                "variation": v,
            }
            for col in sum_cols_active:
                sample = next((r[col] for r in rows if col in r), None)
                if not grp:
                    row[col] = (
                        self._zero_like_aggregate(sample) if sample is not None else 0
                    )
                    continue
                vals = [r[col] for r in grp if col in r]
                row[col] = (
                    self._sum_aggregate_field(vals)
                    if vals
                    else (
                        self._zero_like_aggregate(sample) if sample is not None else 0
                    )
                )
            out.append(row)
        return out

    def compute_result(self) -> ContextualBanditResult:
        """Fit tree, aggregate rows per leaf with LEAF_ID_COLUMN, run **one** UpdateWeightsContextualBandit with contexts=[LEAF_ID_COLUMN], then map leaf-level results and weights onto each real context via leaf_map."""
        rows_by_context = self.rows_to_rows_by_context(self.rows)
        self.build_tree(rows_by_context)
        if not self.leaf_ids:
            update_message = "no leaves"
            return UpdateWeightsContextualBandit.no_update_result(
                [], self.num_variations, update_message=update_message
            )
        by_leaf_cumulative = self._build_by_leaf_cumulative(rows_by_context)

        rows_all: ExperimentMetricQueryResponseRows = []
        leaf_weight_keys: dict[int, tuple[str, ...]] = {}
        for leaf_id in self.leaf_ids:
            rows_leaf = by_leaf_cumulative.get(leaf_id) or []
            if not rows_leaf:
                raise ValueError(f"No rows for leaf {leaf_id}")
            leaf_key = (str(leaf_id),)
            leaf_weight_keys[leaf_id] = leaf_key
            rows_all.extend(
                self._aggregate_leaf_rows_for_bandit(rows_leaf, leaf_id=leaf_id)
            )

        bandit_settings_for_tree = copy.deepcopy(self.contextual_bandit_settings)
        bandit_settings_for_tree.attributes = ["leaf_id"]

        leaf_bandit = UpdateWeightsContextualBandit(
            rows_all,
            self.metric_settings,
            self.analysis_settings,
            bandit_settings_for_tree,
        )
        leaf_response = leaf_bandit.compute_result()

        attrs = self.contextual_bandit_settings.attributes
        responses: list[ContextualBanditResponse] = []
        for ctx in self.contexts:
            context_rule: Context = {
                attr: {"$in": [ctx[i]]} for i, attr in enumerate(attrs)
            }
            leaf_id = self.leaf_map.get(ctx)
            if leaf_id is None:
                responses.append(
                    UpdateWeightsContextualBandit.no_update_response(
                        context=context_rule,
                        num_variations=self.num_variations,
                        update_message="no leaf assignment for context",
                    )
                )
                continue
            lkey = leaf_weight_keys.get(leaf_id)
            if lkey is None:
                responses.append(
                    UpdateWeightsContextualBandit.no_update_response(
                        context=context_rule,
                        num_variations=self.num_variations,
                        update_message="no leaf weight key",
                    )
                )
                continue
            observed_leaf = ContextualBanditWeightsLookup.observed_from_tuple(
                bandit_settings_for_tree.attributes, lkey
            )
            r = ContextualBanditWeightsLookup.find_matching_contextual_response(
                leaf_response.responses, observed_leaf
            )
            if r is not None:
                responses.append(
                    ContextualBanditResponse(
                        context=context_rule,
                        sampleSizePerVariation=r.sampleSizePerVariation,
                        variationMeans=r.variationMeans,
                        updatedWeights=r.updatedWeights,
                        bestArmProbabilities=r.bestArmProbabilities,
                        updateMessage=r.updateMessage,
                        error=r.error,
                    )
                )
                new_w = (
                    r.updatedWeights
                    if r.updatedWeights is not None
                    else r.bestArmProbabilities
                )
                if new_w is not None:
                    wlist = list(new_w)
                    ccw = getattr(
                        self.contextual_bandit_settings,
                        "current_contextual_weights",
                        None,
                    )
                    if ccw is not None:
                        ccw[ctx] = wlist
                        ccw[str(leaf_id)] = wlist
            else:
                responses.append(
                    UpdateWeightsContextualBandit.no_update_response(
                        context=context_rule,
                        num_variations=self.num_variations,
                        update_message="no matching leaf bandit response",
                    )
                )

        return ContextualBanditResult(
            attributes=attrs,
            responses=responses,
        )


class UpdateWeightsContextualTreeReward(UpdateWeightsContextualTree):
    @staticmethod
    def ordered_variation_statistics(
        summed: Dict[str, SummableStatistic], variation_columns: List[str]
    ) -> list[SummableStatistic]:
        return list(summed[col] for col in variation_columns)

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
    def calculate_expected_reward(
        aggregated: Dict[str, SummableStatistic],
        variation_columns: List[str],
        rng: np.random.Generator,
        analysis_settings: AnalysisSettingsForStatsEngine,
        metric_settings: MetricSettingsForStatsEngine,
    ) -> float:
        """Calculate the expected reward for a given set of aggregated statistics."""
        num_variations = len(variation_columns)
        default_weights = np.full(num_variations, 1 / num_variations).tolist()
        bandit_config = BanditConfig(
            prior_distribution=GaussianPrior(mean=0, variance=float(1e4), proper=True),
            bandit_weights_rng=rng,
            weight_by_period=True,
            top_two=False,
            alpha=analysis_settings.alpha,
            inverse=metric_settings.inverse,
        )
        ordered_stats = UpdateWeightsContextualTreeReward.ordered_variation_statistics(
            aggregated, variation_columns
        )
        if isinstance(ordered_stats, list) and all(
            isinstance(stat, RatioStatistic) for stat in ordered_stats
        ):
            bandit_instance = BanditsRatio(ordered_stats, default_weights, bandit_config)  # type: ignore
        elif ordered_stats and isinstance(
            ordered_stats[0], RegressionAdjustedStatistic
        ):
            bandit_instance = BanditsCuped(ordered_stats, default_weights, bandit_config)  # type: ignore
        elif isinstance(ordered_stats, list) and all(
            isinstance(stat, SampleMeanStatistic) for stat in ordered_stats
        ):
            bandit_instance = BanditsSimple(ordered_stats, default_weights, bandit_config)  # type: ignore
        else:
            raise ValueError(f"Invalid ordered statistics: {ordered_stats}")
        leaf_response = bandit_instance.compute_result()
        leaf_weights = np.asarray(
            leaf_response.bandit_weights
            if leaf_response.bandit_weights is not None
            else default_weights
        )
        leaf_means = np.asarray(
            leaf_response.cr
            if leaf_response.cr is not None
            else [stat.mean for stat in aggregated.values()]
        )
        # remove this later
        if leaf_response.bandit_weights is None:
            raise ValueError(f"Leaf response weights are None: {leaf_response}")
        cr = np.asarray(leaf_response.cr)
        diff = np.max(
            np.abs(cr - np.array([stat.mean for stat in aggregated.values()]))
        )
        if diff > 0.0001:
            raise ValueError(f"Leaf response means are not equal: {diff}")
        # remove above here later
        n = np.sum([stat.n for stat in ordered_stats])
        return float(n * np.sum(leaf_means * leaf_weights))

    @staticmethod
    def identify_update(
        stats_encoded: pd.DataFrame,
        dummy_feature_names: List[str],
        variation_columns: List[str],
        analysis_settings: AnalysisSettingsForStatsEngine,
        metric_settings: MetricSettingsForStatsEngine,
        rng: np.random.Generator,
    ) -> tuple[int, int]:
        """Given the current tree, which feature inside of which leaf most increases expected reward?

        ``variation_columns`` must match stat columns from ``summable_statistics_...``, i.e.
        ``bandit_settings.var_ids`` in canonical form.
        """
        num_features = len(dummy_feature_names)
        num_leaves_current = len(np.unique(stats_encoded["current_leaf"]))
        expected_reward_current = np.zeros((num_leaves_current))
        expected_reward_split = np.zeros((num_features, num_leaves_current))

        for leaf_index in range(num_leaves_current):
            # use observations only from the current leaf
            this_leaf = stats_encoded[stats_encoded["current_leaf"] == leaf_index]
            # calculate SSE for the current leaf
            aggregated = UpdateWeightsContextualTreeReward.aggregate_variation_columns(
                this_leaf, variation_columns
            )
            expected_reward_current[leaf_index] = (
                UpdateWeightsContextualTreeReward.calculate_expected_reward(
                    aggregated,
                    variation_columns,
                    rng,
                    analysis_settings,
                    metric_settings,
                )
            )

            for feature_index in range(num_features):
                # calculate SSE if the feature is split into 0 and 1
                stats_df_0 = this_leaf[
                    this_leaf[dummy_feature_names[feature_index]] == 0
                ]
                stats_df_1 = this_leaf[
                    this_leaf[dummy_feature_names[feature_index]] == 1
                ]
                if len(stats_df_0) == 0 or len(stats_df_1) == 0:
                    expected_reward_split[feature_index, leaf_index] = (
                        expected_reward_current[leaf_index]
                    )
                else:
                    aggregated_0 = (
                        UpdateWeightsContextualTreeReward.aggregate_variation_columns(
                            stats_df_0, variation_columns
                        )
                    )
                    aggregated_1 = (
                        UpdateWeightsContextualTreeReward.aggregate_variation_columns(
                            stats_df_1, variation_columns
                        )
                    )
                    expected_reward_0 = (
                        UpdateWeightsContextualTreeReward.calculate_expected_reward(
                            aggregated_0,
                            variation_columns,
                            rng,
                            analysis_settings,
                            metric_settings,
                        )
                    )
                    expected_reward_1 = (
                        UpdateWeightsContextualTreeReward.calculate_expected_reward(
                            aggregated_1,
                            variation_columns,
                            rng,
                            analysis_settings,
                            metric_settings,
                        )
                    )
                    expected_reward_split[feature_index, leaf_index] = (
                        expected_reward_0 + expected_reward_1
                    )
        current_matrix = np.tile(expected_reward_current, (num_features, 1))
        diff = expected_reward_split - current_matrix

        # delete below me later
        dir_desktop = "/Users/lukesmith/Desktop/"
        pd.DataFrame(expected_reward_split).to_csv(
            dir_desktop + "expected_reward_split_" + str(num_leaves_current) + ".csv"
        )
        pd.DataFrame(expected_reward_current).to_csv(
            dir_desktop + "expected_reward_current_" + str(num_leaves_current) + ".csv"
        )
        # delete above me later

        idx = np.argmax(diff)
        pos = np.unravel_index(idx, diff.shape)
        return (int(pos[0]), int(pos[1]))


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


def get_bandit_settings(data: Dict[str, Any]) -> Optional[BanditSettingsForStatsEngine]:
    """Build :class:`BanditSettingsForStatsEngine` from the stats-engine payload.

    Copies every field defined on :class:`BanditSettingsForStatsEngine` from
    ``data["bandit_settings"]`` except ``bandit_weights_rng``, which is always set to
    :func:`numpy.random.default_rng` using ``bandit_weights_seed`` from that dict
    (default ``100`` if the seed is omitted). Extra keys in the payload (e.g.
    ``historical_weights`` from the API) are ignored.
    """
    if "bandit_settings" not in data or data["bandit_settings"] is None:
        return None
    raw = dict(data["bandit_settings"])
    allowed = {f.name for f in dataclasses.fields(BanditSettingsForStatsEngine)}
    kwargs = {
        k: v for k, v in raw.items() if k in allowed and k != "bandit_weights_rng"
    }
    seed = int(kwargs.get("bandit_weights_seed", 100))
    kwargs["bandit_weights_rng"] = np.random.default_rng(seed)
    return BanditSettingsForStatsEngine(**kwargs)


def get_contextual_bandit_settings(
    data: Dict[str, Any],
) -> Optional[ContextualBanditSettingsForStatsEngine]:
    """Build :class:`ContextualBanditSettingsForStatsEngine` from ``data["contextual_bandit_settings"]``."""
    raw_payload = data.get("contextual_bandit_settings")
    if raw_payload is None:
        return None
    raw = dict(raw_payload)
    allowed = {
        f.name for f in dataclasses.fields(ContextualBanditSettingsForStatsEngine)
    }
    kwargs = {
        k: v for k, v in raw.items() if k in allowed and k != "bandit_weights_rng"
    }
    seed = int(raw.get("bandit_weights_seed", 100))
    kwargs["bandit_weights_rng"] = np.random.default_rng(seed)
    kwargs.setdefault("current_contextual_weights", {})
    try:
        return ContextualBanditSettingsForStatsEngine(**kwargs)
    except (TypeError, ValueError):
        return None


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
    use_tree: bool,  # remove later, used only for simulation
) -> ContextualBanditResult:

    if use_tree:
        return UpdateWeightsContextualTree(
            rows=rows,
            metric_settings=metric,
            analysis_settings=settings,
            contextual_bandit_settings=contextual_bandit_settings,
        ).compute_result()
    else:
        return UpdateWeightsContextualBandit(
            rows=rows,
            metric_settings=metric,
            analysis_settings=settings,
            contextual_bandit_settings=contextual_bandit_settings,
        ).compute_result()


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
                            use_tree=True,
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
