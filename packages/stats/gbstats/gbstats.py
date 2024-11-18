from dataclasses import asdict
import re
import traceback
import copy
from typing import Any, Dict, Hashable, List, Optional, Set, Tuple, Union

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
from gbstats.frequentist.tests import (
    FrequentistConfig,
    FrequentistTestResult,
    SequentialConfig,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
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
    SingleVariationResult,
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
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
    TestStatistic,
    BanditStatistic,
)
from gbstats.utils import check_srm


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
]

ROW_COLS = SUM_COLS + [
    "quantile_n",
    "quantile_nstar",
    "quantile",
    "quantile_lower",
    "quantile_upper",
    "theta",
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


def diff_for_daily_time_series(df: pd.DataFrame) -> pd.DataFrame:
    dfc = df.copy()
    diff_cols = [
        x
        for x in [
            "main_sum",
            "main_sum_squares",
            "denominator_sum",
            "denominator_sum_squares",
            "main_denominator_sum_product",
            "main_covariate_sum_product",
        ]
        if x in dfc.columns
    ]
    dfc.sort_values("dimension", inplace=True)
    dfc[diff_cols] = dfc.groupby(["variation"])[diff_cols].diff().fillna(dfc[diff_cols])
    return dfc


# Transform raw SQL result for metrics into a dataframe of dimensions
def get_metric_df(
    rows: pd.DataFrame,
    var_id_map: VarIdMap,
    var_names: List[str],
):
    dfc = rows.copy()
    dimensions = {}
    # Each row in the raw SQL result is a dimension/variation combo
    # We want to end up with one row per dimension
    for row in dfc.itertuples(index=False):
        dim = row.dimension
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
            for col in ROW_COLS:
                dimensions[dim][f"{prefix}_{col}"] = getattr(row, col, 0)
            # Special handling for count, if missing returns a method, so override with user value
            if callable(getattr(row, "count")):
                dimensions[dim][f"{prefix}_count"] = getattr(row, "users", 0)
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
    row: pd.Series,
    test_index: int,
    analysis: AnalysisSettingsForStatsEngine,
    metric: MetricSettingsForStatsEngine,
) -> Union[EffectBayesianABTest, SequentialTwoSidedTTest, TwoSidedTTest]:

    stat_a = variation_statistic_from_metric_row(row, "baseline", metric)
    stat_b = variation_statistic_from_metric_row(row, f"v{test_index}", metric)

    base_config = {
        "total_users": row["total_users"],
        "traffic_percentage": analysis.traffic_percentage,
        "phase_length_days": analysis.phase_length_days,
        "difference_type": analysis.difference_type,
    }

    if analysis.stats_engine == "frequentist":
        if analysis.sequential_testing_enabled:
            return SequentialTwoSidedTTest(
                stat_a,
                stat_b,
                SequentialConfig(
                    **base_config,
                    alpha=analysis.alpha,
                    sequential_tuning_parameter=analysis.sequential_tuning_parameter,
                ),
            )
        else:
            return TwoSidedTTest(
                stat_a,
                stat_b,
                FrequentistConfig(
                    **base_config,
                    alpha=analysis.alpha,
                ),
            )
    else:
        assert type(stat_a) is type(stat_b), "stat_a and stat_b must be of same type."
        prior = GaussianPrior(
            mean=metric.prior_mean,
            variance=pow(metric.prior_stddev, 2),
            proper=metric.prior_proper,
        )
        return EffectBayesianABTest(
            stat_a,
            stat_b,
            EffectBayesianConfig(
                **base_config,
                inverse=metric.inverse,
                prior_effect=prior,
                prior_type="relative",
            ),
        )


