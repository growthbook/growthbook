from dataclasses import asdict
from functools import partial
from typing import Optional
from unittest import TestCase, main as unittest_main

import numpy as np

from gbstats.messages import ZERO_NEGATIVE_VARIANCE_MESSAGE

from gbstats.frequentist.tests import (
    FrequentistConfig,
    FrequentistTestResult,
    SequentialConfig,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
    OneSidedTreatmentGreaterTTest,
    OneSidedTreatmentLesserTTest,
    SequentialOneSidedTreatmentGreaterTTest,
    SequentialOneSidedTreatmentLesserTTest,
)
from gbstats.models.statistics import (
    ProportionStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
    RegressionAdjustedRatioStatistic,
)
from gbstats.models.results import Uplift

DECIMALS = 5


def round_if_not_none(x: Optional[float], decimals: int):
    return np.round(x, decimals) if x is not None else None


round_ = partial(round_if_not_none, decimals=DECIMALS)


def _round_result_dict(result_dict):
    for k, v in result_dict.items():
        if k == "errorMessage" or isinstance(v, bool):
            pass
        elif k == "uplift":
            v = {
                kk: round_(vv) if isinstance(vv, float) else vv for kk, vv in v.items()
            }
        elif isinstance(v, tuple) and len(v) == 2:
            v_low = round_(v[0]) if v[0] is not None else None
            v_high = round_(v[1]) if v[1] is not None else None
            v = (v_low, v_high)
        elif isinstance(v, float):
            v = round_(v)
        result_dict[k] = v
    return result_dict


