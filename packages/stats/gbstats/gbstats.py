from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Union

import pandas as pd
from scipy.stats.distributions import chi2  # type: ignore

from gbstats.bayesian.tests import (
    BinomialBayesianABTest,
    BinomialBayesianConfig,
    GaussianBayesianABTest,
    GaussianBayesianConfig,
)
from gbstats.frequentist.tests import (
    FrequentistConfig,
    SequentialConfig,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
)
from gbstats.shared.constants import DifferenceType, StatsEngine
from gbstats.shared.models import (
    BayesianTestResult,
    FrequentistTestResult,
    ProportionStatistic,
    SampleMeanStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
    TestStatistic,
)
from gbstats.messages import raise_error_if_bayesian_ra


@dataclass
class AnalysisSettingsForStatsEngine:
    var_names: List[str]
    weights: List[float]
    baseline_index: int
    dimension: str
    stats_engine: str
    sequential_testing_enabled: bool
    sequential_tuning_parameter: float
    difference_type: str
    phase_length_days: float
    alpha: float
    max_dimensions: int


@dataclass
class MetricDataForStatsEngine:
    metric: str
    rows: List[Dict[str, Union[str, int, float]]]
    inverse: bool
    multiple_exposures: int


@dataclass
class DataForStatsEngine:
    var_id_map: Dict[str, int]
    metrics: List[MetricDataForStatsEngine]
    analyses: List[AnalysisSettingsForStatsEngine]


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


# Looks for any variation ids that are not in the provided map
def detect_unknown_variations(rows, var_id_map, ignore_ids={"__multiple__"}):
    unknown_var_ids = []
    for row in rows.itertuples(index=False):
        id = str(row.variation)
        if id not in ignore_ids and id not in var_id_map:
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
    rows,
    var_id_map,
    var_names,
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
                "statistic_type": row.statistic_type,
                "main_metric_type": row.main_metric_type,
                "denominator_metric_type": getattr(
                    row, "denominator_metric_type", None
                ),
                "covariate_metric_type": getattr(row, "covariate_metric_type", None),
                "total_users": 0,
            }
            # Add columns for each variation (including baseline)
            for key in var_id_map:
                i = var_id_map[key]
                prefix = f"v{i}" if i > 0 else "baseline"
                dimensions[dim][f"{prefix}_id"] = key
                dimensions[dim][f"{prefix}_name"] = var_names[i]
                for col in SUM_COLS:
                    dimensions[dim][f"{prefix}_{col}"] = 0

        # Add this SQL result row into the dimension dict if we recognize the variation
        key = str(row.variation)
        if key in var_id_map:
            i = var_id_map[key]

            dimensions[dim]["total_users"] += row.users
            prefix = f"v{i}" if i > 0 else "baseline"
            for col in SUM_COLS:
                dimensions[dim][f"{prefix}_{col}"] = getattr(row, col, 0)
            # Special handling for count, if missing returns a method, so override with user value
            if callable(getattr(row, "count")):
                dimensions[dim][f"{prefix}_count"] = getattr(row, "users", 0)

    return pd.DataFrame(dimensions.values())


# Limit to the top X dimensions with the most users
# Merge the rest into an "(other)" dimension
def reduce_dimensionality(df, max=20):
    num_variations = df.at[0, "variations"]

    rows = df.to_dict("records")
    rows.sort(key=lambda i: i["total_users"], reverse=True)

    newrows = []

    for i, row in enumerate(rows):
        # For the first few dimensions, keep them as-is
        if i < max:
            newrows.append(row)
        # For the rest, merge them into the last dimension
        else:
            current = newrows[max - 1]
            current["dimension"] = "(other)"
            current["total_users"] += row["total_users"]
            for v in range(num_variations):
                prefix = f"v{v}" if v > 0 else "baseline"
                for col in SUM_COLS:
                    current[f"{prefix}_{col}"] += row[f"{prefix}_{col}"]

    return pd.DataFrame(newrows)