# Run A/B test analysis for each variation and dimension
def analyze_metric_df(
    df: pd.DataFrame,
    metric: MetricSettingsForStatsEngine,
    analysis: AnalysisSettingsForStatsEngine,
) -> pd.DataFrame:
    num_variations = df.at[0, "variations"]

    # Add new columns to the dataframe with placeholder values
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
            df[f"v{i}_risk"] = None
            df[f"v{i}_prob_beat_baseline"] = None
            df[f"v{i}_uplift"] = None
            df[f"v{i}_error_message"] = None

    def analyze_row(s: pd.Series) -> pd.Series:
        s = s.copy()

        # Loop through each non-baseline variation and run an analysis
        for i in range(1, num_variations):

            # Run analysis of baseline vs variation
            test = get_configured_test(
                row=s, test_index=i, analysis=analysis, metric=metric
            )
            res = test.compute_result()
            s["baseline_cr"] = test.stat_a.unadjusted_mean
            s["baseline_mean"] = test.stat_a.unadjusted_mean
            s["baseline_stddev"] = test.stat_a.stddev

            s[f"v{i}_cr"] = test.stat_b.unadjusted_mean
            s[f"v{i}_mean"] = test.stat_b.unadjusted_mean
            s[f"v{i}_stddev"] = test.stat_b.stddev

            # Unpack result in Pandas row
            if isinstance(res, BayesianTestResult):
                s.at[f"v{i}_risk"] = res.risk
                s[f"v{i}_risk_type"] = res.risk_type
                s[f"v{i}_prob_beat_baseline"] = res.chance_to_win
            elif isinstance(res, FrequentistTestResult):
                s[f"v{i}_p_value"] = res.p_value
            if test.stat_a.unadjusted_mean <= 0:
                # negative or missing control mean
                s[f"v{i}_expected"] = 0
            elif res.expected == 0:
                # if result is not valid, try to return at least the diff
                s[f"v{i}_expected"] = (
                    test.stat_b.mean - test.stat_a.mean
                ) / test.stat_a.unadjusted_mean
            else:
                # return adjusted/prior-affected guess of expectation
                s[f"v{i}_expected"] = res.expected
            s.at[f"v{i}_ci"] = res.ci
            s.at[f"v{i}_uplift"] = asdict(res.uplift)
            s[f"v{i}_error_message"] = res.error_message

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
        frequentist = row[f"{prefix}_p_value"] is not None
        testResult = {
            "expected": row[f"{prefix}_expected"],
            "uplift": row[f"{prefix}_uplift"],
            "ci": row[f"{prefix}_ci"],
            "errorMessage": row[f"{prefix}_error_message"],
        }
        if frequentist:
            return FrequentistVariationResponse(
                **metricResult,
                **testResult,
                pValue=row[f"{prefix}_p_value"],
            )
        else:
            return BayesianVariationResponse(
                **metricResult,
                **testResult,
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

    # If we're doing a daily time series, we need to diff the data
    if analysis.dimension == "pre:datedaily":
        rows = diff_for_daily_time_series(rows)

    # Convert raw SQL result into a dataframe of dimensions
    df = get_metric_df(rows=rows, var_id_map=var_id_map, var_names=var_names)

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

    results = [
        format_results(
            process_analysis(
                rows=pdrows,
                var_id_map=get_var_id_map(a.var_ids),
                metric=metric,
                analysis=a,
            ),
            baseline_index=a.baseline_index,
        )
        for a in analyses
    ]
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
        pdrows = pdrows.loc[pdrows["dimension"] == dimension]
        # convert raw sql into df of periods, and output df where n_rows = periods
        df = get_metric_df(
            rows=pdrows,
            var_id_map=get_var_id_map(bandit_settings.var_ids),
            var_names=bandit_settings.var_names,
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
        return BanditsRatio(bandit_stats, bandit_settings.historical_weights, bandit_settings.current_weights, bandit_config)  # type: ignore
    elif isinstance(bandit_stats[0], RegressionAdjustedStatistic):
        return BanditsCuped(bandit_stats, bandit_settings.historical_weights, bandit_settings.current_weights, bandit_config)  # type: ignore
    else:
        return BanditsSimple(bandit_stats, bandit_settings.historical_weights, bandit_settings.current_weights, bandit_config)  # type: ignore


def get_bandit_result(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    settings: AnalysisSettingsForStatsEngine,
    bandit_settings: BanditSettingsForStatsEngine,
) -> BanditResult:
    single_variation_results = None
    b = preprocess_bandits(rows, metric, bandit_settings, settings.alpha, "")
    if b:
        if any(value is None for value in b.stats):
            return get_error_bandit_result(
                single_variation_results=None,
                update_message="not updated",
                srm=1,
                error="not all statistics are instance of type BanditStatistic",
                reweight=bandit_settings.reweight,
                current_weights=bandit_settings.current_weights,
            )
        srm_p_value = b.compute_srm()
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
                    srm=srm_p_value,
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
                    updatedWeights=bandit_result.bandit_weights
                    if bandit_settings.reweight
                    else bandit_settings.current_weights,
                    srm=srm_p_value,
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
                srm=1,
                error=error_message,
                reweight=bandit_settings.reweight,
                current_weights=bandit_settings.current_weights,
            )
    return get_error_bandit_result(
        single_variation_results=None,
        update_message="not updated",
        srm=1,
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
                rows = filter_query_rows(query_result.rows, i)
                if len(rows):
                    if d.bandit_settings:
                        metric_settings_bandit = copy.deepcopy(d.metrics[metric])
                        # when using multi-period data, binomial is no longer iid and variance is wrong
                        if metric_settings_bandit.main_metric_type == "binomial":
                            metric_settings_bandit.main_metric_type = "count"
                        if metric_settings_bandit.covariate_metric_type == "binomial":
                            metric_settings_bandit.covariate_metric_type = "count"
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
                                metric=d.metrics[metric],
                                analyses=d.analyses,
                            )
                        )
    if d.bandit_settings and bandit_result is None:
        bandit_result = get_error_bandit_result(
            single_variation_results=None,
            update_message="not updated",
            error="no rows",
            srm=1,
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
