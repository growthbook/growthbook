from dataclasses import asdict
from functools import partial
from typing import Optional, List
from unittest import TestCase, main as unittest_main
from gbstats.models.results import Uplift

import pandas as pd
import numpy as np
import copy

from gbstats.messages import (
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    BASELINE_VARIATION_ZERO_MESSAGE,
)

from gbstats.models.statistics import (
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
    RatioStatistic,
    RegressionAdjustedRatioStatistic,
)
from gbstats.models.tests import (
    EffectMomentsResult,
    TestStatistic,
    ProportionStatistic,
    EffectMomentsConfig,
    EffectMomentsPostStratification,
)
from gbstats.frequentist.tests import FrequentistConfig, FrequentistTestResult
from gbstats.models.settings import (
    MetricSettingsForStatsEngine,
    AnalysisSettingsForStatsEngine,
)
from gbstats.devtools.simulation import CreateRow
from gbstats.gbstats import (
    get_metric_dfs,
    variation_statistic_from_metric_row,
    process_single_metric,
)

DECIMALS = 5

COUNT_METRIC = MetricSettingsForStatsEngine(
    id="count_metric",
    name="count_metric",
    inverse=False,
    statistic_type="mean",
    main_metric_type="count",
)
RATIO_METRIC = MetricSettingsForStatsEngine(
    id="",
    name="",
    inverse=False,
    statistic_type="ratio",
    main_metric_type="count",
    denominator_metric_type="count",
)
RA_METRIC = MetricSettingsForStatsEngine(
    id="",
    name="",
    inverse=False,
    statistic_type="mean_ra",
    main_metric_type="count",
    covariate_metric_type="count",
)

RATIO_RA_METRIC = copy.deepcopy(RATIO_METRIC)
RATIO_RA_METRIC.statistic_type = "ratio_ra"


def round_if_not_none(x: Optional[float], decimals: int):
    return np.round(x, decimals) if x is not None else None


round_ = partial(round_if_not_none, decimals=DECIMALS)


def _round_result_dict(result_dict):
    for k, v in result_dict.items():
        if k == "error_message":
            pass
        elif k == "uplift":
            v = {
                kk: round_(vv) if isinstance(vv, float) else vv for kk, vv in v.items()
            }
        else:
            v = [round_(x) for x in v] if isinstance(v, list) else round_(v)
        result_dict[k] = v
    return result_dict


