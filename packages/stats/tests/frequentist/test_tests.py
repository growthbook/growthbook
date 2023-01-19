from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np

from gbstats.frequentist.tests import TwoSidedTTest
from gbstats.shared.models import FrequentistTestResult, Statistic, Uplift

DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


class TestTwoSidedTTest(TestCase):
    def test_two_sided_ttest(self):
        ctrl_mean = 0.41
        tau = 0.29
        stat_a = Statistic(value=ctrl_mean, stddev=3.9, count=3407, n=3407)
        stat_b = Statistic(value=ctrl_mean + tau, stddev=6.2, count=3461, n=3461)
        result_dict = asdict(TwoSidedTTest(stat_a, stat_b).compute_result())
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=round_(tau / ctrl_mean),
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


if __name__ == "__main__":
    unittest_main()
