from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np

from gbstats.messages import ZERO_NEGATIVE_VARIANCE_MESSAGE
from gbstats.frequentist.tests import (
    FrequentistConfig,
    FrequentistTestResult,
    SequentialConfig,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
)
from gbstats.models.statistics import (
    ProportionStatistic,
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
    RegressionAdjustedRatioStatistic,
)
from gbstats.models.tests import Uplift

DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


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


class TestTwoSidedTTest(TestCase):
    def test_two_sided_ttest(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3407)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        result_dict = asdict(TwoSidedTTest(stat_a, stat_b).compute_result())
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=round_((0.7 - 0.41) / 0.41),
                ci=[-0.03526, 1.44989],
                uplift=Uplift("normal", 0.70732, 0.37879),
                p_value=0.06191,
                error_message=None,
            )
        )

        self.assertDictEqual(_round_result_dict(result_dict), expected_rounded_dict)

    def test_two_sided_ttest_absolute(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3407)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        result_dict = asdict(
            TwoSidedTTest(
                stat_a,
                stat_b,
                FrequentistConfig(difference_type="absolute"),
            ).compute_result()
        )
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.7 - 0.41,
                ci=[0.04538, 0.53462],
                uplift=Uplift("normal", 0.29, 0.12478),
                p_value=0.02016,
                error_message=None,
            )
        )

        self.assertDictEqual(_round_result_dict(result_dict), expected_rounded_dict)

    def test_two_sided_ttest_binom(self):
        stat_a = ProportionStatistic(sum=14, n=28)
        stat_b = ProportionStatistic(sum=16, n=30)
        result_dict = asdict(TwoSidedTTest(stat_a, stat_b).compute_result())
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=round_((16 / 30 - 0.5) / 0.5),
                ci=[-0.47767, 0.61101],
                uplift=Uplift("normal", 0.06667, 0.2717),
                p_value=0.80707,
                error_message=None,
            )
        )

        self.assertDictEqual(_round_result_dict(result_dict), expected_rounded_dict)

    def test_two_sided_ttest_missing_variance(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=2)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        default_output = TwoSidedTTest(stat_a, stat_b)._default_output(
            ZERO_NEGATIVE_VARIANCE_MESSAGE
        )
        result_output = TwoSidedTTest(stat_a, stat_b).compute_result()

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
        result_dict = asdict(TwoSidedTTest(stat_a, stat_b).compute_result())
        expected_dict = asdict(
            FrequentistTestResult(
                expected=-0.0007,
                ci=[-0.00841, 0.00700],
                uplift=Uplift(dist="normal", mean=-0.0007, stddev=0.00391),
                error_message=None,
                p_value=0.85771,
            )
        )
        self.assertEqual(_round_result_dict(result_dict), expected_dict)


class TestSequentialTTest(TestCase):
    def test_sequential_test_runs(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        config = SequentialConfig(sequential_tuning_parameter=1000)
        result_dict = asdict(
            SequentialTwoSidedTTest(stat_a, stat_b, config).compute_result()
        )
        expected_dict = asdict(
            FrequentistTestResult(
                expected=0.50336,
                ci=[-0.55844, 1.56516],
                uplift=Uplift("normal", 0.50336, 0.33341),
                p_value=1,
                error_message=None,
            )
        )

        self.assertEqual(_round_result_dict(result_dict), expected_dict)

    def test_sequential_test_runs_prop(self):
        stat_a = ProportionStatistic(sum=1396, n=3000)
        stat_b = ProportionStatistic(sum=2422, n=3461)
        result_dict = asdict(SequentialTwoSidedTTest(stat_a, stat_b).compute_result())
        expected_dict = asdict(
            FrequentistTestResult(
                expected=0.50386,
                ci=[0.40098, 0.60675],
                uplift=Uplift("normal", 0.50386, 0.03386),
                p_value=0.0,
                error_message=None,
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
            SequentialTwoSidedTTest(stat_a_ra, stat_b_ra).compute_result()
        )
        expected_dict = asdict(
            FrequentistTestResult(
                expected=0.50338,
                ci=[-0.50969, 1.51646],
                uplift=Uplift("normal", 0.50338, 0.33341),
                p_value=1,
                error_message=None,
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

        result_dict = asdict(SequentialTwoSidedTTest(stat_a, stat_b).compute_result())
        expected_dict = asdict(
            FrequentistTestResult(
                expected=-0.0007,
                ci=[-0.02063, 0.01923],
                uplift=Uplift(dist="normal", mean=-0.0007, stddev=0.00391),
                error_message=None,
                p_value=1.0,
            )
        )
        self.assertEqual(_round_result_dict(result_dict), expected_dict)

    def test_sequential_test_tuning_as_expected(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        config_below_n = SequentialConfig(sequential_tuning_parameter=10)
        result_below = SequentialTwoSidedTTest(
            stat_a, stat_b, config_below_n
        ).compute_result()

        config_near_n = SequentialConfig(sequential_tuning_parameter=6461)
        result_near = SequentialTwoSidedTTest(
            stat_a, stat_b, config_near_n
        ).compute_result()

        config_above_n = SequentialConfig(sequential_tuning_parameter=10000)
        result_above = SequentialTwoSidedTTest(
            stat_a, stat_b, config_above_n
        ).compute_result()

        # Way underestimating should be worse here
        self.assertTrue(
            (result_below.ci[0] < result_above.ci[0])
            and (result_below.ci[1] > result_above.ci[1])
        )
        # And estimating well should be both
        self.assertTrue(
            (result_below.ci[0] < result_near.ci[0])
            and (result_below.ci[1] > result_near.ci[1])
        )
        self.assertTrue(
            (result_above.ci[0] < result_near.ci[0])
            and (result_above.ci[1] > result_near.ci[1])
        )


if __name__ == "__main__":
    unittest_main()