class TestPostStratification(TestCase):
    @staticmethod
    def run_post_strat_gbstats(
        stat_a: List[TestStatistic],
        stat_b: List[TestStatistic],
        config: FrequentistConfig,
        browsers=None,
        regions=None,
        dimension: str = "",
        dimension_level: str = "",
    ) -> FrequentistTestResult:
        type_a = stat_a[0]
        statistic_type = None
        denominator_metric_type = None
        covariate_metric_type = None
        if isinstance(type_a, RatioStatistic):
            statistic_type = "ratio"
            denominator_metric_type = "count"
            covariate_metric_type = None
        elif isinstance(type_a, RegressionAdjustedRatioStatistic):
            statistic_type = "ratio_ra"
            denominator_metric_type = "count"
            covariate_metric_type = "count"
        elif isinstance(type_a, SampleMeanStatistic):
            statistic_type = "mean"
            denominator_metric_type = None
            covariate_metric_type = None
        elif isinstance(type_a, RegressionAdjustedStatistic):
            statistic_type = "mean_ra"
            denominator_metric_type = None
            covariate_metric_type = "count"

        metric = MetricSettingsForStatsEngine(
            id="fact__ab8nzw215xmcozhcmz",
            name="revenue_bigquery",
            statistic_type=statistic_type,  # type: ignore
            main_metric_type="count",
            inverse=False,
            prior_proper=False,
            prior_mean=0,
            prior_stddev=0,
            keep_theta=False,
            denominator_metric_type=denominator_metric_type,
            covariate_metric_type=covariate_metric_type,
            quantile_value=None,
            business_metric_type=["goal"],
            target_mde=0.1,
        )
        analysis = AnalysisSettingsForStatsEngine(
            var_names=["Control", "Variation 1"],
            var_ids=["0", "1"],
            weights=[0.5, 0.5],
            baseline_index=0,
            dimension=dimension,
            stats_engine="frequentist",
            p_value_corrected=False,
            sequential_testing_enabled=False,
            sequential_tuning_parameter=5000.0,
            difference_type=config.difference_type,
            phase_length_days=191.875,
            alpha=0.05,
            max_dimensions=20,
            traffic_percentage=1.0,
            num_goal_metrics=1,
            one_sided_intervals=False,
            post_stratification_enabled=True,
        )
        if isinstance(stat_a[0], SampleMeanStatistic) or isinstance(
            stat_a[0], ProportionStatistic
        ):
            metric = COUNT_METRIC
        elif isinstance(stat_a[0], RegressionAdjustedStatistic):
            metric = RA_METRIC
        elif isinstance(stat_a[0], RatioStatistic):
            metric = RATIO_METRIC
        elif isinstance(stat_a[0], RegressionAdjustedRatioStatistic):
            metric = RATIO_RA_METRIC
        else:
            raise ValueError(f"Unsupported statistic type: {type(stat_a)}")

        num_cells = len(stat_a)
        if browsers is None:
            browsers = [f"browser_{i}" for i in range(num_cells)]
        if regions is None:
            rows_a = [
                CreateRow(
                    s,
                    variation="0",
                    dimension_name="dim_exp_browser",
                    dimension_value=b,
                ).create_row()
                for s, b in zip(stat_a, browsers)
            ]
            rows_b = [
                CreateRow(
                    s,
                    variation="1",
                    dimension_name="dim_exp_browser",
                    dimension_value=b,
                ).create_row()
                for s, b in zip(stat_b, browsers)
            ]

        else:
            rows_a = [
                CreateRow(
                    s,
                    variation="0",
                    dimension_name="dim_exp_browser",
                    dimension_value=b,
                    dimension_two_name="dim_exp_region",
                    dimension_two_value=r,
                ).create_row()
                for s, b, r in zip(stat_a, browsers, regions)
            ]
            rows_b = [
                CreateRow(
                    s,
                    variation="1",
                    dimension_name="dim_exp_browser",
                    dimension_value=b,
                    dimension_two_name="dim_exp_region",
                    dimension_two_value=r,
                ).create_row()
                for s, b, r in zip(stat_b, browsers, regions)
            ]
        rows = pd.DataFrame(rows_a + rows_b)
        rows = rows.to_dict("records")

        results = process_single_metric(
            rows=rows,  # type: ignore
            metric=metric,
            analyses=[analysis],
        )
        num_dimensions = len(results.analyses[0].dimensions)
        dim_index = 0
        if num_dimensions > 1:
            for i, dim in enumerate(results.analyses[0].dimensions):
                if dim.dimension == dimension_level:
                    dim_index = i
                    break

        this_result = results.analyses[0].dimensions[dim_index].variations[1]
        uplift = this_result.uplift  # type: ignore
        expected = uplift.mean
        ci = this_result.ci  # type: ignore
        return FrequentistTestResult(
            expected=expected,
            ci=ci,  # type: ignore
            uplift=uplift,
            error_message=None,
            p_value=None,
            p_value_error_message=None,
        )

    def setUp(self):
        self.point_estimate_count_rel = 0.10994584851937338
        self.point_estimate_count_abs = 3.548094377986586
        self.point_estimate_count_reg_rel = 0.11529547657147853
        self.point_estimate_count_reg_abs = 3.7116918650826403
        self.point_estimate_ratio_rel = 0.13371299783026003
        self.point_estimate_ratio_abs = 0.10008903417216031
        self.point_estimate_ratio_reg_rel = 0.13929489348145818
        self.point_estimate_ratio_reg_abs = 0.10399412678969455

        self.standard_error_count_rel = 0.01216
        self.standard_error_count_abs = 0.37391
        self.standard_error_count_reg_rel = 0.0024
        self.standard_error_count_reg_abs = 0.07918
        self.standard_error_ratio_rel = 0.0069
        self.standard_error_ratio_abs = 0.00491
        self.standard_error_ratio_reg_rel = 0.00131
        self.standard_error_ratio_reg_abs = 0.00127

        self.stats_count_strata = [
            (
                SampleMeanStatistic(
                    n=21, sum=330.0696210595999, sum_squares=5377.811252605509
                ),
                SampleMeanStatistic(
                    n=42, sum=708.1220000911836, sum_squares=12249.255519049513
                ),
            ),
            (
                SampleMeanStatistic(
                    n=65, sum=1391.96628040659, sum_squares=30546.63404187155
                ),
                SampleMeanStatistic(
                    n=75, sum=1807.4703052657744, sum_squares=45000.287664918586
                ),
            ),
            (
                SampleMeanStatistic(
                    n=102, sum=2916.824124651419, sum_squares=86396.06886690554
                ),
                SampleMeanStatistic(
                    n=101, sum=3104.5399914554023, sum_squares=98365.40553530994
                ),
            ),
            (
                SampleMeanStatistic(
                    n=151, sum=5172.587929941052, sum_squares=182453.04528037464
                ),
                SampleMeanStatistic(
                    n=121, sum=4613.696610070716, sum_squares=180520.64781229294
                ),
            ),
            (
                SampleMeanStatistic(
                    n=160, sum=6539.348445231273, sum_squares=274981.98909352464
                ),
                SampleMeanStatistic(
                    n=162, sum=7431.953259880505, sum_squares=349244.6690736718
                ),
            ),
        ]
        self.stats_ratio_strata = [
            (
                RatioStatistic(
                    n=21,
                    m_statistic=SampleMeanStatistic(
                        n=21, sum=330.0696210595999, sum_squares=5377.811252605509
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=21, sum=890.9766550739607, sum_squares=38220.95223835553
                    ),
                    m_d_sum_of_products=14263.937571840695,
                ),
                RatioStatistic(
                    n=42,
                    m_statistic=SampleMeanStatistic(
                        n=42, sum=708.1220000911836, sum_squares=12249.255519049513
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=42, sum=1745.9858250014954, sum_squares=73194.53424221886
                    ),
                    m_d_sum_of_products=29826.620793423102,
                ),
            ),
            (
                RatioStatistic(
                    n=65,
                    m_statistic=SampleMeanStatistic(
                        n=65, sum=1391.96628040659, sum_squares=30546.63404187155
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=65, sum=2769.8126179473184, sum_squares=118719.96077578884
                    ),
                    m_d_sum_of_products=59924.702385890436,
                ),
                RatioStatistic(
                    n=75,
                    m_statistic=SampleMeanStatistic(
                        n=75, sum=1807.4703052657744, sum_squares=45000.287664918586
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=75, sum=3184.8395612061063, sum_squares=136710.92474497214
                    ),
                    m_d_sum_of_products=78119.14871556411,
                ),
            ),
            (
                RatioStatistic(
                    n=102,
                    m_statistic=SampleMeanStatistic(
                        n=102, sum=2916.824124651419, sum_squares=86396.06886690554
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=102, sum=4445.780384331884, sum_squares=195387.7733842407
                    ),
                    m_d_sum_of_products=129041.55268673625,
                ),
                RatioStatistic(
                    n=101,
                    m_statistic=SampleMeanStatistic(
                        n=101, sum=3104.5399914554023, sum_squares=98365.40553530994
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=101, sum=4235.277718489282, sum_squares=179690.4720421368
                    ),
                    m_d_sum_of_products=132444.36911739354,
                ),
            ),
            (
                RatioStatistic(
                    n=151,
                    m_statistic=SampleMeanStatistic(
                        n=151, sum=5172.587929941052, sum_squares=182453.04528037464
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=151, sum=6510.170220892494, sum_squares=283094.7243365024
                    ),
                    m_d_sum_of_products=226127.20135744457,
                ),
                RatioStatistic(
                    n=121,
                    m_statistic=SampleMeanStatistic(
                        n=121, sum=4613.696610070716, sum_squares=180520.64781229294
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=121, sum=5079.943060454901, sum_squares=215529.32009367683
                    ),
                    m_d_sum_of_products=196562.8269130501,
                ),
            ),
            (
                RatioStatistic(
                    n=160,
                    m_statistic=SampleMeanStatistic(
                        n=160, sum=6539.348445231273, sum_squares=274981.98909352464
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=160, sum=6906.305872710853, sum_squares=300900.3106781779
                    ),
                    m_d_sum_of_products=286483.9732935189,
                ),
                RatioStatistic(
                    n=162,
                    m_statistic=SampleMeanStatistic(
                        n=162, sum=7431.953259880505, sum_squares=349244.6690736718
                    ),
                    d_statistic=SampleMeanStatistic(
                        n=162, sum=6899.004661928157, sum_squares=296839.44355002965
                    ),
                    m_d_sum_of_products=321057.8410309036,
                ),
            ),
        ]
        self.stats_count_reg_strata = [
            (
                RegressionAdjustedStatistic(
                    n=21,
                    post_statistic=SampleMeanStatistic(
                        n=21, sum=330.0696210595999, sum_squares=5377.811252605509
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=21, sum=104.90748970535698, sum_squares=544.8528083123211
                    ),
                    post_pre_sum_of_products=1709.8485612477339,
                    theta=None,
                ),
                RegressionAdjustedStatistic(
                    n=42,
                    post_statistic=SampleMeanStatistic(
                        n=42, sum=708.1220000911836, sum_squares=12249.255519049513
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=42, sum=205.17072061676208, sum_squares=1040.6742753852225
                    ),
                    post_pre_sum_of_products=3561.161673449451,
                    theta=None,
                ),
            ),
            (
                RegressionAdjustedStatistic(
                    n=65,
                    post_statistic=SampleMeanStatistic(
                        n=65, sum=1391.96628040659, sum_squares=30546.63404187155
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=65, sum=315.83926510817054, sum_squares=1578.8689285910423
                    ),
                    post_pre_sum_of_products=6938.770455871619,
                    theta=None,
                ),
                RegressionAdjustedStatistic(
                    n=75,
                    post_statistic=SampleMeanStatistic(
                        n=75, sum=1807.4703052657744, sum_squares=45000.287664918586
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=75, sum=377.29540367369503, sum_squares=1981.0803020754106
                    ),
                    post_pre_sum_of_products=9428.146405105292,
                    theta=None,
                ),
            ),
            (
                RegressionAdjustedStatistic(
                    n=102,
                    post_statistic=SampleMeanStatistic(
                        n=102, sum=2916.824124651419, sum_squares=86396.06886690554
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=102, sum=523.2717238353379, sum_squares=2797.158898626946
                    ),
                    post_pre_sum_of_products=15535.162216800189,
                    theta=None,
                ),
                RegressionAdjustedStatistic(
                    n=101,
                    post_statistic=SampleMeanStatistic(
                        n=101, sum=3104.5399914554023, sum_squares=98365.40553530994
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=101, sum=501.0447878972627, sum_squares=2596.899156698453
                    ),
                    post_pre_sum_of_products=15962.754636573465,
                    theta=None,
                ),
            ),
            (
                RegressionAdjustedStatistic(
                    n=151,
                    post_statistic=SampleMeanStatistic(
                        n=151, sum=5172.587929941052, sum_squares=182453.04528037464
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=151, sum=758.3911049329452, sum_squares=3955.922281372593
                    ),
                    post_pre_sum_of_products=26846.415701194885,
                    theta=None,
                ),
                RegressionAdjustedStatistic(
                    n=121,
                    post_statistic=SampleMeanStatistic(
                        n=121, sum=4613.696610070716, sum_squares=180520.64781229294
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=121, sum=603.9456523430367, sum_squares=3144.0820997706583
                    ),
                    post_pre_sum_of_products=23789.82730157116,
                    theta=None,
                ),
            ),
            (
                RegressionAdjustedStatistic(
                    n=160,
                    post_statistic=SampleMeanStatistic(
                        n=160, sum=6539.348445231273, sum_squares=274981.98909352464
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=160, sum=823.2824168385916, sum_squares=4389.893995072177
                    ),
                    post_pre_sum_of_products=34727.84795433773,
                    theta=None,
                ),
                RegressionAdjustedStatistic(
                    n=162,
                    post_statistic=SampleMeanStatistic(
                        n=162, sum=7431.953259880505, sum_squares=349244.6690736718
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=162, sum=832.356528363269, sum_squares=4439.253146704266
                    ),
                    post_pre_sum_of_products=39332.667494781235,
                    theta=None,
                ),
            ),
        ]
        self.stats_ratio_reg_strata = [
            (
                RegressionAdjustedRatioStatistic(
                    n=21,
                    m_statistic_post=SampleMeanStatistic(
                        n=21, sum=330.0696210595999, sum_squares=5377.811252605509
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=21, sum=890.9766550739607, sum_squares=38220.95223835553
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=21, sum=104.90748970535698, sum_squares=544.8528083123211
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=21, sum=207.89392275808956, sum_squares=2084.9576141182224
                    ),
                    m_post_m_pre_sum_of_products=1709.8485612477339,
                    d_post_d_pre_sum_of_products=8924.759241535443,
                    m_pre_d_pre_sum_of_products=1060.4394881503144,
                    m_post_d_post_sum_of_products=14263.937571840695,
                    m_post_d_pre_sum_of_products=3331.5604732242236,
                    m_pre_d_post_sum_of_products=4536.239751943664,
                    theta=None,
                ),
                RegressionAdjustedRatioStatistic(
                    n=42,
                    m_statistic_post=SampleMeanStatistic(
                        n=42, sum=708.1220000911836, sum_squares=12249.255519049513
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=42, sum=1745.9858250014954, sum_squares=73194.53424221886
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=42, sum=205.17072061676208, sum_squares=1040.6742753852225
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=42, sum=412.711880878505, sum_squares=4096.604057794132
                    ),
                    m_post_m_pre_sum_of_products=3561.161673449451,
                    d_post_d_pre_sum_of_products=17309.48641894266,
                    m_pre_d_pre_sum_of_products=2052.459256425701,
                    m_post_d_post_sum_of_products=29826.620793423102,
                    m_post_d_pre_sum_of_products=7054.607772583746,
                    m_pre_d_post_sum_of_products=8661.515319014929,
                    theta=None,
                ),
            ),
            (
                RegressionAdjustedRatioStatistic(
                    n=65,
                    m_statistic_post=SampleMeanStatistic(
                        n=65, sum=1391.96628040659, sum_squares=30546.63404187155
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=65, sum=2769.8126179473184, sum_squares=118719.96077578884
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=65, sum=315.83926510817054, sum_squares=1578.8689285910423
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=65, sum=642.2456105047289, sum_squares=6391.278897716863
                    ),
                    m_post_m_pre_sum_of_products=6938.770455871619,
                    d_post_d_pre_sum_of_products=27539.520078090354,
                    m_pre_d_pre_sum_of_products=3159.649493130578,
                    m_post_d_post_sum_of_products=59924.702385890436,
                    m_post_d_pre_sum_of_products=13907.522729117181,
                    m_pre_d_post_sum_of_products=13603.664018221429,
                    theta=None,
                ),
                RegressionAdjustedRatioStatistic(
                    n=75,
                    m_statistic_post=SampleMeanStatistic(
                        n=75, sum=1807.4703052657744, sum_squares=45000.287664918586
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=75, sum=3184.8395612061063, sum_squares=136710.92474497214
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=75, sum=377.29540367369503, sum_squares=1981.0803020754106
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=75, sum=758.076359391088, sum_squares=7750.7726864492015
                    ),
                    m_post_m_pre_sum_of_products=9428.146405105292,
                    d_post_d_pre_sum_of_products=32540.687226429243,
                    m_pre_d_pre_sum_of_products=3894.390731281282,
                    m_post_d_post_sum_of_products=78119.14871556411,
                    m_post_d_pre_sum_of_products=18589.628595670973,
                    m_pre_d_post_sum_of_products=16346.199623884253,
                    theta=None,
                ),
            ),
            (
                RegressionAdjustedRatioStatistic(
                    n=102,
                    m_statistic_post=SampleMeanStatistic(
                        n=102, sum=2916.824124651419, sum_squares=86396.06886690554
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=102, sum=4445.780384331884, sum_squares=195387.7733842407
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=102, sum=523.2717238353379, sum_squares=2797.158898626946
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=102, sum=1036.3070573097948, sum_squares=10619.969725470164
                    ),
                    m_post_m_pre_sum_of_products=15535.162216800189,
                    d_post_d_pre_sum_of_products=45542.18577719637,
                    m_pre_d_pre_sum_of_products=5404.918238379167,
                    m_post_d_post_sum_of_products=129041.55268673625,
                    m_post_d_pre_sum_of_products=30084.67030990572,
                    m_pre_d_post_sum_of_products=23168.39181193194,
                    theta=None,
                ),
                RegressionAdjustedRatioStatistic(
                    n=101,
                    m_statistic_post=SampleMeanStatistic(
                        n=101, sum=3104.5399914554023, sum_squares=98365.40553530994
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=101, sum=4235.277718489282, sum_squares=179690.4720421368
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=101, sum=501.0447878972627, sum_squares=2596.899156698453
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=101, sum=1010.378433449463, sum_squares=10223.916200184585
                    ),
                    m_post_m_pre_sum_of_products=15962.754636573465,
                    d_post_d_pre_sum_of_products=42848.21621273023,
                    m_pre_d_pre_sum_of_products=5115.7607599471585,
                    m_post_d_post_sum_of_products=132444.36911739354,
                    m_post_d_pre_sum_of_products=31588.028767759377,
                    m_pre_d_post_sum_of_products=21431.70320453045,
                    theta=None,
                ),
            ),
            (
                RegressionAdjustedRatioStatistic(
                    n=151,
                    m_statistic_post=SampleMeanStatistic(
                        n=151, sum=5172.587929941052, sum_squares=182453.04528037464
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=151, sum=6510.170220892494, sum_squares=283094.7243365024
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=151, sum=758.3911049329452, sum_squares=3955.922281372593
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=151, sum=1512.006054112595, sum_squares=15285.151021409667
                    ),
                    m_post_m_pre_sum_of_products=26846.415701194885,
                    d_post_d_pre_sum_of_products=65760.83670959483,
                    m_pre_d_pre_sum_of_products=7722.607914963395,
                    m_post_d_post_sum_of_products=226127.20135744457,
                    m_post_d_pre_sum_of_products=52549.76208497923,
                    m_pre_d_post_sum_of_products=33204.9846415661,
                    theta=None,
                ),
                RegressionAdjustedRatioStatistic(
                    n=121,
                    m_statistic_post=SampleMeanStatistic(
                        n=121, sum=4613.696610070716, sum_squares=180520.64781229294
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=121, sum=5079.943060454901, sum_squares=215529.32009367683
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=121, sum=603.9456523430367, sum_squares=3144.0820997706583
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=121, sum=1204.8449120624373, sum_squares=12136.926835557133
                    ),
                    m_post_m_pre_sum_of_products=23789.82730157116,
                    d_post_d_pre_sum_of_products=51127.544981001134,
                    m_pre_d_pre_sum_of_products=6133.9761958037225,
                    m_post_d_post_sum_of_products=196562.8269130501,
                    m_post_d_pre_sum_of_products=46652.31675719776,
                    m_pre_d_post_sum_of_products=25819.033228132084,
                    theta=None,
                ),
            ),
            (
                RegressionAdjustedRatioStatistic(
                    n=160,
                    m_statistic_post=SampleMeanStatistic(
                        n=160, sum=6539.348445231273, sum_squares=274981.98909352464
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=160, sum=6906.305872710853, sum_squares=300900.3106781779
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=160, sum=823.2824168385916, sum_squares=4389.893995072177
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=160, sum=1614.6469506831402, sum_squares=16462.430726309674
                    ),
                    m_post_m_pre_sum_of_products=34727.84795433773,
                    d_post_d_pre_sum_of_products=70363.18868076446,
                    m_pre_d_pre_sum_of_products=8454.545756182042,
                    m_post_d_post_sum_of_products=286483.9732935189,
                    m_post_d_pre_sum_of_products=67017.16816048721,
                    m_pre_d_post_sum_of_products=36121.28274124097,
                    theta=None,
                ),
                RegressionAdjustedRatioStatistic(
                    n=162,
                    m_statistic_post=SampleMeanStatistic(
                        n=162, sum=7431.953259880505, sum_squares=349244.6690736718
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=162, sum=6899.004661928157, sum_squares=296839.44355002965
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=162, sum=832.356528363269, sum_squares=4439.253146704266
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=162, sum=1645.0526462449084, sum_squares=16880.972871039336
                    ),
                    m_post_m_pre_sum_of_products=39332.667494781235,
                    d_post_d_pre_sum_of_products=70764.05432525955,
                    m_pre_d_pre_sum_of_products=8606.62830914991,
                    m_post_d_post_sum_of_products=321057.8410309036,
                    m_post_d_pre_sum_of_products=76550.57235527673,
                    m_pre_d_post_sum_of_products=36071.28512692181,
                    theta=None,
                ),
            ),
        ]
        self.moments_config_abs = EffectMomentsConfig(difference_type="absolute")
        self.moments_config_rel = EffectMomentsConfig(difference_type="relative")

        self.revenue_eu_chrome_a = SampleMeanStatistic(
            n=175, sum=188.0319661707135, sum_squares=501.8913204449768
        )
        self.revenue_us_chrome_a = SampleMeanStatistic(
            n=175, sum=1223.848778242483, sum_squares=8902.145582035047
        )
        self.revenue_eu_firefox_a = SampleMeanStatistic(
            n=175, sum=506.41423076347513, sum_squares=1748.2322349152037
        )
        self.revenue_us_firefox_a = SampleMeanStatistic(
            n=175, sum=1916.9226474898192, sum_squares=21236.13825459178
        )

        self.revenue_eu_chrome_b = SampleMeanStatistic(
            n=175, sum=299.63429043852784, sum_squares=861.0349484333065
        )
        self.revenue_us_chrome_b = SampleMeanStatistic(
            n=175, sum=1403.4670379247032, sum_squares=11598.22989980456
        )
        self.revenue_eu_firefox_b = SampleMeanStatistic(
            n=175, sum=662.4820101138217, sum_squares=2854.4018208604734
        )
        self.revenue_us_firefox_b = SampleMeanStatistic(
            n=175, sum=2089.9655982163963, sum_squares=25337.209946187293
        )

        self.stats_count_revenue = [
            (self.revenue_eu_chrome_a, self.revenue_eu_chrome_b),
            (self.revenue_us_chrome_a, self.revenue_us_chrome_b),
            (self.revenue_eu_firefox_a, self.revenue_eu_firefox_b),
            (self.revenue_us_firefox_a, self.revenue_us_firefox_b),
        ]
        self.stats_count_revenue_eu = [
            (self.revenue_eu_chrome_a, self.revenue_eu_chrome_b),
            (self.revenue_eu_firefox_a, self.revenue_eu_firefox_b),
        ]
        self.stats_count_revenue_us = [
            (self.revenue_us_chrome_a, self.revenue_us_chrome_b),
            (self.revenue_us_firefox_a, self.revenue_us_firefox_b),
        ]

    def test_zero_negative_variance(self):
        stats_count_strata = [
            (
                SampleMeanStatistic(n=21, sum=0, sum_squares=0),
                SampleMeanStatistic(n=42, sum=0, sum_squares=0),
            ),
            (
                SampleMeanStatistic(n=65, sum=0, sum_squares=0),
                SampleMeanStatistic(n=75, sum=0, sum_squares=0),
            ),
        ]

        result_output = EffectMomentsPostStratification(stats_count_strata, self.moments_config_abs).compute_result()  # type: ignore
        default_output = EffectMomentsPostStratification(
            stats_count_strata, self.moments_config_abs  # type: ignore
        )._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE)
        self.assertEqual(default_output, result_output)

    def test_missing_variation_data(self):
        # remove one control observation from the biggest cell, place the observation in a new cell, and test that the output doesn't change
        num_strata = len(self.stats_count_strata)
        last_cell_a = self.stats_count_strata[num_strata - 1][0]
        last_cell_a_minus_obs = SampleMeanStatistic(
            n=last_cell_a.n - 1,
            sum=last_cell_a.sum - 1,
            sum_squares=last_cell_a.sum_squares - 1,
        )
        last_cell = (
            SampleMeanStatistic(n=1, sum=1, sum_squares=1),
            SampleMeanStatistic(n=0, sum=0, sum_squares=0),
        )
        stats_count_strata = []
        for cell in range(0, num_strata - 1):
            stats_count_strata.append(self.stats_count_strata[cell])
        stats_count_strata.append(
            (last_cell_a_minus_obs, self.stats_count_strata[num_strata - 1][1])
        )
        stats_count_strata.append(last_cell)
        expected = EffectMomentsPostStratification(self.stats_count_strata, self.moments_config_abs).compute_result()  # type: ignore
        output = EffectMomentsPostStratification(stats_count_strata, self.moments_config_abs).compute_result()  # type: ignore
        self.assertEqual(expected, output)

    def test_baseline_variation_zero(self):
        stats_count_strata = [
            (
                SampleMeanStatistic(n=21, sum=0, sum_squares=10),
                SampleMeanStatistic(n=42, sum=0, sum_squares=10),
            ),
            (
                SampleMeanStatistic(n=65, sum=0, sum_squares=10),
                SampleMeanStatistic(n=75, sum=0, sum_squares=10),
            ),
        ]
        result_output = EffectMomentsPostStratification(
            stats_count_strata, self.moments_config_abs  # type: ignore
        ).compute_result()
        default_output = EffectMomentsPostStratification(
            self.stats_count_strata, self.moments_config_abs  # type: ignore
        )._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        self.assertEqual(default_output, result_output)

    def test_baseline_variation_adjusted_zero(self):
        stats_count_reg_strata = [
            (
                RegressionAdjustedStatistic(
                    n=21,
                    post_statistic=SampleMeanStatistic(
                        n=21, sum=0, sum_squares=5377.811252605509
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=21, sum=104.90748970535698, sum_squares=544.8528083123211
                    ),
                    post_pre_sum_of_products=1709.8485612477339,
                    theta=None,
                ),
                RegressionAdjustedStatistic(
                    n=42,
                    post_statistic=SampleMeanStatistic(
                        n=42, sum=0, sum_squares=12249.255519049513
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=42, sum=205.17072061676208, sum_squares=1040.6742753852225
                    ),
                    post_pre_sum_of_products=3561.161673449451,
                    theta=None,
                ),
            ),
            (
                RegressionAdjustedStatistic(
                    n=65,
                    post_statistic=SampleMeanStatistic(
                        n=65, sum=0, sum_squares=30546.63404187155
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=65, sum=315.83926510817054, sum_squares=1578.8689285910423
                    ),
                    post_pre_sum_of_products=6938.770455871619,
                    theta=None,
                ),
                RegressionAdjustedStatistic(
                    n=75,
                    post_statistic=SampleMeanStatistic(
                        n=75, sum=0, sum_squares=45000.287664918586
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=75, sum=377.29540367369503, sum_squares=1981.0803020754106
                    ),
                    post_pre_sum_of_products=9428.146405105292,
                    theta=None,
                ),
            ),
        ]
        result_output = EffectMomentsPostStratification(
            stats_count_reg_strata, self.moments_config_abs  # type: ignore
        ).compute_result()
        default_output = EffectMomentsPostStratification(
            self.stats_count_strata, self.moments_config_abs  # type: ignore
        )._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        self.assertEqual(default_output, result_output)

    def test_post_strat_count_effect_moments(self):
        result_dict_rel = asdict(
            EffectMomentsPostStratification(
                self.stats_count_strata, self.moments_config_rel  # type: ignore
            ).compute_result()
        )
        result_dict_abs = asdict(
            EffectMomentsPostStratification(
                self.stats_count_strata, self.moments_config_abs  # type: ignore
            ).compute_result()
        )
        expected_rounded_dict_rel = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_count_rel,
                standard_error=self.standard_error_count_rel,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        expected_rounded_dict_abs = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_count_abs,
                standard_error=self.standard_error_count_abs,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict_rel),
            _round_result_dict(expected_rounded_dict_rel),
        )

        self.assertDictEqual(
            _round_result_dict(result_dict_abs),
            _round_result_dict(expected_rounded_dict_abs),
        )

    # test that the effect moments post stratification falls back from regression to unadjusted when the regression adjusted stats have 0 for baseline values
    def test_post_strat_count_effect_moments_fallback(self):
        fallback_reg_stats = [
            (
                RegressionAdjustedStatistic(
                    n=stat_pair[0].n,
                    post_statistic=SampleMeanStatistic(
                        n=stat_pair[0].n,
                        sum=stat_pair[0].sum,
                        sum_squares=stat_pair[0].sum_squares,
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=stat_pair[0].n, sum=0, sum_squares=0
                    ),
                    post_pre_sum_of_products=0,
                    theta=None,
                ),
                RegressionAdjustedStatistic(
                    n=stat_pair[1].n,
                    post_statistic=SampleMeanStatistic(
                        n=stat_pair[1].n,
                        sum=stat_pair[1].sum,
                        sum_squares=stat_pair[1].sum_squares,
                    ),
                    pre_statistic=SampleMeanStatistic(
                        n=stat_pair[1].n,
                        sum=0,
                        sum_squares=0,
                    ),
                    post_pre_sum_of_products=0,
                    theta=None,
                ),
            )
            for stat_pair in self.stats_count_strata
        ]

        result_dict_rel = asdict(
            EffectMomentsPostStratification(
                fallback_reg_stats, self.moments_config_rel  # type: ignore
            ).compute_result()
        )
        result_dict_abs = asdict(
            EffectMomentsPostStratification(
                fallback_reg_stats, self.moments_config_abs  # type: ignore
            ).compute_result()
        )
        expected_rounded_dict_rel = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_count_rel,
                standard_error=self.standard_error_count_rel,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        expected_rounded_dict_abs = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_count_abs,
                standard_error=self.standard_error_count_abs,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict_rel),
            _round_result_dict(expected_rounded_dict_rel),
        )

        self.assertDictEqual(
            _round_result_dict(result_dict_abs),
            _round_result_dict(expected_rounded_dict_abs),
        )

    # if an individual cell has 0 baseline variance, the return the StrataResult with unadjusted data
    def test_post_strat_mean_reg_gbstats_single_cell_fallback(self):
        stats_a, stats_b = zip(*self.stats_count_strata)
        stats_a_reg = [
            RegressionAdjustedStatistic(
                n=stat_a.n,
                post_statistic=stat_a,
                pre_statistic=SampleMeanStatistic(n=stat_a.n, sum=0, sum_squares=0),
                post_pre_sum_of_products=0,
                theta=None,
            )
            for stat_a in stats_a
        ]

        stats_b_reg = [
            RegressionAdjustedStatistic(
                n=stat_b.n,
                post_statistic=stat_b,
                pre_statistic=SampleMeanStatistic(n=stat_b.n, sum=0, sum_squares=0),
                post_pre_sum_of_products=0,
                theta=None,
            )
            for stat_b in stats_b
        ]
        class_unadjusted = EffectMomentsPostStratification(
            list(zip(stats_a, stats_b)), self.moments_config_rel  # type: ignore
        )
        class_reg = EffectMomentsPostStratification(
            list(zip(stats_a_reg, stats_b_reg)), self.moments_config_rel  # type: ignore
        )
        results_unadjusted = [
            class_unadjusted.compute_strata_result(stat_pair)
            for stat_pair in zip(stats_a, stats_b)
        ]
        results_reg = [
            class_reg.compute_strata_result(stat_pair)
            for stat_pair in zip(stats_a_reg, stats_b_reg)
        ]

        # ensure the fallback works cell by cell
        for r_un, r_reg in zip(results_unadjusted, results_reg):
            self.assertEqual(r_un, r_reg)

    # if an individual cell has 0 baseline variance, the return the StrataResult with unadjusted data
    def test_post_strat_ratio_reg_gbstats_single_cell_fallback(self):
        stats_a, stats_b = zip(*self.stats_ratio_strata)
        stats_a_reg = [
            RegressionAdjustedRatioStatistic(
                n=stat_a.n,
                m_statistic_post=stat_a.m_statistic,
                d_statistic_post=stat_a.d_statistic,
                m_statistic_pre=SampleMeanStatistic(n=stat_a.n, sum=0, sum_squares=0),
                d_statistic_pre=SampleMeanStatistic(n=stat_a.n, sum=0, sum_squares=0),
                m_post_m_pre_sum_of_products=0,
                d_post_d_pre_sum_of_products=0,
                m_pre_d_pre_sum_of_products=0,
                m_post_d_post_sum_of_products=stat_a.m_d_sum_of_products,
                m_post_d_pre_sum_of_products=0,
                m_pre_d_post_sum_of_products=0,
                theta=None,
            )
            for stat_a in stats_a
        ]

        stats_b_reg = [
            RegressionAdjustedRatioStatistic(
                n=stat_b.n,
                m_statistic_post=stat_b.m_statistic,
                d_statistic_post=stat_b.d_statistic,
                m_statistic_pre=SampleMeanStatistic(n=stat_b.n, sum=0, sum_squares=0),
                d_statistic_pre=SampleMeanStatistic(n=stat_b.n, sum=0, sum_squares=0),
                m_post_m_pre_sum_of_products=0,
                d_post_d_pre_sum_of_products=0,
                m_pre_d_pre_sum_of_products=0,
                m_post_d_post_sum_of_products=stat_b.m_d_sum_of_products,
                m_post_d_pre_sum_of_products=0,
                m_pre_d_post_sum_of_products=0,
                theta=None,
            )
            for stat_b in stats_b
        ]

        class_unadjusted = EffectMomentsPostStratification(
            list(zip(stats_a, stats_b)), self.moments_config_rel  # type: ignore
        )
        class_reg = EffectMomentsPostStratification(
            list(zip(stats_a_reg, stats_b_reg)), self.moments_config_rel  # type: ignore
        )
        results_unadjusted = [
            class_unadjusted.compute_strata_result(stat_pair)
            for stat_pair in zip(stats_a, stats_b)
        ]
        results_reg = [
            class_reg.compute_strata_result(stat_pair)
            for stat_pair in zip(stats_a_reg, stats_b_reg)
        ]

        # ensure the fallback works cell by cell
        for r_un, r_reg in zip(results_unadjusted, results_reg):
            self.assertEqual(r_un, r_reg)

    def test_post_strat_count_reg_effect_moments(self):
        result_dict_rel = asdict(
            EffectMomentsPostStratification(
                self.stats_count_reg_strata, self.moments_config_rel  # type: ignore
            ).compute_result()
        )
        result_dict_abs = asdict(
            EffectMomentsPostStratification(
                self.stats_count_reg_strata, self.moments_config_abs  # type: ignore
            ).compute_result()
        )

        expected_rounded_dict_rel = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_count_reg_rel,
                standard_error=self.standard_error_count_reg_rel,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        expected_rounded_dict_abs = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_count_reg_abs,
                standard_error=self.standard_error_count_reg_abs,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )

        self.assertDictEqual(
            _round_result_dict(result_dict_rel),
            _round_result_dict(expected_rounded_dict_rel),
        )

        self.assertDictEqual(
            _round_result_dict(result_dict_abs),
            _round_result_dict(expected_rounded_dict_abs),
        )

    def test_post_strat_ratio_effect_moments(self):
        result_dict_rel = asdict(
            EffectMomentsPostStratification(
                self.stats_ratio_strata, self.moments_config_rel  # type: ignore
            ).compute_result()
        )
        result_dict_abs = asdict(
            EffectMomentsPostStratification(
                self.stats_ratio_strata, self.moments_config_abs  # type: ignore
            ).compute_result()
        )
        expected_rounded_dict_rel = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_ratio_rel,
                standard_error=self.standard_error_ratio_rel,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        expected_rounded_dict_abs = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_ratio_abs,
                standard_error=self.standard_error_ratio_abs,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict_rel),
            _round_result_dict(expected_rounded_dict_rel),
        )
        self.assertDictEqual(
            _round_result_dict(result_dict_abs),
            _round_result_dict(expected_rounded_dict_abs),
        )

    # test that the effect moments post stratification falls back from regression to unadjusted when the regression adjusted stats have 0 for baseline values
    def test_post_strat_ratio_effect_moments_fallback(self):
        fallback_reg_stats = [
            (
                RegressionAdjustedRatioStatistic(
                    n=stat_pair[0].n,
                    m_statistic_post=SampleMeanStatistic(
                        n=stat_pair[0].n,
                        sum=stat_pair[0].m_statistic.sum,
                        sum_squares=stat_pair[0].m_statistic.sum_squares,
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=stat_pair[0].n,
                        sum=stat_pair[0].d_statistic.sum,
                        sum_squares=stat_pair[0].d_statistic.sum_squares,
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=stat_pair[0].n, sum=0, sum_squares=0
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=stat_pair[0].n, sum=0, sum_squares=0
                    ),
                    m_post_m_pre_sum_of_products=0,
                    d_post_d_pre_sum_of_products=0,
                    m_pre_d_pre_sum_of_products=0,
                    m_post_d_post_sum_of_products=stat_pair[0].m_d_sum_of_products,
                    m_post_d_pre_sum_of_products=0,
                    m_pre_d_post_sum_of_products=0,
                    theta=None,
                ),
                RegressionAdjustedRatioStatistic(
                    n=stat_pair[1].n,
                    m_statistic_post=SampleMeanStatistic(
                        n=stat_pair[1].n,
                        sum=stat_pair[1].m_statistic.sum,
                        sum_squares=stat_pair[1].m_statistic.sum_squares,
                    ),
                    d_statistic_post=SampleMeanStatistic(
                        n=stat_pair[1].n,
                        sum=stat_pair[1].d_statistic.sum,
                        sum_squares=stat_pair[1].d_statistic.sum_squares,
                    ),
                    m_statistic_pre=SampleMeanStatistic(
                        n=stat_pair[1].n, sum=0, sum_squares=0
                    ),
                    d_statistic_pre=SampleMeanStatistic(
                        n=stat_pair[1].n, sum=0, sum_squares=0
                    ),
                    m_post_m_pre_sum_of_products=0,
                    d_post_d_pre_sum_of_products=0,
                    m_pre_d_pre_sum_of_products=0,
                    m_post_d_post_sum_of_products=stat_pair[1].m_d_sum_of_products,
                    m_post_d_pre_sum_of_products=0,
                    m_pre_d_post_sum_of_products=0,
                    theta=None,
                ),
            )
            for stat_pair in self.stats_ratio_strata
        ]
        result_dict_rel = asdict(
            EffectMomentsPostStratification(
                fallback_reg_stats, self.moments_config_rel  # type: ignore
            ).compute_result()
        )
        result_dict_abs = asdict(
            EffectMomentsPostStratification(
                fallback_reg_stats, self.moments_config_abs  # type: ignore
            ).compute_result()
        )
        expected_rounded_dict_rel = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_ratio_rel,
                standard_error=self.standard_error_ratio_rel,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        expected_rounded_dict_abs = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_ratio_abs,
                standard_error=self.standard_error_ratio_abs,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict_rel),
            _round_result_dict(expected_rounded_dict_rel),
        )
        self.assertDictEqual(
            _round_result_dict(result_dict_abs),
            _round_result_dict(expected_rounded_dict_abs),
        )

    def test_post_strat_ratio_reg_effect_moments(self):
        result_dict_rel = asdict(
            EffectMomentsPostStratification(
                self.stats_ratio_reg_strata, self.moments_config_rel  # type: ignore
            ).compute_result()
        )
        result_dict_abs = asdict(
            EffectMomentsPostStratification(
                self.stats_ratio_reg_strata, self.moments_config_abs  # type: ignore
            ).compute_result()
        )
        expected_rounded_dict_rel = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_ratio_reg_rel,
                standard_error=self.standard_error_ratio_reg_rel,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        expected_rounded_dict_abs = asdict(
            EffectMomentsResult(
                point_estimate=self.point_estimate_ratio_reg_abs,
                standard_error=self.standard_error_ratio_reg_abs,
                pairwise_sample_size=1000,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict_rel),
            _round_result_dict(expected_rounded_dict_rel),
        )
        self.assertDictEqual(
            _round_result_dict(result_dict_abs),
            _round_result_dict(expected_rounded_dict_abs),
        )

    def test_post_strat_count_gbstats(self):
        stats_a, stats_b = zip(*self.stats_count_strata)
        test_result_rel = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type="relative"))  # type: ignore
        test_result_abs = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type="absolute"))  # type: ignore
        result_true_rel = FrequentistTestResult(
            expected=self.point_estimate_count_rel,
            ci=[0.08609, 0.13381],
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate_count_rel,
                stddev=self.standard_error_count_rel,
            ),
            error_message=None,
            p_value=None,
            p_value_error_message=None,
        )
        result_true_abs = FrequentistTestResult(
            expected=self.point_estimate_count_abs,
            ci=[2.81433, 4.28186],
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate_count_abs,
                stddev=self.standard_error_count_abs,
            ),
            error_message=None,
            p_value=None,
            p_value_error_message=None,
        )
        self.assertEqual(
            _round_result_dict(asdict(result_true_rel)),
            _round_result_dict(asdict(test_result_rel)),
        )
        self.assertEqual(
            _round_result_dict(asdict(result_true_abs)),
            _round_result_dict(asdict(test_result_abs)),
        )

    def test_post_strat_ratio_gbstats(self):
        stats_a, stats_b = zip(*self.stats_ratio_strata)
        test_result_rel = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type="relative"))  # type: ignore
        test_result_abs = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type="absolute"))  # type: ignore
        result_true_rel = FrequentistTestResult(
            expected=self.point_estimate_ratio_rel,
            ci=[0.12017, 0.14726],
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate_ratio_rel,
                stddev=self.standard_error_ratio_rel,
            ),
            error_message=None,
            p_value=None,
            p_value_error_message=None,
        )
        result_true_abs = FrequentistTestResult(
            expected=self.point_estimate_ratio_abs,
            ci=[0.09046, 0.10972],
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate_ratio_abs,
                stddev=self.standard_error_ratio_abs,
            ),
            error_message=None,
            p_value=None,
            p_value_error_message=None,
        )
        self.assertEqual(
            _round_result_dict(asdict(result_true_rel)),
            _round_result_dict(asdict(test_result_rel)),
        )
        self.assertEqual(
            _round_result_dict(asdict(result_true_abs)),
            _round_result_dict(asdict(test_result_abs)),
        )

    def test_post_strat_mean_reg_gbstats(self):
        stats_a, stats_b = zip(*self.stats_count_reg_strata)
        test_result_rel = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type="relative"))  # type: ignore
        test_result_abs = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type="absolute"))  # type: ignore
        result_true_rel = FrequentistTestResult(
            expected=self.point_estimate_count_reg_rel,
            ci=[0.11058, 0.12001],
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate_count_reg_rel,
                stddev=self.standard_error_count_reg_rel,
            ),
            error_message=None,
            p_value=None,
            p_value_error_message=None,
        )
        result_true_abs = FrequentistTestResult(
            expected=self.point_estimate_count_reg_abs,
            ci=[3.5563, 3.86709],
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate_count_reg_abs,
                stddev=self.standard_error_count_reg_abs,
            ),
            error_message=None,
            p_value=None,
            p_value_error_message=None,
        )

        self.assertEqual(
            _round_result_dict(asdict(result_true_rel)),
            _round_result_dict(asdict(test_result_rel)),
        )
        self.assertEqual(
            _round_result_dict(asdict(result_true_abs)),
            _round_result_dict(asdict(test_result_abs)),
        )

    def test_post_strat_ratio_reg_gbstats(self):
        stats_a, stats_b = zip(*self.stats_ratio_reg_strata)
        test_result_rel = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type="relative"))  # type: ignore
        test_result_abs = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type="absolute"))  # type: ignore
        result_true_rel = FrequentistTestResult(
            expected=self.point_estimate_ratio_reg_rel,
            ci=[0.13673, 0.14186],
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate_ratio_reg_rel,
                stddev=self.standard_error_ratio_reg_rel,
            ),
            error_message=None,
            p_value=None,
            p_value_error_message=None,
        )
        result_true_abs = FrequentistTestResult(
            expected=self.point_estimate_ratio_reg_abs,
            ci=[0.10150, 0.10649],
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate_ratio_reg_abs,
                stddev=self.standard_error_ratio_reg_abs,
            ),
            error_message=None,
            p_value=None,
            p_value_error_message=None,
        )
        self.assertEqual(
            _round_result_dict(asdict(result_true_rel)),
            _round_result_dict(asdict(test_result_rel)),
        )
        self.assertEqual(
            _round_result_dict(asdict(result_true_abs)),
            _round_result_dict(asdict(test_result_abs)),
        )

    def test_post_strat_dimension(self):
        difference_type = "absolute"
        # test that if we post-stratify by browser for EU users, and the same for US, we get the right result
        stats_a, stats_b = zip(*self.stats_count_revenue)
        stats_a_eu, stats_b_eu = zip(*self.stats_count_revenue_eu)
        stats_a_us, stats_b_us = zip(*self.stats_count_revenue_us)
        # we can use the data specific to the region as the ground truth, because these tests succeeded above
        moments_result_eu_true = EffectMomentsPostStratification(self.stats_count_revenue_eu, EffectMomentsConfig(difference_type=difference_type)).compute_result()  # type: ignore
        moments_result_us_true = EffectMomentsPostStratification(self.stats_count_revenue_us, EffectMomentsConfig(difference_type=difference_type)).compute_result()  # type: ignore
        # #first we check the moments result against the test result
        test_result_eu_true = self.run_post_strat_gbstats(stats_a_eu, stats_b_eu, FrequentistConfig(difference_type=difference_type))  # type: ignore
        test_result_us_true = self.run_post_strat_gbstats(stats_a_us, stats_b_us, FrequentistConfig(difference_type=difference_type))  # type: ignore
        pairwise_sample_size_eu = sum(
            t[0].n + t[1].n for t in self.stats_count_revenue_eu
        )
        pairwise_sample_size_us = sum(
            t[0].n + t[1].n for t in self.stats_count_revenue_us
        )
        moments_result_from_test_eu = EffectMomentsResult(
            point_estimate=test_result_eu_true.expected,
            standard_error=test_result_eu_true.uplift.stddev,
            error_message=None,
            pairwise_sample_size=pairwise_sample_size_eu,
        )
        moments_result_from_test_us = EffectMomentsResult(
            point_estimate=test_result_us_true.expected,
            standard_error=test_result_us_true.uplift.stddev,
            error_message=None,
            pairwise_sample_size=pairwise_sample_size_us,
        )
        self.assertEqual(
            _round_result_dict(asdict(moments_result_from_test_eu)),
            _round_result_dict(asdict(moments_result_eu_true)),
        )
        self.assertEqual(
            _round_result_dict(asdict(moments_result_from_test_us)),
            _round_result_dict(asdict(moments_result_us_true)),
        )
        # now that we have ground truth for test results, we can check if looping over regions works
        regions = ["eu", "us"] * 4
        browsers = ["chrome"] * 2 + ["firefox"] * 2
        browsers = browsers * 2
        test_result_eu = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type=difference_type), regions=regions, browsers=browsers, dimension="exp:region", dimension_level="eu")  # type: ignore
        test_result_us = self.run_post_strat_gbstats(stats_a, stats_b, FrequentistConfig(difference_type=difference_type), regions=regions, browsers=browsers, dimension="exp:region", dimension_level="us")  # type: ignore
        self.assertEqual(
            _round_result_dict(asdict(test_result_eu)),
            _round_result_dict(asdict(test_result_eu_true)),
        )
        self.assertEqual(
            _round_result_dict(asdict(test_result_us)),
            _round_result_dict(asdict(test_result_us_true)),
        )


if __name__ == "__main__":
    unittest_main()
