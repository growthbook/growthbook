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
        stat_a = Statistic(value=0.41, stddev=3.9, count=3407, n=3407)
        stat_b = Statistic(value=0.7, stddev=6.2, count=3461, n=3461)
        result_dict = asdict(TwoSidedTTest(stat_a, stat_b).compute_result())
        expected_rounded_dict = asdict(
            FrequentistTestResult(
                expected=0.29,
                ci=[0.04538, 0.53462],
                uplift=Uplift("normal", 0.70732, 0.30435),
                p_value=0.02016,
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
