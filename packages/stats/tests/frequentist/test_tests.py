from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np

from gbstats.frequentist.tests import TwoSidedTTest
from gbstats.shared.models import (
    FrequentistTestResult,
    ProportionStatistic,
    SampleMeanStatistic,
    Uplift,
)

DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


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
            )
        )

        # round result
        for k, v in result_dict.items():
            if k == "uplift":
                v = {
                    kk: round_(vv) if isinstance(vv, float) else vv
                    for kk, vv in v.items()
                }
            else:
                v = [round_(x) for x in v] if isinstance(v, list) else round_(v)
            result_dict[k] = v

        self.assertDictEqual(result_dict, expected_rounded_dict)

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
            )
        )

        # round result
        for k, v in result_dict.items():
            if k == "uplift":
                v = {
                    kk: round_(vv) if isinstance(vv, float) else vv
                    for kk, vv in v.items()
                }
            else:
                v = [round_(x) for x in v] if isinstance(v, list) else round_(v)
            result_dict[k] = v

        self.assertDictEqual(result_dict, expected_rounded_dict)

    def test_two_sided_ttest_missing_variance(self):
        stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=2)
        stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
        default_output = TwoSidedTTest(stat_a, stat_b)._default_output()
        result_output = TwoSidedTTest(stat_a, stat_b).compute_result()

        self.assertEqual(default_output, result_output)


if __name__ == "__main__":
    unittest_main()