class TestTwoSidedTTest(TestCase):
    def setUp(self):
        self.stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3407)
        self.stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        self.frequentist_config_rel = FrequentistConfig(difference_type="relative")
        self.frequentist_config_abs = FrequentistConfig(difference_type="absolute")

    def test_two_sided_ttest(self):
        result_dict = asdict(
            TwoSidedTTest(
                [(self.stat_a, self.stat_b)], self.frequentist_config_rel
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.70732,
                ci=(-0.03526, 1.44989),
                uplift=Uplift("normal", 0.70732, 0.37879),
                pValue=0.06191,
                pValueErrorMessage=None,
                errorMessage=None,
            )
        )
        if result_dict["pValue"]:
            self.assertDictEqual(_round_result_dict(result_dict), expected_rounded_dict)
        else:
            raise ValueError("pValue is None for TwoSidedTTest")

    def test_two_sided_ttest_absolute(self):
        result_dict = asdict(
            TwoSidedTTest(
                [(self.stat_a, self.stat_b)], self.frequentist_config_abs
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.7 - 0.41,
                ci=(0.04538, 0.53462),
                uplift=Uplift("normal", 0.29, 0.12478),
                pValue=0.02016,
                pValueErrorMessage=None,
                errorMessage=None,
            )
        )
        self.assertDictEqual(_round_result_dict(result_dict), expected_rounded_dict)

    def test_two_sided_ttest_binom(self):
        stat_a = ProportionStatistic(sum=14, n=28)
        stat_b = ProportionStatistic(sum=16, n=30)
        result_dict = asdict(
            TwoSidedTTest(
                [(stat_a, stat_b)], self.frequentist_config_rel
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=np.round((16 / 30 - 0.5) / 0.5, DECIMALS),
                ci=(-0.47767, 0.61101),
                uplift=Uplift("normal", 0.06667, 0.2717),
                pValue=0.80707,
                pValueErrorMessage=None,
                errorMessage=None,
            )
        )
        self.assertDictEqual(_round_result_dict(result_dict), expected_rounded_dict)

    def test_two_sided_ttest_missing_variance(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=2)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        default_output = TwoSidedTTest(
            [(stat_a, stat_b)], self.frequentist_config_rel
        )._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE)
        result_output = TwoSidedTTest(
            [(stat_a, stat_b)], self.frequentist_config_rel
        ).compute_result()
        self.assertEqual(default_output, result_output)

    def test_two_sided_ttest_test_runs_ratio_ra(self):
        stat_a = RegressionAdjustedRatioStatistic(
            n=100,
            m_statistic_post=SampleMeanStatistic(
                n=100, sum=485.112236689623, sum_squares=2715.484666118136
            ),
            d_statistic_post=SampleMeanStatistic(
                n=100, sum=679.9093275844917, sum_squares=4939.424001640236
            ),
            m_statistic_pre=SampleMeanStatistic(
                n=100, sum=192.59138069991536, sum_squares=460.076026390857
            ),
            d_statistic_pre=SampleMeanStatistic(
                n=100, sum=290.1398399750233, sum_squares=920.9461385038898
            ),
            m_post_m_pre_sum_of_products=1113.6215759318352,
            d_post_d_pre_sum_of_products=2130.9404074446747,
            m_pre_d_pre_sum_of_products=634.239482353647,
            m_post_d_post_sum_of_products=3602.146836776702,
            m_post_d_pre_sum_of_products=1559.2878434944676,
            m_pre_d_post_sum_of_products=1460.3181079276983,
            theta=None,
        )
        stat_b = RegressionAdjustedRatioStatistic(
            n=100,
            m_statistic_post=SampleMeanStatistic(
                n=100, sum=514.7757826608777, sum_squares=2994.897482705013
            ),
            d_statistic_post=SampleMeanStatistic(
                n=100, sum=705.4090874383759, sum_squares=5291.36604146392
            ),
            m_statistic_pre=SampleMeanStatistic(
                n=100, sum=206.94157227402536, sum_squares=514.2903702246757
            ),
            d_statistic_pre=SampleMeanStatistic(
                n=100, sum=302.54389139107326, sum_squares=994.4506208125663
            ),
            m_post_m_pre_sum_of_products=1237.0953021125997,
            d_post_d_pre_sum_of_products=2292.081739775257,
            m_pre_d_pre_sum_of_products=698.4173425817908,
            m_post_d_post_sum_of_products=3918.1561431600717,
            m_post_d_pre_sum_of_products=1701.0287270040265,
            m_pre_d_post_sum_of_products=1604.0759503266522,
            theta=None,
        )
        result_dict = asdict(
            TwoSidedTTest(
                [(stat_a, stat_b)], self.frequentist_config_rel
            ).compute_result()
        )
        expected_dict = asdict(
            FrequentistTestResult(
                expected=-0.0007,
                ci=(-0.00841, 0.00700),
                uplift=Uplift(dist="normal", mean=-0.0007, stddev=0.00391),
                errorMessage=None,
                pValue=0.85771,
                pValueErrorMessage=None,
            )
        )
        self.assertDictEqual(_round_result_dict(result_dict), expected_dict)


