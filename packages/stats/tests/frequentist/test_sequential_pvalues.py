from dataclasses import replace
from unittest import TestCase

import numpy as np
from scipy.optimize import brentq

from gbstats.devtools.simulation import CreateRow
from gbstats.frequentist.tests import (
    SequentialConfig,
    SequentialOneSidedTreatmentGreaterTTest,
    SequentialOneSidedTreatmentLesserTTest,
    sequential_interval_halfwidth_one_sided,
)
from gbstats.gbstats import process_single_metric
from gbstats.models.settings import (
    AnalysisSettingsForStatsEngine,
    MetricSettingsForStatsEngine,
)
from gbstats.models.statistics import SampleMeanStatistic


def sample_mean(n, mean, variance=1):
    return SampleMeanStatistic(
        n=n, sum=n * mean, sum_squares=(n - 1) * variance + n * mean**2
    )


class TestSequentialOneSidedPValues(TestCase):
    def test_p_value_matches_confidence_bound_at_nonzero_null(self):
        stats = [(sample_mean(3000, 1), sample_mean(4000, 1.05))]
        for test_class in (
            SequentialOneSidedTreatmentLesserTTest,
            SequentialOneSidedTreatmentGreaterTTest,
        ):
            for difference_type in ("relative", "absolute", "scaled"):
                for alpha in (0.001, 0.05, 0.2, 0.4):
                    with self.subTest(
                        test_class=test_class,
                        difference_type=difference_type,
                        alpha=alpha,
                    ):
                        config = SequentialConfig(
                            difference_type=difference_type,
                            alpha=alpha,
                            rho=0.03,
                            total_users=7000,
                        )
                        test = test_class(stats, config)
                        bound = test.confidence_interval[1 if test.lesser else 0]
                        at_boundary = test_class(
                            stats, replace(config, test_value=bound)
                        )
                        result = at_boundary.compute_result()
                        self.assertIsNone(result.pValueErrorMessage)
                        self.assertAlmostEqual(result.pValue, alpha, places=12)

    def test_p_value_is_invariant_to_metric_units(self):
        for test_class, mean_b in (
            (SequentialOneSidedTreatmentLesserTTest, 0.925),
            (SequentialOneSidedTreatmentGreaterTTest, 1.075),
        ):
            p_values = []
            for scale in (1, 1e-9, 1e9):
                with self.subTest(test_class=test_class, scale=scale):
                    stats = [
                        (
                            sample_mean(3000, scale, scale**2),
                            sample_mean(3000, mean_b * scale, scale**2),
                        )
                    ]
                    result = test_class(
                        stats, SequentialConfig(difference_type="absolute")
                    ).compute_result()
                    self.assertIsNone(result.pValueErrorMessage)
                    self.assertLess(result.pValue, 0.05)
                    p_values.append(result.pValue)
            np.testing.assert_allclose(p_values, p_values[0], rtol=1e-12)

    def test_p_value_matches_independent_boundary_root(self):
        for test_class, mean_b in (
            (SequentialOneSidedTreatmentLesserTTest, 0.925),
            (SequentialOneSidedTreatmentGreaterTTest, 1.075),
        ):
            for rho in (None, 0.01, 0.1):
                with self.subTest(test_class=test_class, rho=rho):
                    test = test_class(
                        [(sample_mean(3000, 1), sample_mean(3000, mean_b))],
                        SequentialConfig(difference_type="absolute", rho=rho),
                    )
                    distance = abs(test.moments_result.point_estimate)

                    def boundary(alpha):
                        return (
                            sequential_interval_halfwidth_one_sided(
                                test.moments_result.standard_error**2 * test.n,
                                test.n,
                                test.sequential_tuning_parameter,
                                alpha,
                                test.rho,
                            )
                            - distance
                        )

                    expected = brentq(boundary, 1e-5, 0.4999, xtol=1e-14)
                    self.assertAlmostEqual(
                        test.compute_result().pValue, expected, places=12
                    )

    def test_p_value_preserves_reporting_limits_without_overflow(self):
        for test_class, direction in (
            (SequentialOneSidedTreatmentLesserTTest, -1),
            (SequentialOneSidedTreatmentGreaterTTest, 1),
        ):
            for effect, expected in (
                (0, 0.4999),
                (direction * 1e-12, 0.4999),
                (-direction * 0.5, 0.4999),
                (direction * 0.5, 1e-5),
            ):
                with self.subTest(test_class=test_class, effect=effect):
                    test = test_class(
                        [
                            (
                                sample_mean(100000, 1),
                                sample_mean(100000, 1 + effect),
                            )
                        ],
                        SequentialConfig(difference_type="absolute"),
                    )
                    with np.errstate(over="raise", divide="raise", invalid="raise"):
                        result = test.compute_result()
                    self.assertEqual(result.pValue, expected)
                    self.assertIsNone(result.pValueErrorMessage)

    def test_stratified_runner_uses_the_reported_effect_and_uncertainty(self):
        for inverse in (False, True):
            for harmful in (False, True):
                for difference_type in ("relative", "absolute", "scaled"):
                    with self.subTest(
                        inverse=inverse,
                        harmful=harmful,
                        difference_type=difference_type,
                    ):
                        direction = 1 if inverse else -1
                        effect = direction * (0.1 if harmful else -0.1)
                        # Unequal stratum mixes make the pooled effect have the
                        # opposite sign from the within-stratum treatment effect.
                        control_counts = (9000, 1000) if effect < 0 else (1000, 9000)
                        stats = [
                            (
                                sample_mean(n_a, mean),
                                sample_mean(10000 - n_a, mean + effect),
                            )
                            for n_a, mean in zip(control_counts, (1, 10))
                        ]
                        rows = [
                            CreateRow(
                                stat,
                                variation=str(variation),
                                dimension_name="dim_exp_segment",
                                dimension_value=str(segment),
                            ).create_row()
                            for segment, pair in enumerate(stats)
                            for variation, stat in enumerate(pair)
                        ]
                        analysis = AnalysisSettingsForStatsEngine(
                            var_names=["Control", "Treatment"],
                            var_ids=["0", "1"],
                            weights=[0.5, 0.5],
                            stats_engine="frequentist",
                            sequential_testing_enabled=True,
                            one_sided_intervals=True,
                            post_stratification_enabled=True,
                            difference_type=difference_type,
                        )
                        metric = MetricSettingsForStatsEngine(
                            id="revenue",
                            name="Revenue",
                            statistic_type="mean",
                            main_metric_type="count",
                            business_metric_type=["guardrail"],
                            inverse=inverse,
                        )
                        result = (
                            process_single_metric(
                                rows=rows, metric=metric, analyses=[analysis]
                            )
                            .analyses[0]
                            .dimensions[0]
                            .variations[1]
                        )
                        self.assertTrue(
                            result.realizedSettings.postStratificationApplied
                        )
                        self.assertIsNone(result.errorMessage)
                        self.assertIsNone(result.pValueErrorMessage)
                        self.assertEqual(result.pValue < analysis.alpha, harmful)
                        bound = result.ci[0 if inverse else 1]
                        self.assertEqual(direction * bound > 0, harmful)
                        if not harmful:
                            self.assertEqual(result.pValue, 0.4999)
                        else:
                            test_class = (
                                SequentialOneSidedTreatmentGreaterTTest
                                if inverse
                                else SequentialOneSidedTreatmentLesserTTest
                            )
                            test = test_class(
                                stats,
                                SequentialConfig(
                                    difference_type=difference_type,
                                    post_stratify=True,
                                ),
                            )
                            at_p_value = test_class(
                                stats,
                                SequentialConfig(
                                    difference_type=difference_type,
                                    post_stratify=True,
                                    alpha=result.pValue,
                                    rho=test.rho,
                                ),
                            )
                            self.assertAlmostEqual(
                                at_p_value.confidence_interval[0 if inverse else 1],
                                0,
                                places=12,
                            )
