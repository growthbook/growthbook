from dataclasses import asdict, dataclass
import dataclasses
import re
import traceback
import copy
from typing import Any, Dict, List, Optional, Set, Tuple, Union

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
    VariationResponse,
    BanditResult,
    SingleVariationResult,
    PowerResponse,
)
from gbstats.models.settings import (
    AnalysisSettingsForStatsEngine,
    BanditSettingsForStatsEngine,
    DataForStatsEngine,
    ExperimentDataForStatsEngine,
    ExperimentMetricQueryResponseRows,
    MetricSettingsForStatsEngine,
    MetricType,
    QueryResultsForStatsEngine,
    VarIdMap,
)
from gbstats.models.statistics import (
    ProportionStatistic,
    QuantileStatistic,
    QuantileClusteredStatistic,
    RatioStatistic,
    RegressionAdjustedRatioStatistic,
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
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
    if analysis.stats_engine == "frequentist":
        if analysis.sequential_testing_enabled:
            sequential_config = SequentialConfig(
                **base_config,
                alpha=analysis.alpha,
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
                alpha=analysis.alpha,
            )
            if analysis.one_sided_intervals:
                if metric.inverse:
                    return OneSidedTreatmentGreaterTTest(stats, config)
                else:
                    return OneSidedTreatmentLesserTTest(stats, config)
            else:
                return TwoSidedTTest(stats, config)
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

            metric_response = get_metric_response(d, test.stat_b, i)
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

        # replace count with quantile_n for quantile metrics
        if metric.statistic_type in ["quantile_event", "quantile_unit"]:
            for i in range(num_variations):
                prefix = f"v{i}" if i > 0 else "baseline"
                d[f"{prefix}_count"] = d[f"{prefix}_quantile_n"]

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
        baseline_data = get_metric_response(d, baseline_stat, 0)
        variation_data.insert(analysis.baseline_index, baseline_data)

        return DimensionResponseIndividual(
            dimension=dimensionData.dimension, srm=srm_p, variations=variation_data
        )

    return [analyze_dimension(mdat) for mdat in metric_data]


def get_metric_response(
    metric_row: pd.DataFrame, statistic: TestStatistic, v: int
) -> BaselineResponse:
    prefix = f"v{v}" if v > 0 else "baseline"

    stats = MetricStats(
        users=metric_row[f"{prefix}_users"].sum(),
        count=metric_row[f"{prefix}_count"].sum(),
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
    metric_capped = metric.capped
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
    if metric_capped:
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

    num_dimensions = len(reduced_metric_data)

    result = combine_core_and_supplemental_results(
        num_dimensions,
        num_variations,
        core_result,
        result_cuped_unadjusted,
        result_uncapped,
        result_flat_prior,
        result_unstratified,
        result_no_variance_reduction,
    )

    return result


def combine_core_and_supplemental_results(
    num_dimensions: int,
    num_variations: int,
    core_result: List[DimensionResponseIndividual],
    result_cuped_unadjusted: Optional[List[DimensionResponseIndividual]],
    result_capped: Optional[List[DimensionResponseIndividual]],
    result_flat_prior: Optional[List[DimensionResponseIndividual]],
    result_unstratified: Optional[List[DimensionResponseIndividual]],
    result_no_variance_reduction: Optional[List[DimensionResponseIndividual]],
) -> List[DimensionResponse]:
    def _set_supplemental_result(
        variation_response: Union[
            BayesianVariationResponse, FrequentistVariationResponse
        ],
        supplemental_variation: Any,
        attribute_name: str,
    ) -> None:
        """Set a supplemental result on the variation response with type checking."""
        is_bayesian = isinstance(
            variation_response, BayesianVariationResponse
        ) and isinstance(supplemental_variation, BayesianVariationResponseIndividual)
        is_frequentist = isinstance(
            variation_response, FrequentistVariationResponse
        ) and isinstance(supplemental_variation, FrequentistVariationResponseIndividual)

        if is_bayesian or is_frequentist:
            setattr(variation_response, attribute_name, supplemental_variation)
        else:
            raise ValueError(
                f"Unexpected variation response type: {type(supplemental_variation)}"
            )

    # Map supplemental result lists to their attribute names
    supplemental_mappings = [
        (result_cuped_unadjusted, "supplementalResultsCupedUnadjusted"),
        (result_capped, "supplementalResultsUncapped"),
        (result_flat_prior, "supplementalResultsFlatPrior"),
        (result_unstratified, "supplementalResultsUnstratified"),
        (result_no_variance_reduction, "supplementalResultsNoVarianceReduction"),
    ]

    result = []
    for d in range(num_dimensions):
        this_dimension_result = core_result[d]
        variations: List[VariationResponse] = [this_dimension_result.variations[0]]

        for i in range(1, num_variations):
            core_variation = core_result[d].variations[i]
            is_bayesian = isinstance(
                core_variation, BayesianVariationResponseIndividual
            )
            is_frequentist = isinstance(
                core_variation, FrequentistVariationResponseIndividual
            )

            if not (is_frequentist or is_bayesian):
                continue

            # Create the variation response object
            if is_bayesian:
                variation_response = BayesianVariationResponse(
                    **asdict(core_variation),
                    supplementalResultsCupedUnadjusted=None,
                    supplementalResultsUncapped=None,
                    supplementalResultsFlatPrior=None,
                    supplementalResultsUnstratified=None,
                    supplementalResultsNoVarianceReduction=None,
                )
            else:
                variation_response = FrequentistVariationResponse(
                    **asdict(core_variation),
                    supplementalResultsCupedUnadjusted=None,
                    supplementalResultsUncapped=None,
                    supplementalResultsUnstratified=None,
                    supplementalResultsNoVarianceReduction=None,
                )

            # Set all supplemental results
            for supplemental_result, attribute_name in supplemental_mappings:
                if supplemental_result is not None:
                    supplemental_variation = supplemental_result[d].variations[i]
                    _set_supplemental_result(
                        variation_response, supplemental_variation, attribute_name
                    )

            variations.append(variation_response)

        result.append(
            DimensionResponse(
                dimension=core_result[d].dimension,
                srm=core_result[d].srm,
                variations=variations,
            )
        )

    return result


def get_var_id_map(var_ids: List[str]) -> VarIdMap:
    return {v: i for i, v in enumerate(var_ids)}


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
    bandit_config = BanditConfig(
        prior_distribution=bandit_prior,
        bandit_weights_seed=bandit_settings.bandit_weights_seed,
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
                    seed=bandit_result.seed,
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
        bandit_settings=(
            BanditSettingsForStatsEngine(**data["bandit_settings"])
            if "bandit_settings" in data
            else None
        ),
    )


def process_experiment_results(
    data: Dict[str, Any]
) -> Tuple[List[ExperimentMetricAnalysis], Optional[BanditResult]]:
    d = process_data_dict(data)
    results: List[ExperimentMetricAnalysis] = []
    bandit_result: Optional[BanditResult] = None
    for query_result in d.query_results:
        for i, metric in enumerate(query_result.metrics):
            if metric in d.metrics:
                this_metric = d.metrics[metric]
                rows = filter_query_rows(query_result.rows, i)
                if len(rows):
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
    return results, bandit_result


def process_multiple_experiment_results(
    data: List[Dict[str, Any]]
) -> List[MultipleExperimentMetricAnalysis]:
    results: List[MultipleExperimentMetricAnalysis] = []
    for exp_data in data:
        try:
            exp_data_proc = ExperimentDataForStatsEngine(**exp_data)
            fixed_results, bandit_result = process_experiment_results(
                exp_data_proc.data
            )
            results.append(
                MultipleExperimentMetricAnalysis(
                    id=exp_data_proc.id,
                    results=fixed_results,
                    banditResult=bandit_result,
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
                    error=str(e),
                    traceback=traceback.format_exc(),
                )
            )
    return results