# Run A/B test analysis for each variation and dimension
def analyze_metric_df(
    df: pd.DataFrame,
    weights: List[float],
    inverse: bool = False,
    engine: StatsEngine = StatsEngine.BAYESIAN,
    engine_config: Dict[str, Any] = {},
) -> pd.DataFrame:
    num_variations = df.at[0, "variations"]
    # parse config
    test_config = engine_config.copy()
    if engine == StatsEngine.BAYESIAN:
        test_config["inverse"] = inverse
    sequential: bool = test_config.pop("sequential", False)

    # Add new columns to the dataframe with placeholder values
    df["srm_p"] = 0
    df["engine"] = engine.value
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
            df[f"v{i}_rawrisk"] = None
            df[f"v{i}_prob_beat_baseline"] = None
            df[f"v{i}_uplift"] = None
            df[f"v{i}_error_message"] = None

    def analyze_row(s: pd.Series) -> pd.Series:
        s = s.copy()
        # Baseline values
        stat_a = variation_statistic_from_metric_row(s, "baseline")
        raise_error_if_bayesian_ra(stat_a, engine)

        s["baseline_cr"] = stat_a.unadjusted_mean
        s["baseline_mean"] = stat_a.unadjusted_mean

        # baseline SD won't be adjusted for regression adjustment
        # because it's unclear what it should be unless compared to a
        # specific variation
        s["baseline_stddev"] = stat_a.stddev

        # List of users in each variation (used for SRM check)
        users = [0] * num_variations
        users[0] = stat_a.n

        # Loop through each non-baseline variation and run an analysis
        for i in range(1, num_variations):
            stat_b = variation_statistic_from_metric_row(s, f"v{i}")
            raise_error_if_bayesian_ra(stat_b, engine)

            users[i] = stat_b.n

            # Get right A/B test
            binomial_test: bool = isinstance(
                stat_a, ProportionStatistic
            ) and isinstance(stat_b, ProportionStatistic)
            ABTestClass, ABTestConfig = get_test_class_config(
                engine, sequential, binomial_test
            )
            # Run the A/B test analysis of baseline vs variation
            test_config_copy = test_config.copy()
            test_config_copy["traffic_proportion_b"] = weights[i]
            test = ABTestClass(stat_a, stat_b, ABTestConfig(**test_config_copy))  # type: ignore
            res = test.compute_result()

            s[f"v{i}_cr"] = test.stat_b.unadjusted_mean
            s[f"v{i}_mean"] = test.stat_b.unadjusted_mean
            s[f"v{i}_stddev"] = test.stat_b.stddev
            # Unpack result in Pandas row
            if isinstance(res, BayesianTestResult):
                s.at[f"v{i}_rawrisk"] = res.risk
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

        s["srm_p"] = check_srm(users, weights)
        return s

    return df.apply(analyze_row, axis=1)


# Convert final experiment results to a structure that can be easily
# serialized and used to display results in the GrowthBook front-end
def format_results(df, baseline_index=0):
    num_variations = df.at[0, "variations"]
    results = []
    rows = df.to_dict("records")
    for row in rows:
        dim = {"dimension": row["dimension"], "srm": row["srm_p"], "variations": []}
        baseline_data = format_variation_result(row, 0)
        variation_data = [
            format_variation_result(row, v) for v in range(1, num_variations)
        ]
        variation_data.insert(baseline_index, baseline_data)
        dim["variations"] = variation_data
        results.append(dim)
    return results


def format_variation_result(row: pd.Series, v: int):
    prefix = f"v{v}" if v > 0 else "baseline"
    stats = {
        "users": row[f"{prefix}_users"],
        "count": row[f"{prefix}_count"],
        "stddev": row[f"{prefix}_stddev"],
        "mean": row[f"{prefix}_mean"],
    }
    result = {
        "cr": row[f"{prefix}_cr"],
        "value": row[f"{prefix}_main_sum"],
        "users": row[f"{prefix}_users"],
        "denominator": row[f"{prefix}_denominator_sum"],
        "stats": stats,
    }
    if v == 0:
        # baseline variation
        return result
    else:
        # non-baseline variation
        return {
            **result,
            **{
                "expected": row[f"{prefix}_expected"],
                "chanceToWin": row[f"{prefix}_prob_beat_baseline"],
                "pValue": row[f"{prefix}_p_value"],
                "uplift": row[f"{prefix}_uplift"],
                "ci": row[f"{prefix}_ci"],
                "risk": row[f"{prefix}_rawrisk"],
                "errorMessage": row[f"{prefix}_error_message"],
            },
        }


def variation_statistic_from_metric_row(row: pd.Series, prefix: str) -> TestStatistic:
    statistic_type = row["statistic_type"]
    if statistic_type == "ratio":
        return RatioStatistic(
            m_statistic=base_statistic_from_metric_row(row, prefix, "main"),
            d_statistic=base_statistic_from_metric_row(row, prefix, "denominator"),
            m_d_sum_of_products=row[f"{prefix}_main_denominator_sum_product"],
            n=row[f"{prefix}_users"],
        )
    elif statistic_type == "mean":
        return base_statistic_from_metric_row(row, prefix, "main")
    elif statistic_type == "mean_ra":
        return RegressionAdjustedStatistic(
            post_statistic=base_statistic_from_metric_row(row, prefix, "main"),
            pre_statistic=base_statistic_from_metric_row(row, prefix, "covariate"),
            post_pre_sum_of_products=row[f"{prefix}_main_covariate_sum_product"],
            n=row[f"{prefix}_users"],
            # Theta should be overriden with correct value later
            theta=0,
        )
    else:
        raise ValueError(
            f"Unexpected statistic_type {statistic_type}' found in experiment data."
        )


