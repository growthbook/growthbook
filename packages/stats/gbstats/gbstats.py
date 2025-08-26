from dataclasses import asdict
import re
import traceback
import copy
from typing import Any, Dict, Hashable, List, Optional, Set, Tuple, Union

import pandas as pd
import numpy as np

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
    AdditionalSampleSizeNeededResult,
)

from gbstats.models.tests import BaseConfig

from gbstats.frequentist.tests import (
    FrequentistConfig,
    FrequentistTestResult,
    SequentialConfig,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
    OneSidedTreatmentGreaterTTest,
    OneSidedTreatmentLesserTTest,
    SequentialOneSidedTreatmentLesserTTest,
    SequentialOneSidedTreatmentGreaterTTest,
)

from gbstats.models.results import (
    BaselineResponse,
    BayesianVariationResponse,
    DimensionResponse,
    ExperimentMetricAnalysis,
    ExperimentMetricAnalysisResult,
    FrequentistVariationResponse,
    MetricStats,
    MultipleExperimentMetricAnalysis,
    BanditResult,
    ResponseCI,
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
    #Overall columns

# Transform raw SQL result for metrics into a dataframe of dimensions
def get_metric_df(
    rows: pd.DataFrame,
    var_id_map: VarIdMap,
    var_names: List[str],
    dimension: Optional[str] = None,
    post_stratify: bool = False,
) -> pd.DataFrame:
    dfc = rows.copy()
    dimensions = {}

    if post_stratify:
        dimension_cols = dfc.filter(like='dim_exp_')
        num_dimensions = len(dimension_cols.columns)
        if num_dimensions == 1:
            dfc = dfc.rename(columns={dimension_cols.columns[0]: 'dimension'})
        else:
            dfc['dimension'] = dfc[dimension_cols].agg(lambda x: '_'.join(x), axis=1)
    

    # Each row in the raw SQL result is a dimension/variation combo
    # We want to end up with one row per dimension
    for row in dfc.itertuples(index=False):
        # strip dimension of prefix before `:`
        dimension_column_name = (
            "dimension" if not dimension else get_dimension_column_name(dimension)
        )
        # if not found, try to find a column with "dimension" for backwards compatibility
        # fall back to one unnamed dimension if even that column is not found
        dim = getattr(row, dimension_column_name, getattr(row, "dimension", ""))
        
        # If this is the first time we're seeing this dimension, create an empty dict
        if dim not in dimensions:
            # Overall columns
            dimensions[dim] = {
                "dimension": dim,
                "variations": len(var_names),
                "total_users": 0,
            }
            # Add columns for each variation (including baseline)
            for key in var_id_map:
                i = var_id_map[key]
                prefix = f"v{i}" if i > 0 else "baseline"
                dimensions[dim][f"{prefix}_id"] = key
                dimensions[dim][f"{prefix}_name"] = var_names[i]
                for col in ROW_COLS:
                    dimensions[dim][f"{prefix}_{col}"] = 0

        # Add this SQL result row into the dimension dict if we recognize the variation
        key = str(row.variation)
        if key in var_id_map:
            i = var_id_map[key]
            dimensions[dim]["total_users"] += row.users
            prefix = f"v{i}" if i > 0 else "baseline"

            # Sum here in case multiple rows per dimension
            for col in SUM_COLS:
                # Special handling for count, if missing returns a method, so override with user value
                if col == "count" and callable(getattr(row, col)):
                    dimensions[dim][f"{prefix}_count"] += getattr(row, "users", 0)
                else:
                    dimensions[dim][f"{prefix}_{col}"] += getattr(row, col, 0)
            for col in NON_SUMMABLE_COLS:
                if dimensions[dim][f"{prefix}_{col}"] != 0:
                    raise ValueError(
                        f"ImplementationError: Non-summable column {col} already has a value for dimension {dim}"
                    )
                dimensions[dim][f"{prefix}_{col}"] = getattr(row, col, 0)
    return pd.DataFrame(dimensions.values())


# Limit to the top X dimensions with the most users
# Merge the rest into an "(other)" dimension
def reduce_dimensionality(
    df: pd.DataFrame, max: int = 20, keep_other: bool = True
) -> pd.DataFrame:
    num_variations = df.at[0, "variations"]

    rows = df.to_dict("records")
    rows.sort(key=lambda i: i["total_users"], reverse=True)

    newrows = []

    for i, row in enumerate(rows):
        # For the first few dimensions, keep them as-is
        if i < max:
            newrows.append(row)
        # For the rest, merge them into the last dimension
        elif keep_other:
            current = newrows[max - 1]
            current["dimension"] = "(other)"
            current["total_users"] += row["total_users"]
            for v in range(num_variations):
                prefix = f"v{v}" if v > 0 else "baseline"
                for col in SUM_COLS:
                    current[f"{prefix}_{col}"] += row[f"{prefix}_{col}"]

    return pd.DataFrame(newrows)


def get_configured_test(
    stats: List[Tuple[TestStatistic, TestStatistic]],
    total_users: int,
    analysis: AnalysisSettingsForStatsEngine,
    metric: MetricSettingsForStatsEngine,
) -> StatisticalTests:

    base_config = {
        "total_users": total_users,
        "traffic_percentage": analysis.traffic_percentage,
        "phase_length_days": analysis.phase_length_days,
        "difference_type": analysis.difference_type,
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
        assert type(stats[0][0]) is type(stats[0][1]), "stat_a and stat_b must be of same type."
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


def initialize_df(df: pd.DataFrame, analysis: AnalysisSettingsForStatsEngine) -> pd.DataFrame:
    num_variations = df.at[0, "variations"]
    df["srm_p"] = 0
    df["engine"] = analysis.stats_engine
    for i in range(num_variations):
        if i == 0:
            df["baseline_cr"] = 0
            df["baseline_mean"] = None
            df["baseline_stddev"] = None
        else:
            df[f"v{i}_cr"] = 0
            df[f"v{i}_mean"] = None
            df[f"v{i}_stddev"] = None
            df[f"v{i}_expected"] = 0
            df[f"v{i}_p_value"] = None
            df[f"v{i}_p_value_error_message"] = None
            df[f"v{i}_risk"] = None
            df[f"v{i}_prob_beat_baseline"] = None
            df[f"v{i}_uplift"] = None
            df[f"v{i}_error_message"] = None
            df[f"v{i}_decision_making_conditions"] = False
            df[f"v{i}_first_period_pairwise_users"] = None
            df[f"v{i}_target_mde"] = None
            df[f"v{i}_sigmahat_2_delta"] = None
            df[f"v{i}_prior_proper"] = False
            df[f"v{i}_prior_lift_mean"] = None
            df[f"v{i}_prior_lift_variance"] = None
            df[f"v{i}_power_status"] = None
            df[f"v{i}_power_error_message"] = None
            df[f"v{i}_power_upper_bound_acheieved"] = None
            df[f"v{i}_scaling_factor"] = None
    return df


def run_mid_experiment_power(variation_index: int, total_users: int, num_variations: int, effect_moments: EffectMomentsResult, res: Union[BayesianTestResult, FrequentistTestResult], metric: MetricSettingsForStatsEngine, analysis: AnalysisSettingsForStatsEngine, s: pd.Series) -> pd.Series:
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
        effect_moments=effect_moments, test_result=res, config=config, power_config=power_config
    )
    mid_experiment_power_result = (
        mid_experiment_power.calculate_sample_size()
    )
    s[f"v{variation_index}_decision_making_conditions"] = True
    s[f"v{variation_index}_first_period_pairwise_users"] = (
        mid_experiment_power.pairwise_sample_size
    )
    s[f"v{variation_index}_target_mde"] = metric.target_mde
    s[f"v{variation_index}_sigmahat_2_delta"] = mid_experiment_power.sigmahat_2_delta
    if mid_experiment_power.prior_effect:
        s[f"v{variation_index}_prior_proper"] = mid_experiment_power.prior_effect.proper
        s[f"v{variation_index}_prior_lift_mean"] = mid_experiment_power.prior_effect.mean
        s[f"v{variation_index}_prior_lift_variance"] = (
            mid_experiment_power.prior_effect.variance
        )
    mid_experiment_power_result = (
        mid_experiment_power.calculate_sample_size()
    )
    s[f"v{variation_index}_power_status"] = mid_experiment_power_result.update_message
    s[f"v{variation_index}_power_error_message"] = mid_experiment_power_result.error
    s[f"v{variation_index}_power_upper_bound_achieved"] = (
        mid_experiment_power_result.upper_bound_achieved
    )
    s[f"v{variation_index}_scaling_factor"] = mid_experiment_power_result.scaling_factor
    return s


def post_stratify(df: pd.DataFrame, metric: MetricSettingsForStatsEngine, analysis: AnalysisSettingsForStatsEngine) -> pd.DataFrame: 
    
    #need to add a check for quantile metrics
    num_variations = df.at[0, "variations"]
    num_dimensions = df.shape[0]

    #dataframe that is returned
    df_output = copy.deepcopy(df)
    df_output = reduce_dimensionality(df_output, max=1, keep_other=True)
    df_output['dimension'] = 'NA'
    df_output = initialize_df(df_output, analysis)
    
    stats_control = []
    total_users_control = 0
    for dimension in range(num_dimensions):
        s = df.iloc[dimension]
        stat = variation_statistic_from_metric_row(row=s, prefix="baseline", metric=metric)
        stats_control.append(stat)
        total_users_control += s["total_users"]
    for variation in range(1, num_variations):
        stats_variation = []
        total_users_variation = 0
        for dimension in range(num_dimensions):
            s = df.iloc[dimension]
            stat = variation_statistic_from_metric_row(row=s, prefix=f"v{variation}", metric=metric)
            stats_variation.append(stat)
            total_users_variation += s["total_users"]
        total_users = total_users_control + total_users_variation
        stats = list(zip(stats_control, stats_variation))
        test = get_configured_test(
            stats, total_users, analysis=analysis, metric=metric
        )
        res = test.compute_result()
        if decision_making_conditions(metric, analysis):
            s = run_mid_experiment_power(variation, total_users, num_variations, test.moments_result, res, metric, analysis, s)
    s["srm_p"] = check_srm(
        [s["baseline_users"]]
        + [s[f"v{i}_users"] for i in range(1, num_variations)],
        analysis.weights,
    )
    return s.to_frame().T


def store_test_results(test: StatisticalTests, res: Union[BayesianTestResult, FrequentistTestResult], s: pd.Series, variation: int) -> pd.Series:
    s["baseline_cr"] = test.stat_a.unadjusted_mean
    s["baseline_mean"] = test.stat_a.unadjusted_mean
    s["baseline_stddev"] = test.stat_a.stddev

    s[f"v{variation}_cr"] = test.stat_b.unadjusted_mean
    s[f"v{variation}_mean"] = test.stat_b.unadjusted_mean
    s[f"v{variation}_stddev"] = test.stat_b.stddev

    # Unpack result in Pandas row
    if isinstance(res, BayesianTestResult):
        s.at[f"v{variation}_risk"] = res.risk
        s[f"v{variation}_risk_type"] = res.risk_type
        s[f"v{variation}_prob_beat_baseline"] = res.chance_to_win
    elif isinstance(res, FrequentistTestResult):
        if res.p_value is not None:
            s[f"v{variation}_p_value"] = res.p_value
        else:
            s[f"v{variation}_p_value_error_message"] = res.p_value_error_message
    if test.stat_a.unadjusted_mean <= 0:
        # negative or missing control mean
        s[f"v{variation}_expected"] = 0
    elif res.expected == 0:
        # if result is not valid, try to return at least the diff
        s[f"v{variation}_expected"] = (
            test.stat_b.mean - test.stat_a.mean
        ) / test.stat_a.unadjusted_mean
    else:
        # return adjusted/prior-affected guess of expectation
        s[f"v{variation}_expected"] = res.expected
    s.at[f"v{variation}_ci"] = res.ci
    s.at[f"v{variation}_uplift"] = asdict(res.uplift)
    s[f"v{variation}_error_message"] = res.error_message
    return s


# Run A/B test analysis for each variation and dimension
def analyze_metric_df(
    df: pd.DataFrame,
    metric: MetricSettingsForStatsEngine,
    analysis: AnalysisSettingsForStatsEngine,
) -> pd.DataFrame:
    num_variations = df.at[0, "variations"]
    df = initialize_df(df, analysis)
    dir_desktop = "/Users/lukesmith/Desktop/"
    df.to_csv(dir_desktop + "initial_df.csv")

    def analyze_row(s: pd.Series) -> pd.Series:
        s = s.copy()
        # Loop through each non-baseline variation and run an analysis
        for i in range(1, num_variations):
            # Run analysis of baseline vs variation
            stat_a = variation_statistic_from_metric_row(s, "baseline", metric)
            stat_b = variation_statistic_from_metric_row(s, f"v{i}", metric)
            stats = [(stat_a, stat_b)]
            total_users = s["total_users"]

            test = get_configured_test(
                stats, total_users, analysis=analysis, metric=metric
            )
            res = test.compute_result()
            if decision_making_conditions(metric, analysis):
                s = run_mid_experiment_power(i, total_users, num_variations, test.moments_result, res, metric, analysis, s)
            s = store_test_results(test, res, s, i)

        # replace count with quantile_n for quantile metrics
        if metric.statistic_type in ["quantile_event", "quantile_unit"]:
            for i in range(num_variations):
                prefix = f"v{i}" if i > 0 else "baseline"
                s[f"{prefix}_count"] = s[f"{prefix}_quantile_n"]

        s["srm_p"] = check_srm(
            [s["baseline_users"]]
            + [s[f"v{i}_users"] for i in range(1, num_variations)],
            analysis.weights,
        )
        return s
    df_2 = df.apply(analyze_row, axis=1)
    df_2.to_csv(dir_desktop + "updated_df.csv")
    return df.apply(analyze_row, axis=1)


# Convert final experiment results to a structure that can be easily
# serialized and used to display results in the GrowthBook front-end
def format_results(
    df: pd.DataFrame, baseline_index: int = 0
) -> List[DimensionResponse]:
    num_variations = df.at[0, "variations"]
    results: List[DimensionResponse] = []
    rows = df.to_dict("records")
    for row in rows:
        dim = DimensionResponse(
            dimension=row["dimension"], srm=row["srm_p"], variations=[]
        )
        baseline_data = format_variation_result(row, 0)
        variation_data = [
            format_variation_result(row, v) for v in range(1, num_variations)
        ]
        variation_data.insert(baseline_index, baseline_data)
        dim.variations = variation_data
        results.append(dim)
    return results


def format_variation_result(
    row: Dict[Hashable, Any], v: int
) -> Union[BaselineResponse, BayesianVariationResponse, FrequentistVariationResponse]:
    prefix = f"v{v}" if v > 0 else "baseline"

    # if quantile_n
    stats = MetricStats(
        users=row[f"{prefix}_users"],
        count=row[f"{prefix}_count"],
        stddev=row[f"{prefix}_stddev"],
        mean=row[f"{prefix}_mean"],
    )
    metricResult = {
        "cr": row[f"{prefix}_cr"],
        "value": row[f"{prefix}_main_sum"],
        "users": row[f"{prefix}_users"],
        "denominator": row[f"{prefix}_denominator_sum"],
        "stats": stats,
    }
    if v == 0:
        # baseline variation
        return BaselineResponse(**metricResult)
    else:
        # non-baseline variation
        if row[f"{prefix}_decision_making_conditions"]:
            power_response = PowerResponse(
                status=row[f"{prefix}_power_status"],
                errorMessage=row[f"{prefix}_power_error_message"],
                firstPeriodPairwiseSampleSize=row[
                    f"{prefix}_first_period_pairwise_users"
                ],
                targetMDE=row[f"{prefix}_target_mde"],
                sigmahat2Delta=row[f"{prefix}_sigmahat_2_delta"],
                priorProper=row[f"{prefix}_prior_proper"],
                priorLiftMean=row[f"{prefix}_prior_lift_mean"],
                priorLiftVariance=row[f"{prefix}_prior_lift_variance"],
                upperBoundAchieved=row[f"{prefix}_power_upper_bound_achieved"],
                scalingFactor=row[f"{prefix}_scaling_factor"],
            )
        else:
            power_response = None

        # sanitize CIs to replace inf with None
        ci: ResponseCI = (
            None if np.isinf(row[f"{prefix}_ci"][0]) else row[f"{prefix}_ci"][0],
            None if np.isinf(row[f"{prefix}_ci"][1]) else row[f"{prefix}_ci"][1],
        )
        testResult = {
            "expected": row[f"{prefix}_expected"],
            "uplift": row[f"{prefix}_uplift"],
            "ci": ci,
            "errorMessage": row[f"{prefix}_error_message"],
        }
        if row["engine"] == "frequentist":
            return FrequentistVariationResponse(
                **metricResult,
                **testResult,
                power=power_response,
                pValue=row[f"{prefix}_p_value"],
                pValueErrorMessage=row[f"{prefix}_p_value_error_message"],
            )
        else:
            return BayesianVariationResponse(
                **metricResult,
                **testResult,
                power=power_response,
                chanceToWin=row[f"{prefix}_prob_beat_baseline"],
                risk=row[f"{prefix}_risk"],
                riskType=row[f"{prefix}_risk_type"],
            )


def variation_statistic_from_metric_row(
    row: pd.Series, prefix: str, metric: MetricSettingsForStatsEngine
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
        return RatioStatistic(
            m_statistic=base_statistic_from_metric_row(
                row, prefix, "main", metric.main_metric_type
            ),
            d_statistic=base_statistic_from_metric_row(
                row, prefix, "denominator", metric.denominator_metric_type
            ),
            m_d_sum_of_products=row[f"{prefix}_main_denominator_sum_product"],
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
    row: pd.Series, prefix: str, component: str, metric_type: Optional[MetricType]
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
) -> pd.DataFrame:
    # diff data, convert raw sql into df of dimensions, and get rid of extra dimensions
    var_names = analysis.var_names
    max_dimensions = analysis.max_dimensions

    # Convert raw SQL result into a dataframe of dimensions
    df = get_metric_df(
        rows=rows,
        var_id_map=var_id_map,
        var_names=var_names,
        dimension=analysis.dimension,
        post_stratify=analysis.post_stratify,
    )

    # Limit to the top X dimensions with the most users
    # not possible to just re-sum for quantile metrics,
    # so we throw away "other" dimension
    keep_other = True
    if metric.statistic_type in ["quantile_event", "quantile_unit"]:
        keep_other = False
    if metric.keep_theta and metric.statistic_type == "mean_ra":
        keep_other = False
    reduced = reduce_dimensionality(
        df=df,
        max=max_dimensions,
        keep_other=keep_other,
    )

    # Run the analysis for each variation and dimension
    result = analyze_metric_df(
        df=reduced,
        metric=metric,
        analysis=analysis,
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
            format_results(
                process_analysis(
                    rows=pdrows,
                    var_id_map=get_var_id_map(a.var_ids),
                    metric=metric,
                    analysis=a,
                ),
                baseline_index=a.baseline_index,
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
    reduced: pd.DataFrame,
    metric: MetricSettingsForStatsEngine,
) -> List[BanditStatistic]:
    num_variations = reduced.at[0, "variations"]
    s = reduced.iloc[0]
    stats = []
    for i in range(0, num_variations):
        prefix = f"v{i}" if i > 0 else "baseline"
        stat = variation_statistic_from_metric_row(row=s, prefix=prefix, metric=metric)
        # recast proportion metrics in case they slipped through
        # for bandits we weight by period; iid data over periods no longer holds
        if isinstance(stat, ProportionStatistic):
            stat = SampleMeanStatistic(n=stat.n, sum=stat.sum, sum_squares=stat.sum)
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
        # convert raw sql into df of periods, and output df where n_rows = periods
        df = get_metric_df(
            rows=pdrows,
            var_id_map=get_var_id_map(bandit_settings.var_ids),
            var_names=bandit_settings.var_names,
            dimension=dimension,
        )
        bandit_stats = create_bandit_statistics(df, metric)
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
