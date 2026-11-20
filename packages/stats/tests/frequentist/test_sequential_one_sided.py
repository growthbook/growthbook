from dataclasses import replace
from unittest import TestCase

import numpy as np
from scipy.optimize import brentq

from gbstats.devtools.simulation import CreateRow
from gbstats.frequentist.tests import (
    SequentialConfig,
    SequentialOneSidedTreatmentGreaterTTest,
    SequentialOneSidedTreatmentLesserTTest,
)
from gbstats.gbstats import process_single_metric
from gbstats.models.settings import (
    AnalysisSettingsForStatsEngine,
    MetricSettingsForStatsEngine,
)
from gbstats.models.statistics import SampleMeanStatistic


class TestSequentialOneSidedPValues(TestCase):
    @staticmethod
    def statistic(n, mean, sd=10):
        return SampleMeanStatistic(
            n=n, sum=n * mean, sum_squares=(n - 1) * sd**2 + n * mean**2
        )

    def test_post_stratified_harm_through_stats_runner(self):
        for inverse in (False, True):
            for difference_type in ("absolute", "relative"):
                with self.subTest(inverse=inverse, difference_type=difference_type):
                    effect = 1 if inverse else -1
                    sizes = (1000, 4000) if inverse else (4000, 1000)
                    rows = []
                    for stratum, (n, mean) in enumerate(zip(sizes, (10, 100))):
                        for variation, stat in (
                            ("0", self.statistic(n, mean)),
                            ("1", self.statistic(5000 - n, mean + effect)),
                        ):
                            rows.append(
                                CreateRow(
                                    stat,
                                    variation=variation,
                                    dimension_name="dim_exp_segment",
                                    dimension_value=str(stratum),
                                ).create_row()
                            )
                    results = process_single_metric(
                        rows=rows,
                        metric=MetricSettingsForStatsEngine(
                            id="revenue",
                            name="Revenue per user",
                            statistic_type="mean",
                            main_metric_type="count",
                            inverse=inverse,
                        ),
                        analyses=[
                            AnalysisSettingsForStatsEngine(
                                var_names=["Control", "Treatment"],
                                var_ids=["0", "1"],
                                weights=[0.5, 0.5],
                                stats_engine="frequentist",
                                difference_type=difference_type,
                                sequential_testing_enabled=True,
                                one_sided_intervals=True,
                                post_stratification_enabled=True,
                            )
                        ],
                    )
                    result = results.analyses[0].dimensions[0].variations[1]
                    self.assertIsNone(result.errorMessage)
                    self.assertTrue(result.realizedSettings.postStratificationApplied)
                    self.assertAlmostEqual(
                        result.expected,
                        effect if difference_type == "absolute" else effect / 55,
                    )
                    bound = result.ci[0] if inverse else -result.ci[1]
                    self.assertGreater(bound, 0)
                    self.assertIsNone(result.pValueErrorMessage)
                    self.assertLess(result.pValue, 0.05)

    def test_p_value_is_invariant_to_metric_units(self):
        for test_class in (
            SequentialOneSidedTreatmentGreaterTTest,
            SequentialOneSidedTreatmentLesserTTest,
        ):
            effect = (
                0.4 if test_class is SequentialOneSidedTreatmentGreaterTTest else -0.4
            )
            p_values = []
            for scale in (1e-9, 1e-6, 1, 100, 1e6):
                stats = [
                    (
                        self.statistic(5000, 10 * scale, 5 * scale),
                        self.statistic(5000, (10 + effect) * scale, 5 * scale),
                    )
                ]
                result = test_class(
                    stats, SequentialConfig(difference_type="absolute")
                ).compute_result()
                self.assertIsNone(result.pValueErrorMessage)
                p_values.append(result.pValue)
            np.testing.assert_allclose(p_values, p_values[0], rtol=1e-10)

    def test_p_value_inverts_configured_confidence_bound(self):
        stats = [
            (self.statistic(4000, 10), self.statistic(1000, 9)),
            (self.statistic(1000, 100), self.statistic(4000, 99)),
        ]
        for test_class in (
            SequentialOneSidedTreatmentGreaterTTest,
            SequentialOneSidedTreatmentLesserTTest,
        ):
            for difference_type in ("absolute", "relative", "scaled"):
                for post_stratify in (False, True):
                    config = SequentialConfig(
                        difference_type=difference_type,
                        post_stratify=post_stratify,
                        rho=0.03,
                    )
                    test = test_class(stats, config)
                    ci_index = 1 if test.lesser else 0
                    for alpha in (0.001, 0.05, 0.25):
                        target = test_class(
                            stats, replace(config, alpha=alpha)
                        ).confidence_interval[ci_index]
                        null_config = replace(config, test_value=target)
                        result = test_class(stats, null_config).compute_p_value()
                        numerical_root = brentq(
                            lambda a: test_class(
                                stats, replace(null_config, alpha=a)
                            ).confidence_interval[ci_index]
                            - target,
                            1e-5,
                            0.4999,
                            xtol=1e-14,
                        )
                        with self.subTest(
                            test_class=test_class.__name__,
                            difference_type=difference_type,
                            post_stratify=post_stratify,
                            alpha=alpha,
                        ):
                            self.assertIsNone(result.p_value_error_message)
                            self.assertAlmostEqual(
                                result.p_value, numerical_root, places=10
                            )

    def test_p_value_limits_and_extreme_effects(self):
        stats = [(self.statistic(5000, 10), self.statistic(5000, 11))]
        for test_class in (
            SequentialOneSidedTreatmentGreaterTTest,
            SequentialOneSidedTreatmentLesserTTest,
        ):
            config = SequentialConfig(difference_type="absolute")
            test = test_class(stats, config)
            direction = -1 if test.lesser else 1
            for z, expected in (
                (-1e200, 0.4999),
                (-1000, 0.4999),
                (0, 0.4999),
                (1e-10, 0.4999),
                (1000, 1e-5),
                (1e200, 1e-5),
            ):
                with self.subTest(test_class=test_class.__name__, z=z):
                    null = (
                        test.moments_result.point_estimate
                        - direction * z * test.moments_result.standard_error
                    )
                    with np.errstate(over="raise", divide="raise", invalid="raise"):
                        result = test_class(
                            stats, replace(config, test_value=null)
                        ).compute_p_value()
                    self.assertEqual(result.p_value, expected)
                    self.assertIsNone(result.p_value_error_message)
