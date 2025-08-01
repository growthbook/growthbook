from dataclasses import asdict
from functools import partial
from typing import Optional
from unittest import TestCase, main as unittest_main

import numpy as np
import copy

from gbstats.frequentist.post_strat import PostStratification

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
from gbstats.models.tests import EffectMomentsConfig, EffectMomentsResult

DECIMALS = 5


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
    def setUp(self):
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
        result_output = PostStratification(
            stats_count_strata, self.moments_config_abs
        ).compute_result()
        default_output = PostStratification(
            self.stats_count_strata, self.moments_config_abs
        )._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE)
        self.assertEqual(default_output, result_output)

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
        result_output = PostStratification(
            stats_count_strata, self.moments_config_abs
        ).compute_result()
        default_output = PostStratification(
            self.stats_count_strata, self.moments_config_abs
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
        result_output = PostStratification(
            stats_count_reg_strata, self.moments_config_abs
        ).compute_result()
        default_output = PostStratification(
            self.stats_count_strata, self.moments_config_abs
        )._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        self.assertEqual(default_output, result_output)

    def test_post_strat_count_abs(self):
        result_dict = asdict(
            PostStratification(
                self.stats_count_strata, self.moments_config_abs
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            EffectMomentsResult(
                point_estimate=3.548094377986586,
                standard_error=0.3769153078989125,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_post_strat_ratio_abs(self):
        result_dict = asdict(
            PostStratification(
                self.stats_ratio_strata, self.moments_config_abs
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            EffectMomentsResult(
                point_estimate=0.10008903417216042,
                standard_error=0.0050779658636993154,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_post_strat_count_reg_abs(self):
        result_dict = asdict(
            PostStratification(
                self.stats_count_reg_strata, self.moments_config_abs
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            EffectMomentsResult(
                point_estimate=3.7116918650826403,
                standard_error=0.07401168371016856,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_post_strat_ratio_reg_abs(self):
        result_dict = asdict(
            PostStratification(
                self.stats_ratio_reg_strata, self.moments_config_abs
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            EffectMomentsResult(
                point_estimate=0.10399412678969455,
                standard_error=0.0012278145208316127,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_post_strat_count_rel(self):
        result_dict = asdict(
            PostStratification(
                self.stats_count_strata, self.moments_config_rel
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            EffectMomentsResult(
                point_estimate=0.10994584851937338,
                standard_error=0.01224418556792039,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_post_strat_ratio_rel(self):
        result_dict = asdict(
            PostStratification(
                self.stats_ratio_strata, self.moments_config_rel
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            EffectMomentsResult(
                point_estimate=0.13371299783026025,
                standard_error=0.007141416587299529,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_post_strat_count_reg_rel(self):
        result_dict = asdict(
            PostStratification(
                self.stats_count_reg_strata, self.moments_config_rel
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            EffectMomentsResult(
                point_estimate=0.11529547657147853,
                standard_error=0.0022103200530259534,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_post_strat_ratio_reg_rel(self):
        result_dict = asdict(
            PostStratification(
                self.stats_ratio_reg_strata, self.moments_config_rel
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            EffectMomentsResult(
                point_estimate=0.13929489348145818,
                standard_error=0.0012337665987066867,
                error_message=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )


if __name__ == "__main__":
    unittest_main()