def base_statistic_from_metric_row(
    row: pd.Series, prefix: str, component: str
) -> Union[ProportionStatistic, SampleMeanStatistic]:
    metric_type = row[f"{component}_metric_type"]
    if metric_type == "binomial":
        return ProportionStatistic(
            sum=row[f"{prefix}_{component}_sum"], n=row[f"{prefix}_count"]
        )
    elif metric_type in ["count", "duration", "revenue"]:
        return SampleMeanStatistic(
            sum=row[f"{prefix}_{component}_sum"],
            sum_squares=row[f"{prefix}_{component}_sum_squares"],
            n=row[f"{prefix}_count"],
        )
    else:
        raise ValueError(
            f"Unexpected metric_type '{metric_type}' type for '{component}_type in experiment data."
        )


def get_test_class_config(engine: StatsEngine, sequential: bool, binomial_test: bool):
    if engine == StatsEngine.BAYESIAN:
        if binomial_test:
            return BinomialBayesianABTest, BinomialBayesianConfig
        else:
            return GaussianBayesianABTest, GaussianBayesianConfig
    else:
        if sequential:
            return SequentialTwoSidedTTest, SequentialConfig
        else:
            return TwoSidedTTest, FrequentistConfig


# Run a chi-squared test to make sure the observed traffic split matches the expected one
def check_srm(users, weights):
    # Convert count of users into ratios
    total_observed = sum(users)
    if not total_observed:
        return 1

    total_weight = sum(weights)
    x = 0
    for i, o in enumerate(users):
        if weights[i] <= 0:
            continue
        e = weights[i] / total_weight * total_observed
        x = x + ((o - e) ** 2) / e

    return chi2.sf(x, len(users) - 1)


# Run a specific analysis given data and configuration settings
def process_analysis(
    rows: pd.DataFrame,
    inverse: bool,
    var_id_map: Dict[str, int],
    analysis: AnalysisSettingsForStatsEngine,
):
    var_names = analysis.var_names
    weights = analysis.weights
    max_dimensions = analysis.max_dimensions
    baseline_index = analysis.baseline_index
    stats_engine = (
        StatsEngine.FREQUENTIST
        if analysis.stats_engine == "frequentist"
        else StatsEngine.BAYESIAN
    )

    # If we're doing a daily time series, we need to diff the data
    if analysis.dimension == "pre:datedaily":
        rows = diff_for_daily_time_series(rows)

    # Convert raw SQL result into a dataframe of dimensions
    df = get_metric_df(
        rows=rows,
        var_id_map=var_id_map,
        var_names=var_names,
    )

    # Limit to the top X dimensions with the most users
    reduced = reduce_dimensionality(
        df=df,
        max=max_dimensions,
    )

    # Get the stats engine configuration for this analysis
    engine_config: Dict[str, Union[int, float, DifferenceType]] = {
        "phase_length_days": analysis.phase_length_days
    }

    if analysis.difference_type == "absolute":
        engine_config["difference_type"] = DifferenceType.ABSOLUTE
    elif analysis.difference_type == "scaled":
        engine_config["difference_type"] = DifferenceType.SCALED
    else:
        engine_config["difference_type"] = DifferenceType.RELATIVE

    if stats_engine == StatsEngine.FREQUENTIST and analysis.sequential_testing_enabled:
        engine_config["sequential"] = True
        engine_config[
            "sequential_tuning_parameter"
        ] = analysis.sequential_tuning_parameter

    if stats_engine == StatsEngine.FREQUENTIST and analysis.alpha:
        engine_config["alpha"] = analysis.alpha

    # Run the analysis for each variation and dimension
    result = analyze_metric_df(
        df=reduced,
        weights=weights,
        inverse=inverse,
        engine=stats_engine,
        engine_config=engine_config,
    )

    return format_results(result, baseline_index)


def process_single_metric(
    mdata: MetricDataForStatsEngine,
    analyses: List[AnalysisSettingsForStatsEngine],
    var_id_map: Dict[str, int],
):
    # If no data return blank results
    if len(mdata.rows) == 0:
        return {
            "metric": mdata.metric,
            "analyses": [
                {
                    "unknownVariations": [],
                    "dimensions": [],
                    "multipleExposures": 0,
                }
                for _ in analyses
            ],
        }
    rows = pd.DataFrame(mdata.rows)
    inverse = mdata.inverse
    multiple_exposures = mdata.multiple_exposures

    # Detect any variations that are not in the returned metric rows
    unknown_var_ids = detect_unknown_variations(rows=rows, var_id_map=var_id_map)

    results = [
        process_analysis(
            rows=rows,
            inverse=inverse,
            var_id_map=var_id_map,
            analysis=a,
        )
        for a in analyses
    ]

    return {
        "metric": mdata.metric,
        "analyses": [
            {
                "unknownVariations": list(unknown_var_ids),
                "dimensions": r,
                "multipleExposures": multiple_exposures,
            }
            for r in results
        ],
    }


def process_experiment_results(data: Dict[str, Any]):
    d = DataForStatsEngine(
        var_id_map=data["var_id_map"],
        metrics=[MetricDataForStatsEngine(**m) for m in data["metrics"]],
        analyses=[AnalysisSettingsForStatsEngine(**a) for a in data["analyses"]],
    )

    return [
        process_single_metric(mdata, d.analyses, d.var_id_map) for mdata in d.metrics
    ]