class TestSequentialTTest(TestCase):
    def test_sequential_test_runs(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        config = SequentialConfig(sequential_tuning_parameter=1000)
        result_dict = asdict(
            SequentialTwoSidedTTest([(stat_a, stat_b)], config).compute_result()
        )
        expected_dict = asdict(
            FrequentistTestResult(
                expected=0.50336,
                ci=(-0.55844, 1.56516),
                uplift=Uplift("normal", 0.50336, 0.33341),
                pValue=1,
                errorMessage=None,
                pValueErrorMessage=None,
            )
        )

        self.assertEqual(_round_result_dict(result_dict), expected_dict)

    def test_sequential_test_runs_prop(self):
        stat_a = ProportionStatistic(sum=1396, n=3000)
        stat_b = ProportionStatistic(sum=2422, n=3461)
        result_dict = asdict(
            SequentialTwoSidedTTest([(stat_a, stat_b)]).compute_result()
        )
        expected_dict = asdict(
            FrequentistTestResult(
                expected=0.50386,
                ci=(0.40098, 0.60675),
                uplift=Uplift("normal", 0.50386, 0.03386),
                pValue=0.0,
                pValueErrorMessage=None,
                errorMessage=None,
            )
        )
        self.assertEqual(_round_result_dict(result_dict), expected_dict)

    def test_sequential_test_runs_ra(self):
        stat_a_pre = SampleMeanStatistic(sum=16.87, sum_squares=527.9767, n=3000)
        stat_b_pre = SampleMeanStatistic(sum=22.7, sum_squares=1348.29, n=3461)
        stat_a_post = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
        stat_b_post = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        stat_a_ra = RegressionAdjustedStatistic(
            n=3000,
            post_statistic=stat_a_post,
            pre_statistic=stat_a_pre,
            post_pre_sum_of_products=1,
            theta=None,
        )
        stat_b_ra = RegressionAdjustedStatistic(
            n=3461,
            post_statistic=stat_b_post,
            pre_statistic=stat_b_pre,
            post_pre_sum_of_products=1,
            theta=None,
        )
        result_dict = asdict(
            SequentialTwoSidedTTest([(stat_a_ra, stat_b_ra)]).compute_result()
        )
        expected_dict = asdict(
            FrequentistTestResult(
                expected=0.50338,
                ci=(-0.50969, 1.51646),
                uplift=Uplift("normal", 0.50338, 0.33341),
                pValue=1,
                pValueErrorMessage=None,
                errorMessage=None,
            )
        )

        self.assertEqual(_round_result_dict(result_dict), expected_dict)

    def test_sequential_test_runs_ratio_ra(self):
        stat_a = RegressionAdjustedRatioStatistic(
            n=100,
            m_statistic_post=SampleMeanStatistic(
                n=100, sum=485.112236689623, sum_squares=2715.484666118136
            ),
            d_statistic_post=SampleMeanStatistic(
                n=100, sum=679.9093275844917, sum_squares=4939.424001640236
            ),
            m_statistic_pre=SampleMeanStatistic(
                n=100, sum=192.59138069991536, sum_squares=460.076026390857
            ),
            d_statistic_pre=SampleMeanStatistic(
                n=100, sum=290.1398399750233, sum_squares=920.9461385038898
            ),
            m_post_m_pre_sum_of_products=1113.6215759318352,
            d_post_d_pre_sum_of_products=2130.9404074446747,
            m_pre_d_pre_sum_of_products=634.239482353647,
            m_post_d_post_sum_of_products=3602.146836776702,
            m_post_d_pre_sum_of_products=1559.2878434944676,
            m_pre_d_post_sum_of_products=1460.3181079276983,
            theta=None,
        )
        stat_b = RegressionAdjustedRatioStatistic(
            n=100,
            m_statistic_post=SampleMeanStatistic(
                n=100, sum=514.7757826608777, sum_squares=2994.897482705013
            ),
            d_statistic_post=SampleMeanStatistic(
                n=100, sum=705.4090874383759, sum_squares=5291.36604146392
            ),
            m_statistic_pre=SampleMeanStatistic(
                n=100, sum=206.94157227402536, sum_squares=514.2903702246757
            ),
            d_statistic_pre=SampleMeanStatistic(
                n=100, sum=302.54389139107326, sum_squares=994.4506208125663
            ),
            m_post_m_pre_sum_of_products=1237.0953021125997,
            d_post_d_pre_sum_of_products=2292.081739775257,
            m_pre_d_pre_sum_of_products=698.4173425817908,
            m_post_d_post_sum_of_products=3918.1561431600717,
            m_post_d_pre_sum_of_products=1701.0287270040265,
            m_pre_d_post_sum_of_products=1604.0759503266522,
            theta=None,
        )
        result_dict = asdict(
            SequentialTwoSidedTTest([(stat_a, stat_b)]).compute_result()
        )
        expected_dict = asdict(
            FrequentistTestResult(
                expected=-0.0007,
                ci=(-0.02063, 0.01923),
                uplift=Uplift(dist="normal", mean=-0.0007, stddev=0.00391),
                errorMessage=None,
                pValue=1.0,
                pValueErrorMessage=None,
            )
        )
        self.assertEqual(_round_result_dict(result_dict), expected_dict)

    def test_sequential_test_tuning_as_expected(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        config_below_n = SequentialConfig(sequential_tuning_parameter=10)
        result_below = SequentialTwoSidedTTest(
            [(stat_a, stat_b)], config_below_n
        ).compute_result()

        config_near_n = SequentialConfig(sequential_tuning_parameter=6461)
        result_near = SequentialTwoSidedTTest(
            [(stat_a, stat_b)], config_near_n
        ).compute_result()

        config_above_n = SequentialConfig(sequential_tuning_parameter=10000)
        result_above = SequentialTwoSidedTTest(
            [(stat_a, stat_b)], config_above_n
        ).compute_result()

        # Way underestimating should be worse here
        self.assertTrue(
            (result_below.ci[0] < result_above.ci[0])  # type: ignore
            and (result_below.ci[1] > result_above.ci[1])  # type: ignore
        )
        # And estimating well should be both
        self.assertTrue(
            (result_below.ci[0] < result_near.ci[0])  # type: ignore
            and (result_below.ci[1] > result_near.ci[1])  # type: ignore
        )
        self.assertTrue(
            (result_above.ci[0] < result_near.ci[0])  # type: ignore
            and (result_above.ci[1] > result_near.ci[1])  # type: ignore
        )


class TestOneSidedGreaterTTest(TestCase):
    def setUp(self):
        self.stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
        self.stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)

    def test_one_sided_ttest(self):
        result_dict = asdict(
            OneSidedTreatmentGreaterTTest([(self.stat_a, self.stat_b)]).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.5033610858562358,
                ci=(-0.045136675850396046, np.inf),
                uplift=Uplift(
                    dist="normal", mean=0.5033610858562358, stddev=0.3334122146400735
                ),
                errorMessage=None,
                pValue=0.06558262868467746,
                pValueErrorMessage=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_one_sided_ttest_absolute(self):
        result_dict = asdict(
            OneSidedTreatmentGreaterTTest(
                [(self.stat_a, self.stat_b)],
                FrequentistConfig(difference_type="absolute"),
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.23437666666666668,
                ci=(0.020791480063255735, np.inf),
                uplift=Uplift(
                    dist="normal", mean=0.23437666666666668, stddev=0.12983081254184736
                ),
                errorMessage=None,
                pValue=0.03554272489873023,
                pValueErrorMessage=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )


class TestOneSidedLesserTTest(TestCase):
    def setUp(self):
        self.stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
        self.stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)

    def test_one_sided_ttest(self):
        result_dict = asdict(
            OneSidedTreatmentLesserTTest([(self.stat_a, self.stat_b)]).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.5033610858562358,
                ci=(-np.inf, 1.0518588475628676),
                uplift=Uplift(
                    dist="normal", mean=0.5033610858562358, stddev=0.3334122146400735
                ),
                errorMessage=None,
                pValue=0.9344173713153225,
                pValueErrorMessage=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_one_sided_ttest_absolute(self):
        result_dict = asdict(
            OneSidedTreatmentLesserTTest(
                [(self.stat_a, self.stat_b)],
                FrequentistConfig(difference_type="absolute"),
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.23437666666666668,
                ci=(-np.inf, 0.44796185327007765),
                uplift=Uplift(
                    dist="normal", mean=0.23437666666666668, stddev=0.12983081254184736
                ),
                errorMessage=None,
                pValue=0.9644572751012698,
                pValueErrorMessage=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )


class TestSequentialOneSidedGreaterTTest(TestCase):
    def setUp(self):
        self.stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
        self.stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)

    def test_one_sided_ttest(self):
        result_dict = asdict(
            SequentialOneSidedTreatmentGreaterTTest(
                [(self.stat_a, self.stat_b)]
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.5033610858562358,
                ci=(-0.42356454602790883, np.inf),
                uplift=Uplift(
                    dist="normal", mean=0.5033610858562358, stddev=0.3334122146400735
                ),
                errorMessage=None,
                pValue=0.4999,
                pValueErrorMessage=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_one_sided_ttest_absolute(self):
        result_dict = asdict(
            SequentialOneSidedTreatmentGreaterTTest(
                [(self.stat_a, self.stat_b)],
                SequentialConfig(difference_type="absolute"),
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.23437666666666668,
                ci=(-0.12656844172804982, np.inf),
                uplift=Uplift(
                    dist="normal", mean=0.23437666666666668, stddev=0.12983081254184736
                ),
                errorMessage=None,
                pValue=0.46316491943359384,
                pValueErrorMessage=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )


class TestSequentialOneSidedLesserTTest(TestCase):
    def setUp(self):
        self.stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
        self.stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)

    def test_one_sided_ttest(self):
        result_dict = asdict(
            SequentialOneSidedTreatmentLesserTTest(
                [(self.stat_a, self.stat_b)]
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.5033610858562358,
                ci=(-np.inf, 1.4302867177403806),
                uplift=Uplift(
                    dist="normal", mean=0.5033610858562358, stddev=0.3334122146400735
                ),
                errorMessage=None,
                pValue=0.4999,
                pValueErrorMessage=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )

    def test_one_sided_ttest_absolute(self):
        result_dict = asdict(
            SequentialOneSidedTreatmentLesserTTest(
                [(self.stat_a, self.stat_b)],
                SequentialConfig(difference_type="absolute"),
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.23437666666666668,
                ci=(-np.inf, 0.5953217750613832),
                uplift=Uplift(
                    dist="normal", mean=0.23437666666666668, stddev=0.12983081254184736
                ),
                errorMessage=None,
                pValue=0.4999,
                pValueErrorMessage=None,
            )
        )
        self.assertDictEqual(
            _round_result_dict(result_dict), _round_result_dict(expected_rounded_dict)
        )


class TestScaledImpactSubUnitCluster(TestCase):
    """Sub-unit cluster mean/proportion metrics are analyzed as ratios but are
    still scalable, using the sub-unit count rather than the cluster count."""

    def setUp(self):
        # cluster = unit of analysis (n), sub-units carried in the denominator
        # baseline mean = 200/500 = 0.4, variation mean = 260/520 = 0.5
        self.stat_a = RatioStatistic(
            n=100,
            m_statistic=SampleMeanStatistic(n=100, sum=200, sum_squares=600),
            d_statistic=SampleMeanStatistic(n=100, sum=500, sum_squares=3000),
            m_d_sum_of_products=1200,
        )
        self.stat_b = RatioStatistic(
            n=100,
            m_statistic=SampleMeanStatistic(n=100, sum=260, sum_squares=900),
            d_statistic=SampleMeanStatistic(n=100, sum=520, sum_squares=3200),
            m_d_sum_of_products=1500,
        )
        self.total_users = 200  # clusters
        self.total_sub_units = 1020  # sub-units (500 + 520)

    def _result(self, difference_type, **overrides):
        config = FrequentistConfig(
            difference_type=difference_type,
            total_users=self.total_users,
            total_sub_units=self.total_sub_units,
            scale_by_sub_unit_count=True,
            traffic_percentage=1.0,
            phase_length_days=1.0,
            **overrides,
        )
        return TwoSidedTTest([(self.stat_a, self.stat_b)], config).compute_result()

    def test_scales_by_sub_unit_count(self):
        absolute = self._result("absolute")
        scaled = self._result("scaled")
        self.assertIsNone(scaled.errorMessage)
        self.assertAlmostEqual(absolute.expected, 0.1)
        # Scaled by sub-units (1020), not clusters (200)
        self.assertAlmostEqual(
            scaled.expected, absolute.expected * self.total_sub_units
        )
        self.assertNotAlmostEqual(scaled.expected, absolute.expected * self.total_users)
        assert scaled.ci is not None and absolute.ci is not None
        scaled_lo, scaled_hi = scaled.ci
        abs_lo, abs_hi = absolute.ci
        assert (
            scaled_lo is not None
            and scaled_hi is not None
            and abs_lo is not None
            and abs_hi is not None
        )
        self.assertAlmostEqual(scaled_lo, abs_lo * self.total_sub_units)
        self.assertAlmostEqual(scaled_hi, abs_hi * self.total_sub_units)
        self.assertAlmostEqual(
            scaled.uplift.stddev, absolute.uplift.stddev * self.total_sub_units
        )

    def test_ratio_ra_scales_by_sub_unit_count(self):
        stat_a = RegressionAdjustedRatioStatistic(
            n=100,
            m_statistic_post=SampleMeanStatistic(
                n=100, sum=485.112236689623, sum_squares=2715.484666118136
            ),
            d_statistic_post=SampleMeanStatistic(
                n=100, sum=679.9093275844917, sum_squares=4939.424001640236
            ),
            m_statistic_pre=SampleMeanStatistic(
                n=100, sum=192.59138069991536, sum_squares=460.076026390857
            ),
            d_statistic_pre=SampleMeanStatistic(
                n=100, sum=290.1398399750233, sum_squares=920.9461385038898
            ),
            m_post_m_pre_sum_of_products=1113.6215759318352,
            d_post_d_pre_sum_of_products=2130.9404074446747,
            m_pre_d_pre_sum_of_products=634.239482353647,
            m_post_d_post_sum_of_products=3602.146836776702,
            m_post_d_pre_sum_of_products=1559.2878434944676,
            m_pre_d_post_sum_of_products=1460.3181079276983,
            theta=None,
        )
        stat_b = RegressionAdjustedRatioStatistic(
            n=100,
            m_statistic_post=SampleMeanStatistic(
                n=100, sum=514.7757826608777, sum_squares=2994.897482705013
            ),
            d_statistic_post=SampleMeanStatistic(
                n=100, sum=705.4090874383759, sum_squares=5291.36604146392
            ),
            m_statistic_pre=SampleMeanStatistic(
                n=100, sum=206.94157227402536, sum_squares=514.2903702246757
            ),
            d_statistic_pre=SampleMeanStatistic(
                n=100, sum=302.54389139107326, sum_squares=994.4506208125663
            ),
            m_post_m_pre_sum_of_products=1237.0953021125997,
            d_post_d_pre_sum_of_products=2292.081739775257,
            m_pre_d_pre_sum_of_products=698.4173425817908,
            m_post_d_post_sum_of_products=3918.1561431600717,
            m_post_d_pre_sum_of_products=1701.0287270040265,
            m_pre_d_post_sum_of_products=1604.0759503266522,
            theta=None,
        )
        config_abs = FrequentistConfig(
            difference_type="absolute",
            total_users=200,
            total_sub_units=1000,
            scale_by_sub_unit_count=True,
        )
        config_scaled = FrequentistConfig(
            difference_type="scaled",
            total_users=200,
            total_sub_units=1000,
            scale_by_sub_unit_count=True,
        )
        absolute = TwoSidedTTest([(stat_a, stat_b)], config_abs).compute_result()
        scaled = TwoSidedTTest([(stat_a, stat_b)], config_scaled).compute_result()
        self.assertIsNone(scaled.errorMessage)
        self.assertAlmostEqual(scaled.expected, absolute.expected * 1000)

    def test_errors_when_flag_not_set(self):
        config = FrequentistConfig(
            difference_type="scaled",
            total_users=self.total_users,
            total_sub_units=self.total_sub_units,
            scale_by_sub_unit_count=False,
        )
        result = TwoSidedTTest([(self.stat_a, self.stat_b)], config).compute_result()
        self.assertIsNotNone(result.errorMessage)


if __name__ == "__main__":
    unittest_main()
