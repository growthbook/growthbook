#!/usr/bin/env python3
"""
Generate JSON fixtures from Python gbstats tests for TypeScript test parity.

Run from packages/tsgbstats:
    pnpm fixtures:generate
Or directly:
    cd packages/stats && poetry run python ../tsgbstats/scripts/generate-fixtures.py
"""

import json
import os
import sys
from dataclasses import asdict
from typing import Any, Dict, List, Optional
from functools import partial
import copy

import numpy as np
from scipy.stats import norm

# Add gbstats to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'stats'))

from gbstats import __version__ as gbstats_version
from gbstats.messages import ZERO_NEGATIVE_VARIANCE_MESSAGE
from gbstats.models.statistics import (
    SampleMeanStatistic,
    ProportionStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
    RegressionAdjustedRatioStatistic,
    QuantileStatistic,
    compute_theta,
)
from gbstats.models.results import Uplift
from gbstats.frequentist.tests import (
    FrequentistConfig,
    FrequentistTestResult,
    SequentialConfig,
    TwoSidedTTest,
    SequentialTwoSidedTTest,
    OneSidedTreatmentGreaterTTest,
    OneSidedTreatmentLesserTTest,
    SequentialOneSidedTreatmentGreaterTTest,
    SequentialOneSidedTreatmentLesserTTest,
)
from gbstats.bayesian.tests import (
    GaussianPrior,
    EffectBayesianABTest,
    EffectBayesianConfig,
)
from gbstats.models.tests import (
    EffectMoments,
    EffectMomentsConfig,
    EffectMomentsPostStratification,
    sum_stats,
    BaseConfig,
)
from gbstats.power.midexperimentpower import MidExperimentPowerConfig, MidExperimentPower
from gbstats.utils import multinomial_covariance
from gbstats.messages import BASELINE_VARIATION_ZERO_MESSAGE
from gbstats.gbstats import (
    AnalysisSettingsForStatsEngine,
    MetricSettingsForStatsEngine,
    detect_unknown_variations,
    get_metric_dfs,
    reduce_dimensionality,
    analyze_metric_df,
    variation_statistic_from_metric_row,
    process_analysis,
)
import pandas as pd
import dataclasses

DECIMALS = 5
FIXTURES_DIR = os.path.join(os.path.dirname(__file__), '..', 'test', 'fixtures')


class InfinityHandlingEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles Infinity values."""
    def encode(self, obj):
        # Convert to a temp representation, then post-process
        return super().encode(self._convert_infinity(obj))

    def _convert_infinity(self, obj):
        if isinstance(obj, float):
            if obj == float('inf'):
                return "Infinity"
            elif obj == float('-inf'):
                return "-Infinity"
            elif obj != obj:  # NaN check
                return "NaN"
        elif isinstance(obj, dict):
            return {k: self._convert_infinity(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [self._convert_infinity(item) for item in obj]
        return obj


def round_if_not_none(x: Optional[float], decimals: int):
    if x is None:
        return None
    if np.isinf(x) or np.isnan(x):
        return float(x)  # Keep inf/nan as-is
    return float(np.round(x, decimals))


round_ = partial(round_if_not_none, decimals=DECIMALS)


def round_result_dict(result_dict: Dict) -> Dict:
    """Round numeric values in result dict to DECIMALS precision."""
    rounded = {}
    for k, v in result_dict.items():
        if k in ["error_message", "risk_type", "p_value_error_message"]:
            rounded[k] = v
        elif k == "uplift":
            rounded[k] = {
                kk: round_(vv) if isinstance(vv, float) else vv
                for kk, vv in v.items()
            }
        elif isinstance(v, (list, tuple)):
            rounded[k] = [round_(x) if isinstance(x, (int, float)) and x is not None else x for x in v]
        elif isinstance(v, (int, float)) and v is not None:
            rounded[k] = round_(v)
        else:
            rounded[k] = v
    return rounded


def serialize_statistic(stat) -> Dict:
    """Serialize a statistic to a JSON-compatible dict."""
    if isinstance(stat, SampleMeanStatistic):
        return {"type": "SampleMeanStatistic", "n": stat.n, "sum": stat.sum, "sum_squares": stat.sum_squares}
    elif isinstance(stat, ProportionStatistic):
        return {"type": "ProportionStatistic", "n": stat.n, "sum": stat.sum}
    elif isinstance(stat, RatioStatistic):
        return {
            "type": "RatioStatistic",
            "n": stat.n,
            "m_statistic": serialize_statistic(stat.m_statistic),
            "d_statistic": serialize_statistic(stat.d_statistic),
            "m_d_sum_of_products": stat.m_d_sum_of_products,
        }
    elif isinstance(stat, RegressionAdjustedStatistic):
        return {
            "type": "RegressionAdjustedStatistic",
            "n": stat.n,
            "post_statistic": serialize_statistic(stat.post_statistic),
            "pre_statistic": serialize_statistic(stat.pre_statistic),
            "post_pre_sum_of_products": stat.post_pre_sum_of_products,
            "theta": stat.theta,
        }
    elif isinstance(stat, RegressionAdjustedRatioStatistic):
        return {
            "type": "RegressionAdjustedRatioStatistic",
            "n": stat.n,
            "m_statistic_post": serialize_statistic(stat.m_statistic_post),
            "d_statistic_post": serialize_statistic(stat.d_statistic_post),
            "m_statistic_pre": serialize_statistic(stat.m_statistic_pre),
            "d_statistic_pre": serialize_statistic(stat.d_statistic_pre),
            "m_post_m_pre_sum_of_products": stat.m_post_m_pre_sum_of_products,
            "d_post_d_pre_sum_of_products": stat.d_post_d_pre_sum_of_products,
            "m_pre_d_pre_sum_of_products": stat.m_pre_d_pre_sum_of_products,
            "m_post_d_post_sum_of_products": stat.m_post_d_post_sum_of_products,
            "m_post_d_pre_sum_of_products": stat.m_post_d_pre_sum_of_products,
            "m_pre_d_post_sum_of_products": stat.m_pre_d_post_sum_of_products,
            "theta": stat.theta,
        }
    elif isinstance(stat, QuantileStatistic):
        return {
            "type": "QuantileStatistic",
            "n": stat.n,
            "n_star": stat.n_star,
            "nu": stat.nu,
            "quantile_hat": stat.quantile_hat,
            "quantile_lower": stat.quantile_lower,
            "quantile_upper": stat.quantile_upper,
        }
    else:
        raise ValueError(f"Unknown statistic type: {type(stat)}")


def serialize_config(config) -> Dict:
    """Serialize a config to a JSON-compatible dict."""
    if isinstance(config, SequentialConfig):
        return {
            "type": "SequentialConfig",
            "difference_type": config.difference_type,
            "alpha": config.alpha,
            "sequential_tuning_parameter": config.sequential_tuning_parameter,
            "rho": config.rho,
        }
    elif isinstance(config, FrequentistConfig):
        return {
            "type": "FrequentistConfig",
            "difference_type": config.difference_type,
            "alpha": config.alpha,
        }
    elif isinstance(config, EffectBayesianConfig):
        return {
            "type": "EffectBayesianConfig",
            "difference_type": config.difference_type,
            "alpha": config.alpha,
            "prior_effect": {
                "mean": config.prior_effect.mean,
                "variance": config.prior_effect.variance,
                "proper": config.prior_effect.proper,
            },
        }
    else:
        return asdict(config)


def generate_frequentist_fixtures() -> Dict:
    """Generate fixtures for frequentist tests."""
    fixtures = {
        "metadata": {"gbstats_version": gbstats_version, "decimals": DECIMALS},
        "test_cases": {},
    }

    # TwoSidedTTest fixtures
    stat_a = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3407)
    stat_b = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
    config_rel = FrequentistConfig(difference_type="relative")
    config_abs = FrequentistConfig(difference_type="absolute")

    fixtures["test_cases"]["TwoSidedTTest"] = {
        "test_two_sided_ttest": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a),
                "stat_b": serialize_statistic(stat_b),
                "config": serialize_config(config_rel),
            },
            "expected": round_result_dict(asdict(TwoSidedTTest([(stat_a, stat_b)], config_rel).compute_result())),
        },
        "test_two_sided_ttest_absolute": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a),
                "stat_b": serialize_statistic(stat_b),
                "config": serialize_config(config_abs),
            },
            "expected": round_result_dict(asdict(TwoSidedTTest([(stat_a, stat_b)], config_abs).compute_result())),
        },
        "test_two_sided_ttest_binom": {
            "inputs": {
                "stat_a": serialize_statistic(ProportionStatistic(sum=14, n=28)),
                "stat_b": serialize_statistic(ProportionStatistic(sum=16, n=30)),
                "config": serialize_config(config_rel),
            },
            "expected": round_result_dict(asdict(TwoSidedTTest(
                [(ProportionStatistic(sum=14, n=28), ProportionStatistic(sum=16, n=30))],
                config_rel
            ).compute_result())),
        },
        "test_two_sided_ttest_missing_variance": {
            "inputs": {
                "stat_a": serialize_statistic(SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=2)),
                "stat_b": serialize_statistic(stat_b),
                "config": serialize_config(config_rel),
            },
            "expected": round_result_dict(asdict(TwoSidedTTest(
                [(SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=2), stat_b)],
                config_rel
            ).compute_result())),
        },
    }

    # RegressionAdjustedRatioStatistic test
    stat_a_rars = RegressionAdjustedRatioStatistic(
        n=100,
        m_statistic_post=SampleMeanStatistic(n=100, sum=485.112236689623, sum_squares=2715.484666118136),
        d_statistic_post=SampleMeanStatistic(n=100, sum=679.9093275844917, sum_squares=4939.424001640236),
        m_statistic_pre=SampleMeanStatistic(n=100, sum=192.59138069991536, sum_squares=460.076026390857),
        d_statistic_pre=SampleMeanStatistic(n=100, sum=290.1398399750233, sum_squares=920.9461385038898),
        m_post_m_pre_sum_of_products=1113.6215759318352,
        d_post_d_pre_sum_of_products=2130.9404074446747,
        m_pre_d_pre_sum_of_products=634.239482353647,
        m_post_d_post_sum_of_products=3602.146836776702,
        m_post_d_pre_sum_of_products=1559.2878434944676,
        m_pre_d_post_sum_of_products=1460.3181079276983,
        theta=None,
    )
    stat_b_rars = RegressionAdjustedRatioStatistic(
        n=100,
        m_statistic_post=SampleMeanStatistic(n=100, sum=514.7757826608777, sum_squares=2994.897482705013),
        d_statistic_post=SampleMeanStatistic(n=100, sum=705.4090874383759, sum_squares=5291.36604146392),
        m_statistic_pre=SampleMeanStatistic(n=100, sum=206.94157227402536, sum_squares=514.2903702246757),
        d_statistic_pre=SampleMeanStatistic(n=100, sum=302.54389139107326, sum_squares=994.4506208125663),
        m_post_m_pre_sum_of_products=1237.0953021125997,
        d_post_d_pre_sum_of_products=2292.081739775257,
        m_pre_d_pre_sum_of_products=698.4173425817908,
        m_post_d_post_sum_of_products=3918.1561431600717,
        m_post_d_pre_sum_of_products=1701.0287270040265,
        m_pre_d_post_sum_of_products=1604.0759503266522,
        theta=None,
    )

    fixtures["test_cases"]["TwoSidedTTest"]["test_two_sided_ttest_ratio_ra"] = {
        "inputs": {
            "stat_a": serialize_statistic(stat_a_rars),
            "stat_b": serialize_statistic(stat_b_rars),
            "config": serialize_config(config_rel),
        },
        "expected": round_result_dict(asdict(TwoSidedTTest([(stat_a_rars, stat_b_rars)], config_rel).compute_result())),
    }

    # SequentialTwoSidedTTest fixtures
    stat_a_seq = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
    stat_b_seq = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
    seq_config = SequentialConfig(sequential_tuning_parameter=1000)

    fixtures["test_cases"]["SequentialTwoSidedTTest"] = {
        "test_sequential_test_runs": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_seq),
                "stat_b": serialize_statistic(stat_b_seq),
                "config": serialize_config(seq_config),
            },
            "expected": round_result_dict(asdict(SequentialTwoSidedTTest([(stat_a_seq, stat_b_seq)], seq_config).compute_result())),
        },
        "test_sequential_test_runs_prop": {
            "inputs": {
                "stat_a": serialize_statistic(ProportionStatistic(sum=1396, n=3000)),
                "stat_b": serialize_statistic(ProportionStatistic(sum=2422, n=3461)),
                "config": serialize_config(SequentialConfig()),
            },
            "expected": round_result_dict(asdict(SequentialTwoSidedTTest(
                [(ProportionStatistic(sum=1396, n=3000), ProportionStatistic(sum=2422, n=3461))]
            ).compute_result())),
        },
    }

    # Sequential RA test
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

    fixtures["test_cases"]["SequentialTwoSidedTTest"]["test_sequential_test_runs_ra"] = {
        "inputs": {
            "stat_a": serialize_statistic(stat_a_ra),
            "stat_b": serialize_statistic(stat_b_ra),
            "config": serialize_config(SequentialConfig()),
        },
        "expected": round_result_dict(asdict(SequentialTwoSidedTTest([(stat_a_ra, stat_b_ra)]).compute_result())),
    }

    # Sequential ratio_ra test
    fixtures["test_cases"]["SequentialTwoSidedTTest"]["test_sequential_test_runs_ratio_ra"] = {
        "inputs": {
            "stat_a": serialize_statistic(stat_a_rars),
            "stat_b": serialize_statistic(stat_b_rars),
            "config": serialize_config(SequentialConfig()),
        },
        "expected": round_result_dict(asdict(SequentialTwoSidedTTest([(stat_a_rars, stat_b_rars)]).compute_result())),
    }

    # Sequential tuning test - tests that tuning parameter affects CI width
    stat_a_tune = SampleMeanStatistic(sum=1396.87, sum_squares=52377.9767, n=3000)
    stat_b_tune = SampleMeanStatistic(sum=2422.7, sum_squares=134698.29, n=3461)
    config_below_n = SequentialConfig(sequential_tuning_parameter=10)
    config_near_n = SequentialConfig(sequential_tuning_parameter=6461)
    config_above_n = SequentialConfig(sequential_tuning_parameter=10000)

    result_below = SequentialTwoSidedTTest([(stat_a_tune, stat_b_tune)], config_below_n).compute_result()
    result_near = SequentialTwoSidedTTest([(stat_a_tune, stat_b_tune)], config_near_n).compute_result()
    result_above = SequentialTwoSidedTTest([(stat_a_tune, stat_b_tune)], config_above_n).compute_result()

    fixtures["test_cases"]["SequentialTwoSidedTTest"]["test_sequential_test_tuning_as_expected"] = {
        "inputs": {
            "stat_a": serialize_statistic(stat_a_tune),
            "stat_b": serialize_statistic(stat_b_tune),
            "config_below_n": serialize_config(config_below_n),
            "config_near_n": serialize_config(config_near_n),
            "config_above_n": serialize_config(config_above_n),
        },
        "expected": {
            "result_below": round_result_dict(asdict(result_below)),
            "result_near": round_result_dict(asdict(result_near)),
            "result_above": round_result_dict(asdict(result_above)),
            # Way underestimating should be worse (wider CI)
            "below_wider_than_above": (result_below.ci[0] < result_above.ci[0]) and (result_below.ci[1] > result_above.ci[1]),
            # Estimating well should be best
            "below_wider_than_near": (result_below.ci[0] < result_near.ci[0]) and (result_below.ci[1] > result_near.ci[1]),
            "above_wider_than_near": (result_above.ci[0] < result_near.ci[0]) and (result_above.ci[1] > result_near.ci[1]),
        },
    }

    # OneSidedTTest fixtures
    fixtures["test_cases"]["OneSidedTreatmentGreaterTTest"] = {
        "test_one_sided_ttest": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_seq),
                "stat_b": serialize_statistic(stat_b_seq),
                "config": serialize_config(FrequentistConfig()),
            },
            "expected": round_result_dict(asdict(OneSidedTreatmentGreaterTTest([(stat_a_seq, stat_b_seq)]).compute_result())),
        },
        "test_one_sided_ttest_absolute": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_seq),
                "stat_b": serialize_statistic(stat_b_seq),
                "config": serialize_config(FrequentistConfig(difference_type="absolute")),
            },
            "expected": round_result_dict(asdict(OneSidedTreatmentGreaterTTest(
                [(stat_a_seq, stat_b_seq)], FrequentistConfig(difference_type="absolute")
            ).compute_result())),
        },
    }

    fixtures["test_cases"]["OneSidedTreatmentLesserTTest"] = {
        "test_one_sided_ttest": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_seq),
                "stat_b": serialize_statistic(stat_b_seq),
                "config": serialize_config(FrequentistConfig()),
            },
            "expected": round_result_dict(asdict(OneSidedTreatmentLesserTTest([(stat_a_seq, stat_b_seq)]).compute_result())),
        },
        "test_one_sided_ttest_absolute": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_seq),
                "stat_b": serialize_statistic(stat_b_seq),
                "config": serialize_config(FrequentistConfig(difference_type="absolute")),
            },
            "expected": round_result_dict(asdict(OneSidedTreatmentLesserTTest(
                [(stat_a_seq, stat_b_seq)], FrequentistConfig(difference_type="absolute")
            ).compute_result())),
        },
    }

    # SequentialOneSidedTTest fixtures
    fixtures["test_cases"]["SequentialOneSidedTreatmentGreaterTTest"] = {
        "test_one_sided_ttest": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_seq),
                "stat_b": serialize_statistic(stat_b_seq),
                "config": serialize_config(SequentialConfig()),
            },
            "expected": round_result_dict(asdict(SequentialOneSidedTreatmentGreaterTTest([(stat_a_seq, stat_b_seq)]).compute_result())),
        },
        "test_one_sided_ttest_absolute": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_seq),
                "stat_b": serialize_statistic(stat_b_seq),
                "config": serialize_config(SequentialConfig(difference_type="absolute")),
            },
            "expected": round_result_dict(asdict(SequentialOneSidedTreatmentGreaterTTest(
                [(stat_a_seq, stat_b_seq)], SequentialConfig(difference_type="absolute")
            ).compute_result())),
        },
    }

    fixtures["test_cases"]["SequentialOneSidedTreatmentLesserTTest"] = {
        "test_one_sided_ttest": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_seq),
                "stat_b": serialize_statistic(stat_b_seq),
                "config": serialize_config(SequentialConfig()),
            },
            "expected": round_result_dict(asdict(SequentialOneSidedTreatmentLesserTTest([(stat_a_seq, stat_b_seq)]).compute_result())),
        },
        "test_one_sided_ttest_absolute": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_seq),
                "stat_b": serialize_statistic(stat_b_seq),
                "config": serialize_config(SequentialConfig(difference_type="absolute")),
            },
            "expected": round_result_dict(asdict(SequentialOneSidedTreatmentLesserTTest(
                [(stat_a_seq, stat_b_seq)], SequentialConfig(difference_type="absolute")
            ).compute_result())),
        },
    }

    return fixtures


def generate_bayesian_fixtures() -> Dict:
    """Generate fixtures for Bayesian tests."""
    fixtures = {
        "metadata": {"gbstats_version": gbstats_version, "decimals": DECIMALS},
        "test_cases": {},
    }

    # Binomial test
    stat_a_binom = ProportionStatistic(sum=49, n=100)
    stat_b_binom = ProportionStatistic(sum=51, n=100)

    fixtures["test_cases"]["TestBinom"] = {
        "test_bayesian_binomial_ab_test": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_binom),
                "stat_b": serialize_statistic(stat_b_binom),
                "config": serialize_config(EffectBayesianConfig()),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest([(stat_a_binom, stat_b_binom)]).compute_result())),
        },
        "test_missing_data": {
            "inputs": {
                "stat_a": serialize_statistic(ProportionStatistic(0, 0)),
                "stat_b": serialize_statistic(ProportionStatistic(0, 0)),
                "config": serialize_config(EffectBayesianConfig()),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest(
                [(ProportionStatistic(0, 0), ProportionStatistic(0, 0))]
            ).compute_result())),
        },
    }

    # Gaussian tests
    stat_a_norm = SampleMeanStatistic(sum=100, sum_squares=1002.25, n=10)
    stat_b_norm = SampleMeanStatistic(sum=105, sum_squares=1111.5, n=10)

    fixtures["test_cases"]["TestNorm"] = {
        "test_bayesian_gaussian_ab_test": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_norm),
                "stat_b": serialize_statistic(stat_b_norm),
                "config": serialize_config(EffectBayesianConfig()),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest([(stat_a_norm, stat_b_norm)]).compute_result())),
        },
        "test_bayesian_gaussian_ab_test_informative": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a_norm),
                "stat_b": serialize_statistic(stat_b_norm),
                "config": serialize_config(EffectBayesianConfig(
                    prior_effect=GaussianPrior(mean=0.1, variance=0.1, proper=True)
                )),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest(
                [(stat_a_norm, stat_b_norm)],
                EffectBayesianConfig(prior_effect=GaussianPrior(mean=0.1, variance=0.1, proper=True))
            ).compute_result())),
        },
        "test_missing_data": {
            "inputs": {
                "stat_a": serialize_statistic(SampleMeanStatistic(0, 0, 0)),
                "stat_b": serialize_statistic(SampleMeanStatistic(0, 0, 0)),
                "config": serialize_config(EffectBayesianConfig()),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest(
                [(SampleMeanStatistic(0, 0, 0), SampleMeanStatistic(0, 0, 0))]
            ).compute_result())),
        },
    }

    # Quantile test
    nu = 0.9
    n_c = 11054
    n_t = 10861
    q_stat_c = QuantileStatistic(
        n=n_c, n_star=n_c, nu=nu,
        quantile_hat=7.157987489967789,
        quantile_lower=7.098780136176828,
        quantile_upper=7.217194843758751,
    )
    q_stat_t = QuantileStatistic(
        n=n_t, n_star=n_t, nu=nu,
        quantile_hat=7.694499927525767,
        quantile_lower=7.64180598628119,
        quantile_upper=7.747193868770344,
    )

    gaussian_improper_flat_prior = GaussianPrior(proper=False)
    gaussian_flat_prior = GaussianPrior(variance=float(1e6), proper=True)
    gaussian_inf_prior = GaussianPrior(variance=float(1), proper=True)

    effect_config_improper_flat = EffectBayesianConfig(
        difference_type="absolute",
        prior_effect=gaussian_improper_flat_prior
    )
    effect_config_flat = EffectBayesianConfig(
        difference_type="absolute",
        prior_effect=gaussian_flat_prior
    )
    effect_config_inf = EffectBayesianConfig(
        difference_type="absolute",
        prior_effect=gaussian_inf_prior
    )
    effect_config_flat_rel = EffectBayesianConfig(
        difference_type="relative",
        prior_effect=gaussian_flat_prior
    )
    effect_config_inf_rel = EffectBayesianConfig(
        difference_type="relative",
        prior_effect=gaussian_inf_prior
    )

    fixtures["test_cases"]["TestEffectBayesianABTest"] = {
        "test_quantile_improper_flat": {
            "inputs": {
                "stat_a": serialize_statistic(q_stat_c),
                "stat_b": serialize_statistic(q_stat_t),
                "config": serialize_config(effect_config_improper_flat),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest(
                [(q_stat_c, q_stat_t)], effect_config_improper_flat
            ).compute_result())),
        },
        "test_quantile_absolute_flat": {
            "inputs": {
                "stat_a": serialize_statistic(q_stat_c),
                "stat_b": serialize_statistic(q_stat_t),
                "config": serialize_config(effect_config_flat),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest(
                [(q_stat_c, q_stat_t)], effect_config_flat
            ).compute_result())),
        },
        "test_quantile_relative_flat": {
            "inputs": {
                "stat_a": serialize_statistic(q_stat_c),
                "stat_b": serialize_statistic(q_stat_t),
                "config": serialize_config(effect_config_flat_rel),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest(
                [(q_stat_c, q_stat_t)], effect_config_flat_rel
            ).compute_result())),
        },
        "test_quantile_absolute_informative": {
            "inputs": {
                "stat_a": serialize_statistic(q_stat_c),
                "stat_b": serialize_statistic(q_stat_t),
                "config": serialize_config(effect_config_inf),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest(
                [(q_stat_c, q_stat_t)], effect_config_inf
            ).compute_result())),
        },
        "test_quantile_relative_informative": {
            "inputs": {
                "stat_a": serialize_statistic(q_stat_c),
                "stat_b": serialize_statistic(q_stat_t),
                "config": serialize_config(effect_config_inf_rel),
            },
            "expected": round_result_dict(asdict(EffectBayesianABTest(
                [(q_stat_c, q_stat_t)], effect_config_inf_rel
            ).compute_result())),
        },
    }

    # Risk calculation test with modified quantile bounds (from Python test_bayesian_quantile_metric)
    # Uses quantile_lower = quantile_hat - s and quantile_upper = quantile_hat + s where s = 1
    s = 1
    quantile_hat_c = q_stat_c.quantile_hat
    quantile_hat_t = q_stat_t.quantile_hat
    q_stat_c_risk = QuantileStatistic(
        n=n_c, n_star=n_c, nu=nu,
        quantile_hat=quantile_hat_c,
        quantile_lower=quantile_hat_c - s,
        quantile_upper=quantile_hat_c + s,
    )
    q_stat_t_risk = QuantileStatistic(
        n=n_t, n_star=n_t, nu=nu,
        quantile_hat=quantile_hat_t,
        quantile_lower=quantile_hat_t - s,
        quantile_upper=quantile_hat_t + s,
    )

    risk_result = EffectBayesianABTest([(q_stat_c_risk, q_stat_t_risk)], effect_config_flat).compute_result()
    fixtures["test_cases"]["TestEffectBayesianABTest"]["test_quantile_risk_calculation"] = {
        "inputs": {
            "stat_a": serialize_statistic(q_stat_c_risk),
            "stat_b": serialize_statistic(q_stat_t_risk),
            "config": serialize_config(effect_config_flat),
        },
        "expected": round_result_dict(asdict(risk_result)),
        "validation": {
            "risk_0": round_(risk_result.risk[0]),  # Control risk
            "risk_1": round_(risk_result.risk[1]),  # Treatment risk
            "expected": round_(risk_result.expected),
            "ci_lower": round_(risk_result.ci[0]),
            "ci_upper": round_(risk_result.ci[1]),
        },
    }

    # Gaussian effect relative/absolute priors test
    stat_c = SampleMeanStatistic(n=100, sum=1000, sum_squares=200000)
    stat_t = SampleMeanStatistic(n=100, sum=1100, sum_squares=200005)
    gaussian_inf_prior_effect = GaussianPrior(mean=1, variance=1, proper=True)
    abs_config_inf = EffectBayesianConfig(
        difference_type="absolute",
        prior_effect=gaussian_inf_prior_effect
    )
    rel_config_inf = EffectBayesianConfig(
        difference_type="relative",
        prior_effect=gaussian_inf_prior_effect
    )

    fixtures["test_cases"]["TestGaussianEffectRelativeAbsolutePriors"] = {
        "test_bayesian_effect_relative_effect": {
            "inputs": {
                "stat_a": serialize_statistic(stat_c),
                "stat_b": serialize_statistic(stat_t),
                "config_absolute": serialize_config(abs_config_inf),
                "config_relative": serialize_config(rel_config_inf),
            },
            "expected": {
                "absolute_result": round_result_dict(asdict(EffectBayesianABTest(
                    [(stat_c, stat_t)], abs_config_inf
                ).compute_result())),
                "relative_result": round_result_dict(asdict(EffectBayesianABTest(
                    [(stat_c, stat_t)], rel_config_inf
                ).compute_result())),
            },
        },
    }

    return fixtures


def generate_statistics_fixtures() -> Dict:
    """Generate fixtures for statistics classes."""
    fixtures = {
        "metadata": {"gbstats_version": gbstats_version, "decimals": DECIMALS},
        "test_cases": {},
    }

    # Test data
    METRIC_1 = [0.3, 0.5, 0.9, 22]
    METRIC_2 = [1, 1, 1]
    METRIC_3 = [2, 1, 5, 3]
    N = 4

    # SampleMeanStatistic
    stat = SampleMeanStatistic(
        sum=sum(METRIC_1),
        sum_squares=sum(x**2 for x in METRIC_1),
        n=N
    )
    fixtures["test_cases"]["SampleMeanStatistic"] = {
        "test_sample_mean_statistic": {
            "inputs": {
                "n": N,
                "sum": sum(METRIC_1),
                "sum_squares": sum(x**2 for x in METRIC_1),
            },
            "expected": {
                "mean": float(np.mean(METRIC_1)),
                "variance": float(np.var(METRIC_1, ddof=1)),
            },
        },
        "test_sample_mean_statistic_low_n": {
            "inputs": {"n": 1, "sum": sum(METRIC_1), "sum_squares": sum(x**2 for x in METRIC_1)},
            "expected": {"variance": 0},
        },
    }

    # ProportionStatistic
    fixtures["test_cases"]["ProportionStatistic"] = {
        "test_proportion_statistic": {
            "inputs": {"n": N, "sum": sum(METRIC_2)},
            "expected": {
                "mean": sum(METRIC_2) / N,
                "variance": (sum(METRIC_2) / N) * (1 - sum(METRIC_2) / N),
            },
        },
    }

    # RatioStatistic
    m_stat = SampleMeanStatistic(sum=sum(METRIC_1), sum_squares=sum(x**2 for x in METRIC_1), n=N)
    d_stat = SampleMeanStatistic(sum=sum(METRIC_3), sum_squares=sum(x**2 for x in METRIC_3), n=N)
    ratio_stat = RatioStatistic(
        m_statistic=m_stat,
        d_statistic=d_stat,
        m_d_sum_of_products=float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
        n=N,
    )
    expected_cov = np.cov(METRIC_1, METRIC_3)

    # Zero denominator test
    m_stat_zero = SampleMeanStatistic(sum=sum(METRIC_1), sum_squares=sum(x**2 for x in METRIC_1), n=N)
    d_stat_zero = SampleMeanStatistic(sum=0, sum_squares=sum(x**2 for x in METRIC_3), n=N)
    ratio_stat_zero = RatioStatistic(
        m_statistic=m_stat_zero,
        d_statistic=d_stat_zero,
        m_d_sum_of_products=float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
        n=N,
    )

    fixtures["test_cases"]["RatioStatistic"] = {
        "test_ratio_statistic_covariance": {
            "inputs": {
                "m_statistic": serialize_statistic(m_stat),
                "d_statistic": serialize_statistic(d_stat),
                "m_d_sum_of_products": float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
                "n": N,
            },
            "expected": {"covariance": float(expected_cov[0, 1])},
        },
        "test_ratio_denom_zero": {
            "inputs": {
                "m_statistic": serialize_statistic(m_stat_zero),
                "d_statistic": serialize_statistic(d_stat_zero),
                "m_d_sum_of_products": float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
                "n": N,
            },
            "expected": {"variance": 0},
        },
    }

    # RegressionAdjustedStatistic
    pre_stat = SampleMeanStatistic(sum=sum(METRIC_1), sum_squares=sum(x**2 for x in METRIC_1), n=N)
    post_stat = SampleMeanStatistic(sum=sum(METRIC_3), sum_squares=sum(x**2 for x in METRIC_3), n=N)
    ra_stat = RegressionAdjustedStatistic(
        post_statistic=post_stat,
        pre_statistic=pre_stat,
        n=N,
        post_pre_sum_of_products=float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
        theta=0,
    )

    # Small n test
    n_small = 1
    pre_stat_small = SampleMeanStatistic(sum=sum(METRIC_1), sum_squares=sum(x**2 for x in METRIC_1), n=n_small)
    post_stat_small = SampleMeanStatistic(sum=sum(METRIC_3), sum_squares=sum(x**2 for x in METRIC_3), n=n_small)
    ra_stat_small = RegressionAdjustedStatistic(
        post_statistic=post_stat_small,
        pre_statistic=pre_stat_small,
        n=n_small,
        post_pre_sum_of_products=float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
        theta=0.3,
    )

    fixtures["test_cases"]["RegressionAdjustedStatistic"] = {
        "test_theta_zero": {
            "inputs": {
                "post_statistic": serialize_statistic(post_stat),
                "pre_statistic": serialize_statistic(pre_stat),
                "n": N,
                "post_pre_sum_of_products": float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
                "theta": 0,
            },
            "expected": {
                "mean": float(np.mean(METRIC_3)),
                "variance": float(np.var(METRIC_3, ddof=1)),
            },
        },
        "test_regression_adjusted_small_n": {
            "inputs": {
                "post_statistic": serialize_statistic(post_stat_small),
                "pre_statistic": serialize_statistic(pre_stat_small),
                "n": n_small,
                "post_pre_sum_of_products": float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
                "theta": 0.3,
            },
            "expected": {"variance": 0},
        },
    }

    # compute_theta test
    ra_stat_a = RegressionAdjustedStatistic(
        post_statistic=post_stat,
        pre_statistic=pre_stat,
        n=N,
        post_pre_sum_of_products=float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
        theta=999,
    )
    ra_stat_b = RegressionAdjustedStatistic(
        post_statistic=post_stat,
        pre_statistic=pre_stat,
        n=N,
        post_pre_sum_of_products=float(sum(a * b for a, b in zip(METRIC_1, METRIC_3))),
        theta=999,
    )

    # Zero variance theta test
    pre_stat_zero = SampleMeanStatistic(n=N, sum=0, sum_squares=0)
    ra_stat_zero_a = RegressionAdjustedStatistic(
        post_statistic=post_stat,
        pre_statistic=pre_stat_zero,
        n=N,
        post_pre_sum_of_products=0,
        theta=999,
    )
    ra_stat_zero_b = RegressionAdjustedStatistic(
        post_statistic=post_stat,
        pre_statistic=pre_stat_zero,
        n=N,
        post_pre_sum_of_products=0,
        theta=999,
    )

    fixtures["test_cases"]["compute_theta"] = {
        "test_returns_theta": {
            "inputs": {
                "stat_a": serialize_statistic(ra_stat_a),
                "stat_b": serialize_statistic(ra_stat_b),
            },
            "expected": {"theta": round(compute_theta(ra_stat_a, ra_stat_b), DECIMALS)},
        },
        "test_returns_0_no_variance": {
            "inputs": {
                "stat_a": serialize_statistic(ra_stat_zero_a),
                "stat_b": serialize_statistic(ra_stat_zero_b),
            },
            "expected": {"theta": 0},
        },
    }

    # sum_stats test - includes 4 strata to match Python test
    stat_a_0 = SampleMeanStatistic(n=500, sum=10, sum_squares=75)
    stat_a_1 = SampleMeanStatistic(n=500, sum=40, sum_squares=73)
    stat_a_2 = SampleMeanStatistic(n=500, sum=10, sum_squares=75)
    stat_a_3 = SampleMeanStatistic(n=500, sum=40, sum_squares=73)
    stat_b_0 = SampleMeanStatistic(n=500, sum=4, sum_squares=7)
    stat_b_1 = SampleMeanStatistic(n=500, sum=20, sum_squares=13)
    stat_b_2 = SampleMeanStatistic(n=500, sum=4, sum_squares=7)
    stat_b_3 = SampleMeanStatistic(n=500, sum=20, sum_squares=13)
    sum_a, sum_b = sum_stats([
        (stat_a_0, stat_b_0),
        (stat_a_1, stat_b_1),
        (stat_a_2, stat_b_2),
        (stat_a_3, stat_b_3),
    ])
    fixtures["test_cases"]["sum_stats"] = {
        "test_sum_correct": {
            "inputs": {
                "stats": [
                    [serialize_statistic(stat_a_0), serialize_statistic(stat_b_0)],
                    [serialize_statistic(stat_a_1), serialize_statistic(stat_b_1)],
                    [serialize_statistic(stat_a_2), serialize_statistic(stat_b_2)],
                    [serialize_statistic(stat_a_3), serialize_statistic(stat_b_3)],
                ],
            },
            "expected": {
                "stat_a": serialize_statistic(sum_a),
                "stat_b": serialize_statistic(sum_b),
            },
        },
    }

    # QuantileStatistic test
    nu = 0.9
    n_c = 11054
    n_t = 10861
    q_stat_c = QuantileStatistic(
        n=n_c, n_star=n_c, nu=nu,
        quantile_hat=7.157987489967789,
        quantile_lower=7.098780136176828,
        quantile_upper=7.217194843758751,
    )
    q_stat_t = QuantileStatistic(
        n=n_t, n_star=n_t, nu=nu,
        quantile_hat=7.694499927525767,
        quantile_lower=7.64180598628119,
        quantile_upper=7.747193868770344,
    )
    q_sum_c, q_sum_t = sum_stats([(q_stat_c, q_stat_t)])

    fixtures["test_cases"]["QuantileStatistic"] = {
        "test_quantile_sum_single": {
            "inputs": {
                "stats": [[serialize_statistic(q_stat_c), serialize_statistic(q_stat_t)]],
            },
            "expected": {
                "stat_a": serialize_statistic(q_sum_c),
                "stat_b": serialize_statistic(q_sum_t),
            },
        },
        # Test that summing multiple quantile stats should fail
        "test_quantile_sum_multiple_fails": {
            "inputs": {
                "stats": [
                    [serialize_statistic(q_stat_c), serialize_statistic(q_stat_t)],
                    [serialize_statistic(q_stat_c), serialize_statistic(q_stat_t)],
                ],
            },
            "expected": {
                "error": True,
                "error_message": "sum_stats does not support summing multiple QuantileStatistic",
            },
        },
    }

    # EffectMomentsResult.test_negative_variance test
    from gbstats.models.statistics import ProportionStatistic as PS
    rastat_a_init = RegressionAdjustedStatistic(
        post_statistic=PS(n=4, sum=-7),  # Negative sum creates negative variance
        pre_statistic=PS(n=4, sum=0),
        n=4,
        post_pre_sum_of_products=0,
        theta=None,
    )
    rastat_b = RegressionAdjustedStatistic(
        post_statistic=PS(n=3, sum=1),
        pre_statistic=PS(n=3, sum=1),
        n=3,
        post_pre_sum_of_products=1,
        theta=None,
    )

    # Create the test and compute moments
    test_neg_var = TwoSidedTTest(
        stats=[(rastat_a_init, rastat_b)],
        config=FrequentistConfig(difference_type="absolute"),
    )
    moments_neg_var = EffectMoments(
        [(test_neg_var.stat_a, test_neg_var.stat_b)],
        config=EffectMomentsConfig(difference_type="absolute"),
    )
    neg_var_result = moments_neg_var.compute_result()

    fixtures["test_cases"]["EffectMomentsResult"] = {
        "test_negative_variance": {
            "inputs": {
                "stat_a": serialize_statistic(rastat_a_init),
                "stat_b": serialize_statistic(rastat_b),
                "difference_type": "absolute",
            },
            "expected": {
                "variance": moments_neg_var.variance,
                "error_message": ZERO_NEGATIVE_VARIANCE_MESSAGE,
            },
        },
    }

    return fixtures


def generate_utils_fixtures() -> Dict:
    """Generate fixtures for utility functions."""
    fixtures = {
        "metadata": {"gbstats_version": gbstats_version, "decimals": DECIMALS},
        "test_cases": {},
    }

    # multinomial_covariance
    np.random.seed(20251204)
    nu = np.random.uniform(size=5)
    nu = nu / np.sum(nu)
    v_theoretical = multinomial_covariance(nu)

    fixtures["test_cases"]["multinomial_covariance"] = {
        "test_multinomial_covariance": {
            "inputs": {"nu": nu.tolist()},
            "expected": {"covariance": v_theoretical.tolist()},
        },
    }

    return fixtures


def generate_midexperimentpower_fixtures() -> Dict:
    """Generate fixtures for mid-experiment power analysis."""
    fixtures = {
        "metadata": {"gbstats_version": gbstats_version, "decimals": DECIMALS},
        "test_cases": {},
    }

    alpha = 0.05
    target_power = 0.8
    delta = 0.05
    num_goal_metrics = 1
    num_variations = 2

    power_config_freq = MidExperimentPowerConfig(
        target_power=target_power,
        target_mde=delta,
        num_goal_metrics=num_goal_metrics,
        num_variations=num_variations,
        prior_effect=None,
    )
    power_config_seq = copy.deepcopy(power_config_freq)
    power_config_seq.sequential = True
    power_config_seq.sequential_tuning_parameter = 5000

    power_config_bayes = copy.deepcopy(power_config_freq)
    mu_prior = 0.05
    sigma_2_prior = 0.001
    prior_effect = GaussianPrior(mean=mu_prior, variance=sigma_2_prior, proper=True)
    power_config_bayes.prior_effect = prior_effect

    config = BaseConfig(alpha=alpha)
    stat_a = SampleMeanStatistic(n=500, sum=499.99999999999994, sum_squares=1499.999999999999)
    stat_b = SampleMeanStatistic(n=500, sum=525.0000000000008, sum_squares=1551.2499999999998)

    # Frequentist test
    test_freq = TwoSidedTTest([(stat_a, stat_b)], FrequentistConfig(alpha=alpha))
    res_freq = test_freq.compute_result()
    m_freq = MidExperimentPower(test_freq.moments_result, res_freq, config, power_config_freq)
    result_freq = m_freq.calculate_scaling_factor()

    # Sequential test
    test_seq = SequentialTwoSidedTTest([(stat_a, stat_b)], SequentialConfig(alpha=alpha))
    res_seq = test_seq.compute_result()
    m_seq = MidExperimentPower(test_seq.moments_result, res_seq, config, power_config_seq)
    result_seq = m_seq.calculate_scaling_factor()

    # Bayesian test
    test_bayes = EffectBayesianABTest(
        [(stat_a, stat_b)],
        EffectBayesianConfig(prior_effect=prior_effect, alpha=alpha)
    )
    res_bayes = test_bayes.compute_result()
    m_bayes = MidExperimentPower(test_bayes.moments_result, res_bayes, config, power_config_bayes)
    result_bayes = m_bayes.calculate_scaling_factor()

    fixtures["test_cases"]["MidExperimentPower"] = {
        "test_frequentist": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a),
                "stat_b": serialize_statistic(stat_b),
                "alpha": alpha,
                "target_power": target_power,
                "target_mde": delta,
            },
            "expected": {
                "scaling_factor": result_freq.scaling_factor,
                "power_at_scaling_factor": m_freq.power(result_freq.scaling_factor) if result_freq.scaling_factor else None,
            },
        },
        "test_sequential": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a),
                "stat_b": serialize_statistic(stat_b),
                "alpha": alpha,
                "target_power": target_power,
                "target_mde": delta,
                "sequential": True,
                "sequential_tuning_parameter": 5000,
            },
            "expected": {
                "scaling_factor": result_seq.scaling_factor,
                "power_at_scaling_factor": m_seq.power(result_seq.scaling_factor) if result_seq.scaling_factor else None,
            },
        },
        "test_bayesian": {
            "inputs": {
                "stat_a": serialize_statistic(stat_a),
                "stat_b": serialize_statistic(stat_b),
                "alpha": alpha,
                "target_power": target_power,
                "target_mde": delta,
                "prior_effect": {
                    "mean": mu_prior,
                    "variance": sigma_2_prior,
                    "proper": True,
                },
            },
            "expected": {
                "scaling_factor": result_bayes.scaling_factor,
                "power_at_scaling_factor": m_bayes.power(result_bayes.scaling_factor) if result_bayes.scaling_factor else None,
            },
        },
    }

    return fixtures


def generate_post_stratification_fixtures() -> Dict:
    """Generate fixtures for post-stratification tests.

    Uses exact test data from tests/frequentist/test_post_strat.py for parity.
    """
    fixtures = {
        "metadata": {"gbstats_version": gbstats_version, "decimals": DECIMALS},
        "test_cases": {},
    }

    # Exact test data from test_post_strat.py - TestPostStratification.setUp
    stats_count_strata = [
        (
            SampleMeanStatistic(n=21, sum=330.0696210595999, sum_squares=5377.811252605509),
            SampleMeanStatistic(n=42, sum=708.1220000911836, sum_squares=12249.255519049513),
        ),
        (
            SampleMeanStatistic(n=65, sum=1391.96628040659, sum_squares=30546.63404187155),
            SampleMeanStatistic(n=75, sum=1807.4703052657744, sum_squares=45000.287664918586),
        ),
        (
            SampleMeanStatistic(n=102, sum=2916.824124651419, sum_squares=86396.06886690554),
            SampleMeanStatistic(n=101, sum=3104.5399914554023, sum_squares=98365.40553530994),
        ),
        (
            SampleMeanStatistic(n=151, sum=5172.587929941052, sum_squares=182453.04528037464),
            SampleMeanStatistic(n=121, sum=4613.696610070716, sum_squares=180520.64781229294),
        ),
        (
            SampleMeanStatistic(n=160, sum=6539.348445231273, sum_squares=274981.98909352464),
            SampleMeanStatistic(n=162, sum=7431.953259880505, sum_squares=349244.6690736718),
        ),
    ]

    stats_ratio_strata = [
        (
            RatioStatistic(
                n=21,
                m_statistic=SampleMeanStatistic(n=21, sum=330.0696210595999, sum_squares=5377.811252605509),
                d_statistic=SampleMeanStatistic(n=21, sum=890.9766550739607, sum_squares=38220.95223835553),
                m_d_sum_of_products=14263.937571840695,
            ),
            RatioStatistic(
                n=42,
                m_statistic=SampleMeanStatistic(n=42, sum=708.1220000911836, sum_squares=12249.255519049513),
                d_statistic=SampleMeanStatistic(n=42, sum=1745.9858250014954, sum_squares=73194.53424221886),
                m_d_sum_of_products=29826.620793423102,
            ),
        ),
        (
            RatioStatistic(
                n=65,
                m_statistic=SampleMeanStatistic(n=65, sum=1391.96628040659, sum_squares=30546.63404187155),
                d_statistic=SampleMeanStatistic(n=65, sum=2769.8126179473184, sum_squares=118719.96077578884),
                m_d_sum_of_products=59924.702385890436,
            ),
            RatioStatistic(
                n=75,
                m_statistic=SampleMeanStatistic(n=75, sum=1807.4703052657744, sum_squares=45000.287664918586),
                d_statistic=SampleMeanStatistic(n=75, sum=3184.8395612061063, sum_squares=136710.92474497214),
                m_d_sum_of_products=78119.14871556411,
            ),
        ),
        (
            RatioStatistic(
                n=102,
                m_statistic=SampleMeanStatistic(n=102, sum=2916.824124651419, sum_squares=86396.06886690554),
                d_statistic=SampleMeanStatistic(n=102, sum=4445.780384331884, sum_squares=195387.7733842407),
                m_d_sum_of_products=129041.55268673625,
            ),
            RatioStatistic(
                n=101,
                m_statistic=SampleMeanStatistic(n=101, sum=3104.5399914554023, sum_squares=98365.40553530994),
                d_statistic=SampleMeanStatistic(n=101, sum=4235.277718489282, sum_squares=179690.4720421368),
                m_d_sum_of_products=132444.36911739354,
            ),
        ),
        (
            RatioStatistic(
                n=151,
                m_statistic=SampleMeanStatistic(n=151, sum=5172.587929941052, sum_squares=182453.04528037464),
                d_statistic=SampleMeanStatistic(n=151, sum=6510.170220892494, sum_squares=283094.7243365024),
                m_d_sum_of_products=226127.20135744457,
            ),
            RatioStatistic(
                n=121,
                m_statistic=SampleMeanStatistic(n=121, sum=4613.696610070716, sum_squares=180520.64781229294),
                d_statistic=SampleMeanStatistic(n=121, sum=5079.943060454901, sum_squares=215529.32009367683),
                m_d_sum_of_products=196562.8269130501,
            ),
        ),
        (
            RatioStatistic(
                n=160,
                m_statistic=SampleMeanStatistic(n=160, sum=6539.348445231273, sum_squares=274981.98909352464),
                d_statistic=SampleMeanStatistic(n=160, sum=6906.305872710853, sum_squares=300900.3106781779),
                m_d_sum_of_products=286483.9732935189,
            ),
            RatioStatistic(
                n=162,
                m_statistic=SampleMeanStatistic(n=162, sum=7431.953259880505, sum_squares=349244.6690736718),
                d_statistic=SampleMeanStatistic(n=162, sum=6899.004661928157, sum_squares=296839.44355002965),
                m_d_sum_of_products=321057.8410309036,
            ),
        ),
    ]

    # Regression adjusted count strata - exact from test_post_strat.py
    stats_count_reg_strata = [
        (
            RegressionAdjustedStatistic(
                n=21,
                post_statistic=SampleMeanStatistic(n=21, sum=330.0696210595999, sum_squares=5377.811252605509),
                pre_statistic=SampleMeanStatistic(n=21, sum=104.90748970535698, sum_squares=544.8528083123211),
                post_pre_sum_of_products=1709.8485612477339,
                theta=None,
            ),
            RegressionAdjustedStatistic(
                n=42,
                post_statistic=SampleMeanStatistic(n=42, sum=708.1220000911836, sum_squares=12249.255519049513),
                pre_statistic=SampleMeanStatistic(n=42, sum=205.17072061676208, sum_squares=1040.6742753852225),
                post_pre_sum_of_products=3561.161673449451,
                theta=None,
            ),
        ),
        (
            RegressionAdjustedStatistic(
                n=65,
                post_statistic=SampleMeanStatistic(n=65, sum=1391.96628040659, sum_squares=30546.63404187155),
                pre_statistic=SampleMeanStatistic(n=65, sum=315.83926510817054, sum_squares=1578.8689285910423),
                post_pre_sum_of_products=6938.770455871619,
                theta=None,
            ),
            RegressionAdjustedStatistic(
                n=75,
                post_statistic=SampleMeanStatistic(n=75, sum=1807.4703052657744, sum_squares=45000.287664918586),
                pre_statistic=SampleMeanStatistic(n=75, sum=377.29540367369503, sum_squares=1981.0803020754106),
                post_pre_sum_of_products=9428.146405105292,
                theta=None,
            ),
        ),
        (
            RegressionAdjustedStatistic(
                n=102,
                post_statistic=SampleMeanStatistic(n=102, sum=2916.824124651419, sum_squares=86396.06886690554),
                pre_statistic=SampleMeanStatistic(n=102, sum=523.2717238353379, sum_squares=2797.158898626946),
                post_pre_sum_of_products=15535.162216800189,
                theta=None,
            ),
            RegressionAdjustedStatistic(
                n=101,
                post_statistic=SampleMeanStatistic(n=101, sum=3104.5399914554023, sum_squares=98365.40553530994),
                pre_statistic=SampleMeanStatistic(n=101, sum=501.0447878972627, sum_squares=2596.899156698453),
                post_pre_sum_of_products=15962.754636573465,
                theta=None,
            ),
        ),
        (
            RegressionAdjustedStatistic(
                n=151,
                post_statistic=SampleMeanStatistic(n=151, sum=5172.587929941052, sum_squares=182453.04528037464),
                pre_statistic=SampleMeanStatistic(n=151, sum=758.3911049329452, sum_squares=3955.922281372593),
                post_pre_sum_of_products=26846.415701194885,
                theta=None,
            ),
            RegressionAdjustedStatistic(
                n=121,
                post_statistic=SampleMeanStatistic(n=121, sum=4613.696610070716, sum_squares=180520.64781229294),
                pre_statistic=SampleMeanStatistic(n=121, sum=603.9456523430367, sum_squares=3144.0820997706583),
                post_pre_sum_of_products=23789.82730157116,
                theta=None,
            ),
        ),
        (
            RegressionAdjustedStatistic(
                n=160,
                post_statistic=SampleMeanStatistic(n=160, sum=6539.348445231273, sum_squares=274981.98909352464),
                pre_statistic=SampleMeanStatistic(n=160, sum=823.2824168385916, sum_squares=4389.893995072177),
                post_pre_sum_of_products=34727.84795433773,
                theta=None,
            ),
            RegressionAdjustedStatistic(
                n=162,
                post_statistic=SampleMeanStatistic(n=162, sum=7431.953259880505, sum_squares=349244.6690736718),
                pre_statistic=SampleMeanStatistic(n=162, sum=832.356528363269, sum_squares=4439.253146704266),
                post_pre_sum_of_products=39332.667494781235,
                theta=None,
            ),
        ),
    ]

    # Regression adjusted ratio strata - exact from test_post_strat.py
    stats_ratio_reg_strata = [
        (
            RegressionAdjustedRatioStatistic(
                n=21,
                m_statistic_post=SampleMeanStatistic(n=21, sum=330.0696210595999, sum_squares=5377.811252605509),
                d_statistic_post=SampleMeanStatistic(n=21, sum=890.9766550739607, sum_squares=38220.95223835553),
                m_statistic_pre=SampleMeanStatistic(n=21, sum=104.90748970535698, sum_squares=544.8528083123211),
                d_statistic_pre=SampleMeanStatistic(n=21, sum=207.89392275808956, sum_squares=2084.9576141182224),
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
                m_statistic_post=SampleMeanStatistic(n=42, sum=708.1220000911836, sum_squares=12249.255519049513),
                d_statistic_post=SampleMeanStatistic(n=42, sum=1745.9858250014954, sum_squares=73194.53424221886),
                m_statistic_pre=SampleMeanStatistic(n=42, sum=205.17072061676208, sum_squares=1040.6742753852225),
                d_statistic_pre=SampleMeanStatistic(n=42, sum=412.711880878505, sum_squares=4096.604057794132),
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
                m_statistic_post=SampleMeanStatistic(n=65, sum=1391.96628040659, sum_squares=30546.63404187155),
                d_statistic_post=SampleMeanStatistic(n=65, sum=2769.8126179473184, sum_squares=118719.96077578884),
                m_statistic_pre=SampleMeanStatistic(n=65, sum=315.83926510817054, sum_squares=1578.8689285910423),
                d_statistic_pre=SampleMeanStatistic(n=65, sum=642.2456105047289, sum_squares=6391.278897716863),
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
                m_statistic_post=SampleMeanStatistic(n=75, sum=1807.4703052657744, sum_squares=45000.287664918586),
                d_statistic_post=SampleMeanStatistic(n=75, sum=3184.8395612061063, sum_squares=136710.92474497214),
                m_statistic_pre=SampleMeanStatistic(n=75, sum=377.29540367369503, sum_squares=1981.0803020754106),
                d_statistic_pre=SampleMeanStatistic(n=75, sum=758.076359391088, sum_squares=7750.7726864492015),
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
                m_statistic_post=SampleMeanStatistic(n=102, sum=2916.824124651419, sum_squares=86396.06886690554),
                d_statistic_post=SampleMeanStatistic(n=102, sum=4445.780384331884, sum_squares=195387.7733842407),
                m_statistic_pre=SampleMeanStatistic(n=102, sum=523.2717238353379, sum_squares=2797.158898626946),
                d_statistic_pre=SampleMeanStatistic(n=102, sum=1036.3070573097948, sum_squares=10619.969725470164),
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
                m_statistic_post=SampleMeanStatistic(n=101, sum=3104.5399914554023, sum_squares=98365.40553530994),
                d_statistic_post=SampleMeanStatistic(n=101, sum=4235.277718489282, sum_squares=179690.4720421368),
                m_statistic_pre=SampleMeanStatistic(n=101, sum=501.0447878972627, sum_squares=2596.899156698453),
                d_statistic_pre=SampleMeanStatistic(n=101, sum=1010.378433449463, sum_squares=10223.916200184585),
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
                m_statistic_post=SampleMeanStatistic(n=151, sum=5172.587929941052, sum_squares=182453.04528037464),
                d_statistic_post=SampleMeanStatistic(n=151, sum=6510.170220892494, sum_squares=283094.7243365024),
                m_statistic_pre=SampleMeanStatistic(n=151, sum=758.3911049329452, sum_squares=3955.922281372593),
                d_statistic_pre=SampleMeanStatistic(n=151, sum=1512.006054112595, sum_squares=15285.151021409667),
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
                m_statistic_post=SampleMeanStatistic(n=121, sum=4613.696610070716, sum_squares=180520.64781229294),
                d_statistic_post=SampleMeanStatistic(n=121, sum=5079.943060454901, sum_squares=215529.32009367683),
                m_statistic_pre=SampleMeanStatistic(n=121, sum=603.9456523430367, sum_squares=3144.0820997706583),
                d_statistic_pre=SampleMeanStatistic(n=121, sum=1204.8449120624373, sum_squares=12136.926835557133),
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
                m_statistic_post=SampleMeanStatistic(n=160, sum=6539.348445231273, sum_squares=274981.98909352464),
                d_statistic_post=SampleMeanStatistic(n=160, sum=6906.305872710853, sum_squares=300900.3106781779),
                m_statistic_pre=SampleMeanStatistic(n=160, sum=823.2824168385916, sum_squares=4389.893995072177),
                d_statistic_pre=SampleMeanStatistic(n=160, sum=1614.6469506831402, sum_squares=16462.430726309674),
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
                m_statistic_post=SampleMeanStatistic(n=162, sum=7431.953259880505, sum_squares=349244.6690736718),
                d_statistic_post=SampleMeanStatistic(n=162, sum=6899.004661928157, sum_squares=296839.44355002965),
                m_statistic_pre=SampleMeanStatistic(n=162, sum=832.356528363269, sum_squares=4439.253146704266),
                d_statistic_pre=SampleMeanStatistic(n=162, sum=1645.0526462449084, sum_squares=16880.972871039336),
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

    # Helper functions
    def serialize_stats_list(stats_list):
        return [[serialize_statistic(a), serialize_statistic(b)] for a, b in stats_list]

    def serialize_effect_moments_result(result):
        return {
            "point_estimate": round_(result.point_estimate),
            "standard_error": round_(result.standard_error),
            "pairwise_sample_size": result.pairwise_sample_size,
            "error_message": result.error_message,
            "post_stratification_applied": result.post_stratification_applied,
        }

    # Expected values from Python tests
    point_estimate_count_rel = 0.10994584851937336
    point_estimate_count_abs = 3.548094377986586
    point_estimate_count_reg_rel = 0.11529547657147865
    point_estimate_count_reg_abs = 3.7116918650826394
    point_estimate_ratio_rel = 0.13371299783026003
    point_estimate_ratio_abs = 0.10008903417216031
    point_estimate_ratio_reg_rel = 0.13929489348144797
    point_estimate_ratio_reg_abs = 0.10399412678968833

    standard_error_count_rel = 0.012225394656480164
    standard_error_count_abs = 0.37634374823059685
    standard_error_count_reg_rel = 0.002206093195330933
    standard_error_count_reg_abs = 0.07390409644392272
    standard_error_ratio_rel = 0.007131233706378072
    standard_error_ratio_abs = 0.005071004003792392
    standard_error_ratio_reg_rel = 0.0012316128268122996
    standard_error_ratio_reg_abs = 0.0012269621176865127

    # Test: zero/negative variance (exact from Python test)
    stats_zero_variance = [
        (
            SampleMeanStatistic(n=21, sum=0, sum_squares=0),
            SampleMeanStatistic(n=42, sum=0, sum_squares=0),
        ),
        (
            SampleMeanStatistic(n=65, sum=0, sum_squares=0),
            SampleMeanStatistic(n=75, sum=0, sum_squares=0),
        ),
    ]
    test_zero_var = EffectMomentsPostStratification(
        stats_zero_variance,
        EffectMomentsConfig(difference_type="absolute"),
    )

    # Test: baseline variation zero (for relative difference)
    stats_baseline_zero = [
        (
            SampleMeanStatistic(n=21, sum=0, sum_squares=10),
            SampleMeanStatistic(n=42, sum=0, sum_squares=10),
        ),
        (
            SampleMeanStatistic(n=65, sum=0, sum_squares=10),
            SampleMeanStatistic(n=75, sum=0, sum_squares=10),
        ),
    ]
    test_baseline_zero = EffectMomentsPostStratification(
        stats_baseline_zero,
        EffectMomentsConfig(difference_type="absolute"),
    )

    # Test: baseline variation adjusted zero (regression adjusted with zero baseline)
    stats_baseline_adjusted_zero = [
        (
            RegressionAdjustedStatistic(
                n=21,
                post_statistic=SampleMeanStatistic(n=21, sum=0, sum_squares=5377.811252605509),
                pre_statistic=SampleMeanStatistic(n=21, sum=104.90748970535698, sum_squares=544.8528083123211),
                post_pre_sum_of_products=1709.8485612477339,
                theta=None,
            ),
            RegressionAdjustedStatistic(
                n=42,
                post_statistic=SampleMeanStatistic(n=42, sum=0, sum_squares=12249.255519049513),
                pre_statistic=SampleMeanStatistic(n=42, sum=205.17072061676208, sum_squares=1040.6742753852225),
                post_pre_sum_of_products=3561.161673449451,
                theta=None,
            ),
        ),
        (
            RegressionAdjustedStatistic(
                n=65,
                post_statistic=SampleMeanStatistic(n=65, sum=0, sum_squares=30546.63404187155),
                pre_statistic=SampleMeanStatistic(n=65, sum=315.83926510817054, sum_squares=1578.8689285910423),
                post_pre_sum_of_products=6938.770455871619,
                theta=None,
            ),
            RegressionAdjustedStatistic(
                n=75,
                post_statistic=SampleMeanStatistic(n=75, sum=0, sum_squares=45000.287664918586),
                pre_statistic=SampleMeanStatistic(n=75, sum=377.29540367369503, sum_squares=1981.0803020754106),
                post_pre_sum_of_products=9428.146405105292,
                theta=None,
            ),
        ),
    ]
    test_baseline_adjusted_zero = EffectMomentsPostStratification(
        stats_baseline_adjusted_zero,
        EffectMomentsConfig(difference_type="absolute"),
    )

    # Main test results
    test_count_rel = EffectMomentsPostStratification(stats_count_strata, EffectMomentsConfig(difference_type="relative"))
    test_count_abs = EffectMomentsPostStratification(stats_count_strata, EffectMomentsConfig(difference_type="absolute"))
    test_ratio_rel = EffectMomentsPostStratification(stats_ratio_strata, EffectMomentsConfig(difference_type="relative"))
    test_ratio_abs = EffectMomentsPostStratification(stats_ratio_strata, EffectMomentsConfig(difference_type="absolute"))
    test_count_reg_rel = EffectMomentsPostStratification(stats_count_reg_strata, EffectMomentsConfig(difference_type="relative"))
    test_count_reg_abs = EffectMomentsPostStratification(stats_count_reg_strata, EffectMomentsConfig(difference_type="absolute"))
    test_ratio_reg_rel = EffectMomentsPostStratification(stats_ratio_reg_strata, EffectMomentsConfig(difference_type="relative"))
    test_ratio_reg_abs = EffectMomentsPostStratification(stats_ratio_reg_strata, EffectMomentsConfig(difference_type="absolute"))

    # Test missing variation data - remove one observation from last cell, add to new cell
    # This tests that cells with missing variation data are excluded properly
    num_strata = len(stats_count_strata)
    last_cell_a = stats_count_strata[num_strata - 1][0]
    last_cell_a_minus_obs = SampleMeanStatistic(
        n=last_cell_a.n - 1,
        sum=last_cell_a.sum - 1,
        sum_squares=last_cell_a.sum_squares - 1,
    )
    last_cell = (
        SampleMeanStatistic(n=1, sum=1, sum_squares=1),
        SampleMeanStatistic(n=0, sum=0, sum_squares=0),
    )
    stats_missing_variation = []
    for cell in range(0, num_strata - 1):
        stats_missing_variation.append(stats_count_strata[cell])
    stats_missing_variation.append(
        (last_cell_a_minus_obs, stats_count_strata[num_strata - 1][1])
    )
    stats_missing_variation.append(last_cell)

    # The expected result should be same as original (missing cell is excluded)
    test_missing_var = EffectMomentsPostStratification(stats_missing_variation, EffectMomentsConfig(difference_type="absolute"))
    test_original = EffectMomentsPostStratification(stats_count_strata, EffectMomentsConfig(difference_type="absolute"))

    fixtures["test_cases"]["EffectMomentsPostStratification"] = {
        # Error condition tests
        "test_zero_negative_variance": {
            "inputs": {
                "stats": serialize_stats_list(stats_zero_variance),
                "config": {"difference_type": "absolute"},
            },
            "expected": serialize_effect_moments_result(test_zero_var.compute_result()),
        },
        "test_baseline_variation_zero": {
            "inputs": {
                "stats": serialize_stats_list(stats_baseline_zero),
                "config": {"difference_type": "absolute"},
            },
            "expected": serialize_effect_moments_result(test_baseline_zero.compute_result()),
        },
        "test_baseline_variation_adjusted_zero": {
            "inputs": {
                "stats": serialize_stats_list(stats_baseline_adjusted_zero),
                "config": {"difference_type": "absolute"},
            },
            "expected": serialize_effect_moments_result(test_baseline_adjusted_zero.compute_result()),
        },

        # Missing variation data test
        "test_missing_variation_data": {
            "inputs": {
                "stats": serialize_stats_list(stats_missing_variation),
                "config": {"difference_type": "absolute"},
            },
            "expected": serialize_effect_moments_result(test_missing_var.compute_result()),
            "validation": {
                "should_equal_original": True,
                "original_result": serialize_effect_moments_result(test_original.compute_result()),
            }
        },

        # Count metrics
        "test_post_strat_count_effect_moments_relative": {
            "inputs": {
                "stats": serialize_stats_list(stats_count_strata),
                "config": {"difference_type": "relative"},
            },
            "expected": serialize_effect_moments_result(test_count_rel.compute_result()),
        },
        "test_post_strat_count_effect_moments_absolute": {
            "inputs": {
                "stats": serialize_stats_list(stats_count_strata),
                "config": {"difference_type": "absolute"},
            },
            "expected": serialize_effect_moments_result(test_count_abs.compute_result()),
        },

        # Ratio metrics
        "test_post_strat_ratio_effect_moments_relative": {
            "inputs": {
                "stats": serialize_stats_list(stats_ratio_strata),
                "config": {"difference_type": "relative"},
            },
            "expected": serialize_effect_moments_result(test_ratio_rel.compute_result()),
        },
        "test_post_strat_ratio_effect_moments_absolute": {
            "inputs": {
                "stats": serialize_stats_list(stats_ratio_strata),
                "config": {"difference_type": "absolute"},
            },
            "expected": serialize_effect_moments_result(test_ratio_abs.compute_result()),
        },

        # Regression adjusted count
        "test_post_strat_count_reg_effect_moments_relative": {
            "inputs": {
                "stats": serialize_stats_list(stats_count_reg_strata),
                "config": {"difference_type": "relative"},
            },
            "expected": serialize_effect_moments_result(test_count_reg_rel.compute_result()),
        },
        "test_post_strat_count_reg_effect_moments_absolute": {
            "inputs": {
                "stats": serialize_stats_list(stats_count_reg_strata),
                "config": {"difference_type": "absolute"},
            },
            "expected": serialize_effect_moments_result(test_count_reg_abs.compute_result()),
        },

        # Regression adjusted ratio
        "test_post_strat_ratio_reg_effect_moments_relative": {
            "inputs": {
                "stats": serialize_stats_list(stats_ratio_reg_strata),
                "config": {"difference_type": "relative"},
            },
            "expected": serialize_effect_moments_result(test_ratio_reg_rel.compute_result()),
        },
        "test_post_strat_ratio_reg_effect_moments_absolute": {
            "inputs": {
                "stats": serialize_stats_list(stats_ratio_reg_strata),
                "config": {"difference_type": "absolute"},
            },
            "expected": serialize_effect_moments_result(test_ratio_reg_abs.compute_result()),
        },
    }

    # Fallback tests - RA with zero pre-period variance should fallback to unadjusted
    stats_a_list, stats_b_list = zip(*stats_count_strata)
    fallback_reg_stats = [
        (
            RegressionAdjustedStatistic(
                n=stat_pair[0].n,
                post_statistic=SampleMeanStatistic(
                    n=stat_pair[0].n,
                    sum=stat_pair[0].sum,
                    sum_squares=stat_pair[0].sum_squares,
                ),
                pre_statistic=SampleMeanStatistic(n=stat_pair[0].n, sum=0, sum_squares=0),
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
                pre_statistic=SampleMeanStatistic(n=stat_pair[1].n, sum=0, sum_squares=0),
                post_pre_sum_of_products=0,
                theta=None,
            ),
        )
        for stat_pair in stats_count_strata
    ]
    test_count_fallback_rel = EffectMomentsPostStratification(fallback_reg_stats, EffectMomentsConfig(difference_type="relative"))
    test_count_fallback_abs = EffectMomentsPostStratification(fallback_reg_stats, EffectMomentsConfig(difference_type="absolute"))

    fixtures["test_cases"]["EffectMomentsPostStratification"]["test_post_strat_count_effect_moments_fallback_relative"] = {
        "inputs": {
            "stats": serialize_stats_list(fallback_reg_stats),
            "config": {"difference_type": "relative"},
        },
        "expected": serialize_effect_moments_result(test_count_fallback_rel.compute_result()),
    }
    fixtures["test_cases"]["EffectMomentsPostStratification"]["test_post_strat_count_effect_moments_fallback_absolute"] = {
        "inputs": {
            "stats": serialize_stats_list(fallback_reg_stats),
            "config": {"difference_type": "absolute"},
        },
        "expected": serialize_effect_moments_result(test_count_fallback_abs.compute_result()),
    }

    # Single cell tests - should be same as unstratified
    single_cell_count = [stats_count_strata[0]]
    single_cell_ratio = [stats_ratio_strata[0]]

    # Sum the RA strata to get single pooled stat
    from gbstats.models.tests import sum_stats as ss
    single_stat_a_ra, single_stat_b_ra = ss(stats_count_reg_strata)
    single_cell_count_reg = [(single_stat_a_ra, single_stat_b_ra)]
    single_stat_a_ratio_ra, single_stat_b_ratio_ra = ss(stats_ratio_reg_strata)
    single_cell_ratio_reg = [(single_stat_a_ratio_ra, single_stat_b_ratio_ra)]

    test_single_count_rel = EffectMomentsPostStratification(single_cell_count, EffectMomentsConfig(difference_type="relative"))
    test_single_count_reg_rel = EffectMomentsPostStratification(single_cell_count_reg, EffectMomentsConfig(difference_type="relative"))
    test_single_count_reg_abs = EffectMomentsPostStratification(single_cell_count_reg, EffectMomentsConfig(difference_type="absolute"))
    test_single_ratio_reg_rel = EffectMomentsPostStratification(single_cell_ratio_reg, EffectMomentsConfig(difference_type="relative"))
    test_single_ratio_reg_abs = EffectMomentsPostStratification(single_cell_ratio_reg, EffectMomentsConfig(difference_type="absolute"))

    fixtures["test_cases"]["EffectMomentsPostStratification"]["test_single_cell_count"] = {
        "inputs": {
            "stats": serialize_stats_list(single_cell_count),
            "config": {"difference_type": "relative"},
        },
        "expected": serialize_effect_moments_result(test_single_count_rel.compute_result()),
    }
    fixtures["test_cases"]["EffectMomentsPostStratification"]["test_post_strat_count_reg_effect_moments_single_cell_relative"] = {
        "inputs": {
            "stats": serialize_stats_list(single_cell_count_reg),
            "config": {"difference_type": "relative"},
        },
        "expected": serialize_effect_moments_result(test_single_count_reg_rel.compute_result()),
    }
    fixtures["test_cases"]["EffectMomentsPostStratification"]["test_post_strat_count_reg_effect_moments_single_cell_absolute"] = {
        "inputs": {
            "stats": serialize_stats_list(single_cell_count_reg),
            "config": {"difference_type": "absolute"},
        },
        "expected": serialize_effect_moments_result(test_single_count_reg_abs.compute_result()),
    }
    fixtures["test_cases"]["EffectMomentsPostStratification"]["test_post_strat_ratio_reg_effect_moments_single_cell_relative"] = {
        "inputs": {
            "stats": serialize_stats_list(single_cell_ratio_reg),
            "config": {"difference_type": "relative"},
        },
        "expected": serialize_effect_moments_result(test_single_ratio_reg_rel.compute_result()),
    }
    fixtures["test_cases"]["EffectMomentsPostStratification"]["test_post_strat_ratio_reg_effect_moments_single_cell_absolute"] = {
        "inputs": {
            "stats": serialize_stats_list(single_cell_ratio_reg),
            "config": {"difference_type": "absolute"},
        },
        "expected": serialize_effect_moments_result(test_single_ratio_reg_abs.compute_result()),
    }

    # Ratio fallback test
    ratio_fallback_stats = [
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
                m_statistic_pre=SampleMeanStatistic(n=stat_pair[0].n, sum=0, sum_squares=0),
                d_statistic_pre=SampleMeanStatistic(n=stat_pair[0].n, sum=0, sum_squares=0),
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
                m_statistic_pre=SampleMeanStatistic(n=stat_pair[1].n, sum=0, sum_squares=0),
                d_statistic_pre=SampleMeanStatistic(n=stat_pair[1].n, sum=0, sum_squares=0),
                m_post_m_pre_sum_of_products=0,
                d_post_d_pre_sum_of_products=0,
                m_pre_d_pre_sum_of_products=0,
                m_post_d_post_sum_of_products=stat_pair[1].m_d_sum_of_products,
                m_post_d_pre_sum_of_products=0,
                m_pre_d_post_sum_of_products=0,
                theta=None,
            ),
        )
        for stat_pair in stats_ratio_strata
    ]
    test_ratio_fallback_rel = EffectMomentsPostStratification(ratio_fallback_stats, EffectMomentsConfig(difference_type="relative"))
    test_ratio_fallback_abs = EffectMomentsPostStratification(ratio_fallback_stats, EffectMomentsConfig(difference_type="absolute"))

    fixtures["test_cases"]["EffectMomentsPostStratification"]["test_post_strat_ratio_effect_moments_fallback_relative"] = {
        "inputs": {
            "stats": serialize_stats_list(ratio_fallback_stats),
            "config": {"difference_type": "relative"},
        },
        "expected": serialize_effect_moments_result(test_ratio_fallback_rel.compute_result()),
    }
    fixtures["test_cases"]["EffectMomentsPostStratification"]["test_post_strat_ratio_effect_moments_fallback_absolute"] = {
        "inputs": {
            "stats": serialize_stats_list(ratio_fallback_stats),
            "config": {"difference_type": "absolute"},
        },
        "expected": serialize_effect_moments_result(test_ratio_fallback_abs.compute_result()),
    }

    return fixtures


def generate_gbstats_fixtures() -> Dict:
    """Generate fixtures for high-level API tests (test_gbstats.py)."""
    fixtures = {
        "metadata": {"gbstats_version": gbstats_version, "decimals": DECIMALS},
        "test_cases": {},
    }

    # Test data from test_gbstats.py
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

    DEFAULT_ANALYSIS = AnalysisSettingsForStatsEngine(
        var_names=["zero", "one"],
        var_ids=["0", "1"],
        weights=[0.5, 0.5],
        baseline_index=0,
        dimension="All",
        stats_engine="bayesian",
        sequential_testing_enabled=False,
        sequential_tuning_parameter=5000,
        difference_type="relative",
        phase_length_days=1,
        alpha=0.05,
        max_dimensions=20,
        one_sided_intervals=False,
    )

    QUERY_OUTPUT = [
        {
            "dimension": "one",
            "variation": "one",
            "main_sum": 300,
            "main_sum_squares": 869,
            "users": 120,
            "count": 120,
        },
        {
            "dimension": "one",
            "variation": "zero",
            "main_sum": 270,
            "main_sum_squares": 848.79,
            "users": 100,
            "count": 100,
        },
        {
            "dimension": "two",
            "variation": "one",
            "main_sum": 770,
            "main_sum_squares": 3571,
            "users": 220,
            "count": 220,
        },
        {
            "dimension": "two",
            "variation": "zero",
            "main_sum": 740,
            "main_sum_squares": 3615.59,
            "users": 200,
            "count": 200,
        },
    ]

    RATIO_STATISTICS_DATA = [
        {
            "dimension": "one",
            "variation": "one",
            "users": 120,
            "count": 120,
            "main_sum": 300,
            "main_sum_squares": 869,
            "denominator_sum": 500,
            "denominator_sum_squares": 800,
            "main_denominator_sum_product": -905,
        },
        {
            "dimension": "one",
            "variation": "zero",
            "main_sum": 270,
            "users": 100,
            "count": 100,
            "main_sum_squares": 848.79,
            "denominator_sum": 510,
            "denominator_sum_squares": 810,
            "main_denominator_sum_product": -900,
        },
    ]

    RA_STATISTICS_DATA = [
        {
            "dimension": "All",
            "variation": "one",
            "main_sum": 222,
            "main_sum_squares": 555,
            "covariate_sum": 120,
            "covariate_sum_squares": 405,
            "main_covariate_sum_product": -10,
            "users": 3000,
            "count": 3000,
        },
        {
            "dimension": "All",
            "variation": "zero",
            "main_sum": 300,
            "main_sum_squares": 600,
            "covariate_sum": 210,
            "covariate_sum_squares": 415,
            "main_covariate_sum_product": -20,
            "users": 3001,
            "count": 3001,
        },
    ]

    ONE_USER_DATA = [
        {
            "dimension": "one",
            "variation": "one",
            "main_sum": 1,
            "main_sum_squares": 1,
            "users": 1,
            "count": 1,
        },
        {
            "dimension": "one",
            "variation": "zero",
            "main_sum": 20,
            "main_sum_squares": 443,
            "users": 3,
            "count": 3,
        },
    ]

    # Third dimension data for reduce_dimensionality tests
    THIRD_DIMENSION_DATA = [
        {
            "dimension": "three",
            "variation": "one",
            "main_sum": 222,
            "main_sum_squares": 555,
            "users": 3000,
            "count": 3000,
        },
        {
            "dimension": "three",
            "variation": "zero",
            "main_sum": 333,
            "main_sum_squares": 999,
            "users": 3001,
            "count": 3001,
        },
    ]

    # Additional dimension for ratio test
    RATIO_STATISTICS_ADDITIONAL_DIMENSION_DATA = [
        {
            "dimension": "fifth",
            "variation": "one",
            "users": 120,
            "count": 120,
            "main_sum": 300,
            "main_sum_squares": 869,
            "denominator_sum": 500,
            "denominator_sum_squares": 800,
            "main_denominator_sum_product": -905,
        },
        {
            "dimension": "fifth",
            "variation": "zero",
            "main_sum": 270,
            "users": 100,
            "count": 100,
            "main_sum_squares": 848.79,
            "denominator_sum": 510,
            "denominator_sum_squares": 810,
            "main_denominator_sum_product": -900,
        },
    ]

    def serialize_variation_response(v):
        """Serialize a variation response object to dict."""
        result = {
            "cr": round_(v.cr),
            "value": v.value,
            "users": v.users,
            "denominator": v.denominator,
            "stats": {
                "users": v.stats.users,
                "count": v.stats.count,
                "mean": round_(v.stats.mean),
                "stddev": round_(v.stats.stddev),
            },
        }
        # Add optional fields based on type
        if hasattr(v, 'expected'):
            result["expected"] = round_(v.expected)
        if hasattr(v, 'ci'):
            result["ci"] = [round_(v.ci[0]) if v.ci[0] is not None else None,
                           round_(v.ci[1]) if v.ci[1] is not None else None]
        if hasattr(v, 'chanceToWin'):
            result["chanceToWin"] = round_(v.chanceToWin)
        if hasattr(v, 'risk'):
            result["risk"] = [round_(v.risk[0]), round_(v.risk[1])]
        if hasattr(v, 'pValue'):
            result["pValue"] = round_(v.pValue)
        return result

    def serialize_dimension_response(d):
        """Serialize a dimension response to dict."""
        return {
            "dimension": d.dimension,
            "srm": round_(d.srm),
            "variations": [serialize_variation_response(v) for v in d.variations],
        }

    # ========================================
    # TestDetectVariations tests
    # ========================================
    multi_dim_df = pd.DataFrame(QUERY_OUTPUT)

    fixtures["test_cases"]["TestDetectVariations"] = {
        "test_unknown_variations_none": {
            "inputs": {
                "rows": QUERY_OUTPUT,
                "var_ids": ["zero", "one"],
            },
            "expected": list(detect_unknown_variations(multi_dim_df, {"zero", "one"})),
        },
        "test_unknown_variations_one": {
            "inputs": {
                "rows": QUERY_OUTPUT,
                "var_ids": ["zero", "hello"],
            },
            "expected": list(detect_unknown_variations(multi_dim_df, {"zero", "hello"})),
        },
        "test_unknown_variations_both": {
            "inputs": {
                "rows": QUERY_OUTPUT,
                "var_ids": ["hello", "world"],
            },
            "expected": sorted(list(detect_unknown_variations(multi_dim_df, {"hello", "world"}))),
        },
    }

    # Test multiple exposures (adds __multiple__ variation)
    MULTIPLE_EXPOSURES_ROW = {
        "dimension": "All",
        "variation": "__multiple__",
        "main_sum": 99,
        "main_sum_squares": 9999,
        "users": 500,
    }
    rows_with_multiple = QUERY_OUTPUT + [MULTIPLE_EXPOSURES_ROW]
    df_with_multiple = pd.DataFrame(rows_with_multiple)

    # By default, __multiple__ is in the ignore set so it's not detected as unknown
    # When we pass a different ignore set, __multiple__ is detected as unknown
    fixtures["test_cases"]["TestDetectVariations"]["test_multiple_exposures"] = {
        "inputs": {
            "rows": rows_with_multiple,
            "var_ids": ["zero", "one"],
            "ignore_default": None,  # Use default ({"__multiple__"})
            "ignore_custom": ["some_other"],
        },
        "expected": {
            "with_default_ignore": list(detect_unknown_variations(df_with_multiple, {"zero", "one"})),
            "with_custom_ignore": list(detect_unknown_variations(df_with_multiple, {"zero", "one"}, {"some_other"})),
        },
    }

    # ========================================
    # TestGetMetricDf tests
    # ========================================
    # Create data without the 'count' column to test that 'users' is used as fallback
    query_output_no_count = [
        {k: v for k, v in row.items() if k != "count"}
        for row in QUERY_OUTPUT
    ]
    df_no_count = pd.DataFrame(query_output_no_count)
    metric_dfs_no_count = get_metric_dfs(df_no_count, {"zero": 0, "one": 1}, ["zero", "one"])

    # Verify that baseline_count == baseline_users and v1_count == v1_users for all rows
    count_equals_users = True
    for d in metric_dfs_no_count:
        for _, row in d.data.iterrows():
            if row["baseline_count"] != row["baseline_users"] or row["v1_count"] != row["v1_users"]:
                count_equals_users = False
                break

    fixtures["test_cases"]["TestGetMetricDf"] = {
        "test_get_metric_dfs_missing_count": {
            "inputs": {
                "rows": query_output_no_count,
                "var_id_map": {"zero": 0, "one": 1},
                "var_names": ["zero", "one"],
            },
            "expected": {
                "count_equals_users": count_equals_users,
                # Sample values from first dimension
                "first_dimension_baseline_count": int(metric_dfs_no_count[0].data.at[0, "baseline_count"]),
                "first_dimension_baseline_users": int(metric_dfs_no_count[0].data.at[0, "baseline_users"]),
                "first_dimension_v1_count": int(metric_dfs_no_count[0].data.at[0, "v1_count"]),
                "first_dimension_v1_users": int(metric_dfs_no_count[0].data.at[0, "v1_users"]),
            },
        },
    }

    # ========================================
    # TestVariationStatisticBuilder tests
    # ========================================
    ra_test_row = pd.Series({
        "statistic_type": "mean_ra",
        "baseline_main_sum": 222,
        "baseline_main_sum_squares": 555,
        "baseline_covariate_sum": 120,
        "baseline_covariate_sum_squares": 405,
        "baseline_main_covariate_sum_product": -10,
        "baseline_users": 3000,
        "baseline_count": 3000,
        "v1_main_sum": 333,
        "v1_main_sum_squares": 999,
        "v1_covariate_sum": 210,
        "v1_covariate_sum_squares": 415,
        "v1_main_covariate_sum_product": -20,
        "v1_users": 3001,
        "v1_count": 3001,
    })

    baseline_stat = variation_statistic_from_metric_row(ra_test_row, "baseline", RA_METRIC)
    v1_stat = variation_statistic_from_metric_row(ra_test_row, "v1", RA_METRIC)

    fixtures["test_cases"]["TestVariationStatisticBuilder"] = {
        "test_ra_statistic_type": {
            "inputs": {
                "row": ra_test_row.to_dict(),
                "metric": dataclasses.asdict(RA_METRIC),
            },
            "expected": {
                "baseline": serialize_statistic(baseline_stat),
                "v1": serialize_statistic(v1_stat),
            },
        },
    }

    # ========================================
    # TestAnalyzeMetricDfBayesian tests
    # ========================================
    rows_multi_dim = pd.DataFrame(QUERY_OUTPUT)
    df_multi_dim = get_metric_dfs(rows_multi_dim, {"zero": 0, "one": 1}, ["zero", "one"])
    result_bayesian = analyze_metric_df(df_multi_dim, num_variations=2, metric=COUNT_METRIC, analysis=DEFAULT_ANALYSIS)

    fixtures["test_cases"]["TestAnalyzeMetricDfBayesian"] = {
        "test_get_metric_dfs_new": {
            "inputs": {
                "rows": QUERY_OUTPUT,
                "var_id_map": {"zero": 0, "one": 1},
                "var_names": ["zero", "one"],
                "metric": dataclasses.asdict(COUNT_METRIC),
                "analysis": dataclasses.asdict(DEFAULT_ANALYSIS),
            },
            "expected": [serialize_dimension_response(r) for r in result_bayesian],
        },
    }

    # Test Bayesian ratio
    rows_ratio = pd.DataFrame(RATIO_STATISTICS_DATA)
    df_ratio = get_metric_dfs(rows_ratio, {"zero": 0, "one": 1}, ["zero", "one"])
    result_bayesian_ratio = analyze_metric_df(df_ratio, num_variations=2, metric=RATIO_METRIC, analysis=DEFAULT_ANALYSIS)

    fixtures["test_cases"]["TestAnalyzeMetricDfBayesian"]["test_get_metric_dfs_bayesian_ratio"] = {
        "inputs": {
            "rows": RATIO_STATISTICS_DATA,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "metric": dataclasses.asdict(RATIO_METRIC),
            "analysis": dataclasses.asdict(DEFAULT_ANALYSIS),
        },
        "expected": [serialize_dimension_response(r) for r in result_bayesian_ratio],
    }

    # Test inverse metric
    inverse_metric = dataclasses.replace(COUNT_METRIC, inverse=True)
    result_inverse = analyze_metric_df(df_multi_dim, num_variations=2, metric=inverse_metric, analysis=DEFAULT_ANALYSIS)

    fixtures["test_cases"]["TestAnalyzeMetricDfBayesian"]["test_get_metric_dfs_inverse"] = {
        "inputs": {
            "rows": QUERY_OUTPUT,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "metric": dataclasses.asdict(inverse_metric),
            "analysis": dataclasses.asdict(DEFAULT_ANALYSIS),
        },
        "expected": [serialize_dimension_response(r) for r in result_inverse],
    }

    # Test zero val (minimal data)
    rows_one_user = pd.DataFrame(ONE_USER_DATA)
    df_one_user = get_metric_dfs(rows_one_user, {"zero": 0, "one": 1}, ["zero", "one"])
    result_zero_val = analyze_metric_df(df_one_user, num_variations=2, metric=inverse_metric, analysis=DEFAULT_ANALYSIS)

    fixtures["test_cases"]["TestAnalyzeMetricDfBayesian"]["test_get_metric_dfs_zero_val"] = {
        "inputs": {
            "rows": ONE_USER_DATA,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "metric": dataclasses.asdict(inverse_metric),
            "analysis": dataclasses.asdict(DEFAULT_ANALYSIS),
        },
        "expected": [serialize_dimension_response(r) for r in result_zero_val],
    }

    # Test ratio with zero denominator (Bayesian)
    RATIO_STATISTICS_ZERO_DENOM_DATA = [
        {
            "dimension": "one",
            "variation": "one",
            "users": 120,
            "count": 120,
            "main_sum": 300,
            "main_sum_squares": 869,
            "denominator_sum": 0,  # Zero denominator
            "denominator_sum_squares": 0,
            "main_denominator_sum_product": 0,
        },
        {
            "dimension": "one",
            "variation": "zero",
            "main_sum": 270,
            "users": 100,
            "count": 100,
            "main_sum_squares": 848.79,
            "denominator_sum": 510,
            "denominator_sum_squares": 810,
            "main_denominator_sum_product": -900,
        },
    ]
    rows_ratio_zero_denom = pd.DataFrame(RATIO_STATISTICS_ZERO_DENOM_DATA)
    df_ratio_zero_denom = get_metric_dfs(rows_ratio_zero_denom, {"zero": 0, "one": 1}, ["zero", "one"])
    result_bayesian_ratio_zero_denom = analyze_metric_df(df_ratio_zero_denom, num_variations=2, metric=RATIO_METRIC, analysis=DEFAULT_ANALYSIS)

    fixtures["test_cases"]["TestAnalyzeMetricDfBayesian"]["test_get_metric_dfs_ratio_zero_denom"] = {
        "inputs": {
            "rows": RATIO_STATISTICS_ZERO_DENOM_DATA,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "metric": dataclasses.asdict(RATIO_METRIC),
            "analysis": dataclasses.asdict(DEFAULT_ANALYSIS),
        },
        "expected": [serialize_dimension_response(r) for r in result_bayesian_ratio_zero_denom],
    }

    # ========================================
    # TestAnalyzeMetricDfFrequentist tests
    # ========================================
    frequentist_analysis = dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist")
    result_frequentist = analyze_metric_df(df_multi_dim, num_variations=2, metric=COUNT_METRIC, analysis=frequentist_analysis)

    fixtures["test_cases"]["TestAnalyzeMetricDfFrequentist"] = {
        "test_get_metric_dfs_frequentist": {
            "inputs": {
                "rows": QUERY_OUTPUT,
                "var_id_map": {"zero": 0, "one": 1},
                "var_names": ["zero", "one"],
                "metric": dataclasses.asdict(COUNT_METRIC),
                "analysis": dataclasses.asdict(frequentist_analysis),
            },
            "expected": [serialize_dimension_response(r) for r in result_frequentist],
        },
    }

    # Test frequentist ratio
    result_frequentist_ratio = analyze_metric_df(df_ratio, num_variations=2, metric=RATIO_METRIC, analysis=frequentist_analysis)

    fixtures["test_cases"]["TestAnalyzeMetricDfFrequentist"]["test_get_metric_dfs_frequentist_ratio"] = {
        "inputs": {
            "rows": RATIO_STATISTICS_DATA,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "metric": dataclasses.asdict(RATIO_METRIC),
            "analysis": dataclasses.asdict(frequentist_analysis),
        },
        "expected": [serialize_dimension_response(r) for r in result_frequentist_ratio],
    }

    # Test frequentist with zero val
    result_frequentist_zero = analyze_metric_df(df_one_user, num_variations=2, metric=COUNT_METRIC, analysis=frequentist_analysis)

    fixtures["test_cases"]["TestAnalyzeMetricDfFrequentist"]["test_get_metric_dfs_zero_val"] = {
        "inputs": {
            "rows": ONE_USER_DATA,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "metric": dataclasses.asdict(COUNT_METRIC),
            "analysis": dataclasses.asdict(frequentist_analysis),
        },
        "expected": [serialize_dimension_response(r) for r in result_frequentist_zero],
    }

    # Test frequentist ratio with zero denominator
    df_ratio_zero_denom_freq = get_metric_dfs(rows_ratio_zero_denom, {"zero": 0, "one": 1}, ["zero", "one"])
    result_frequentist_ratio_zero_denom = analyze_metric_df(df_ratio_zero_denom_freq, num_variations=2, metric=RATIO_METRIC, analysis=frequentist_analysis)

    fixtures["test_cases"]["TestAnalyzeMetricDfFrequentist"]["test_get_metric_dfs_ratio_zero_denom"] = {
        "inputs": {
            "rows": RATIO_STATISTICS_ZERO_DENOM_DATA,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "metric": dataclasses.asdict(RATIO_METRIC),
            "analysis": dataclasses.asdict(frequentist_analysis),
        },
        "expected": [serialize_dimension_response(r) for r in result_frequentist_ratio_zero_denom],
    }

    # ========================================
    # TestAnalyzeMetricDfRegressionAdjustment tests
    # ========================================
    rows_ra = pd.DataFrame(RA_STATISTICS_DATA)
    df_ra = get_metric_dfs(rows_ra, {"zero": 0, "one": 1}, ["zero", "one"])
    result_ra = analyze_metric_df(df_ra, num_variations=2, metric=RA_METRIC, analysis=frequentist_analysis)

    fixtures["test_cases"]["TestAnalyzeMetricDfRegressionAdjustment"] = {
        "test_analyze_metric_df_ra": {
            "inputs": {
                "rows": RA_STATISTICS_DATA,
                "var_id_map": {"zero": 0, "one": 1},
                "var_names": ["zero", "one"],
                "metric": dataclasses.asdict(RA_METRIC),
                "analysis": dataclasses.asdict(frequentist_analysis),
            },
            "expected": [serialize_dimension_response(r) for r in result_ra],
        },
    }

    # RA with proportion/binomial metrics (test_analyze_metric_df_ra_proportion)
    RA_PROPORTION_METRIC = MetricSettingsForStatsEngine(
        id="",
        name="",
        inverse=False,
        statistic_type="mean_ra",
        main_metric_type="binomial",
        covariate_metric_type="binomial",
    )

    RA_PROPORTION_DATA = [
        {
            "dimension": "All",
            "variation": "one",
            "main_sum": 600,
            "main_sum_squares": 600,  # For binomial, sum_squares = sum
            "covariate_sum": 300,
            "covariate_sum_squares": 300,
            "main_covariate_sum_product": 200,
            "users": 3000,
            "count": 3000,
        },
        {
            "dimension": "All",
            "variation": "zero",
            "main_sum": 500,
            "main_sum_squares": 500,
            "covariate_sum": 250,
            "covariate_sum_squares": 250,
            "main_covariate_sum_product": 180,
            "users": 3001,
            "count": 3001,
        },
    ]
    rows_ra_prop = pd.DataFrame(RA_PROPORTION_DATA)
    df_ra_prop = get_metric_dfs(rows_ra_prop, {"zero": 0, "one": 1}, ["zero", "one"])
    result_ra_prop = analyze_metric_df(df_ra_prop, num_variations=2, metric=RA_PROPORTION_METRIC, analysis=frequentist_analysis)

    fixtures["test_cases"]["TestAnalyzeMetricDfRegressionAdjustment"]["test_analyze_metric_df_ra_proportion"] = {
        "inputs": {
            "rows": RA_PROPORTION_DATA,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "metric": dataclasses.asdict(RA_PROPORTION_METRIC),
            "analysis": dataclasses.asdict(frequentist_analysis),
        },
        "expected": [serialize_dimension_response(r) for r in result_ra_prop],
    }

    # Ratio RA metric (test_analyze_metric_df_ratio_ra)
    RATIO_RA_METRIC = MetricSettingsForStatsEngine(
        id="",
        name="",
        inverse=False,
        statistic_type="ratio_ra",
        main_metric_type="count",
        denominator_metric_type="count",
        covariate_metric_type="count",
    )

    RATIO_RA_DATA = [
        {
            "dimension": "All",
            "variation": "one",
            "users": 100,
            "count": 100,
            "main_sum": 485.1,
            "main_sum_squares": 2715.5,
            "denominator_sum": 679.9,
            "denominator_sum_squares": 4939.4,
            "main_denominator_sum_product": 3602.1,
            "covariate_sum": 192.6,
            "covariate_sum_squares": 460.1,
            "covariate_denominator_sum": 290.1,
            "covariate_denominator_sum_squares": 920.9,
            "main_covariate_sum_product": 1113.6,
            "denominator_covariate_denominator_sum_product": 2130.9,
            "covariate_covariate_denominator_sum_product": 634.2,
            "main_covariate_denominator_sum_product": 1559.3,
            "covariate_main_denominator_sum_product": 1460.3,
        },
        {
            "dimension": "All",
            "variation": "zero",
            "users": 100,
            "count": 100,
            "main_sum": 514.8,
            "main_sum_squares": 2994.9,
            "denominator_sum": 705.4,
            "denominator_sum_squares": 5291.4,
            "main_denominator_sum_product": 3918.2,
            "covariate_sum": 206.9,
            "covariate_sum_squares": 514.3,
            "covariate_denominator_sum": 302.5,
            "covariate_denominator_sum_squares": 994.5,
            "main_covariate_sum_product": 1237.1,
            "denominator_covariate_denominator_sum_product": 2292.1,
            "covariate_covariate_denominator_sum_product": 698.4,
            "main_covariate_denominator_sum_product": 1701.0,
            "covariate_main_denominator_sum_product": 1604.1,
        },
    ]
    rows_ratio_ra = pd.DataFrame(RATIO_RA_DATA)
    df_ratio_ra = get_metric_dfs(rows_ratio_ra, {"zero": 0, "one": 1}, ["zero", "one"])
    result_ratio_ra = analyze_metric_df(df_ratio_ra, num_variations=2, metric=RATIO_RA_METRIC, analysis=frequentist_analysis)

    fixtures["test_cases"]["TestAnalyzeMetricDfRegressionAdjustment"]["test_analyze_metric_df_ratio_ra"] = {
        "inputs": {
            "rows": RATIO_RA_DATA,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "metric": dataclasses.asdict(RATIO_RA_METRIC),
            "analysis": dataclasses.asdict(frequentist_analysis),
        },
        "expected": [serialize_dimension_response(r) for r in result_ratio_ra],
    }

    # ========================================
    # TestAnalyzeMetricDfSequential tests
    # ========================================
    sequential_analysis = dataclasses.replace(
        DEFAULT_ANALYSIS,
        stats_engine="frequentist",
        sequential_testing_enabled=True,
        sequential_tuning_parameter=600,
    )
    result_sequential = analyze_metric_df(df_multi_dim, num_variations=2, metric=COUNT_METRIC, analysis=sequential_analysis)

    fixtures["test_cases"]["TestAnalyzeMetricDfSequential"] = {
        "test_analyze_metric_df_sequential": {
            "inputs": {
                "rows": QUERY_OUTPUT,
                "var_id_map": {"zero": 0, "one": 1},
                "var_names": ["zero", "one"],
                "metric": dataclasses.asdict(COUNT_METRIC),
                "analysis": dataclasses.asdict(sequential_analysis),
            },
            "expected": [serialize_dimension_response(r) for r in result_sequential],
        },
    }

    # ========================================
    # TestProcessAnalysis tests
    # ========================================
    # Test that denominator is set correctly - uses RATIO_STATISTICS_DATA with COUNT_METRIC
    process_result = process_analysis(
        pd.DataFrame(RATIO_STATISTICS_DATA),
        var_id_map={"zero": 0, "one": 1},
        metric=COUNT_METRIC,
        analysis=DEFAULT_ANALYSIS,
    )
    # Extract denominators for each variation in each dimension
    denominators = []
    for res in process_result:
        dim_denoms = [int(v.denominator) for v in res.variations]
        denominators.append(dim_denoms)

    fixtures["test_cases"]["TestProcessAnalysis"] = {
        "test_process_analysis_denominator": {
            "inputs": {
                "rows": RATIO_STATISTICS_DATA,
                "var_id_map": {"zero": 0, "one": 1},
                "metric": dataclasses.asdict(COUNT_METRIC),
                "analysis": dataclasses.asdict(DEFAULT_ANALYSIS),
            },
            "expected": {
                # Expected: baseline (i=0) has denominator=510, variation (i=1) has denominator=500
                "denominators": denominators,
                "first_dimension_baseline_denominator": denominators[0][0] if denominators else None,
                "first_dimension_variation_denominator": denominators[0][1] if denominators else None,
            },
        },
    }

    # ========================================
    # TestThreeArmedCuped tests
    # ========================================
    THREE_ARMED_CUPED_DATA = [
        {
            "dimension": "All",
            "variation": "zero",
            "main_sum": 300,
            "main_sum_squares": 600,
            "covariate_sum": 210,
            "covariate_sum_squares": 415,
            "main_covariate_sum_product": -20,
            "users": 3001,
            "count": 3001,
        },
        {
            "dimension": "All",
            "variation": "one",
            "main_sum": 222,
            "main_sum_squares": 555,
            "covariate_sum": 120,
            "covariate_sum_squares": 405,
            "main_covariate_sum_product": -10,
            "users": 3000,
            "count": 3000,
        },
        {
            "dimension": "All",
            "variation": "two",
            "main_sum": 450,
            "main_sum_squares": 900,
            "covariate_sum": 300,
            "covariate_sum_squares": 600,
            "main_covariate_sum_product": -30,
            "users": 4000,
            "count": 4000,
        },
    ]

    three_armed_analysis = dataclasses.replace(
        DEFAULT_ANALYSIS,
        var_names=["zero", "one", "two"],
        var_ids=["0", "1", "2"],
        weights=[1/3, 1/3, 1/3],
        stats_engine="frequentist",
    )

    # Test 1: Hard-coded baseline stats
    df_three_armed = get_metric_dfs(
        pd.DataFrame(THREE_ARMED_CUPED_DATA),
        {"zero": 0, "one": 1, "two": 2},
        ["zero", "one", "two"],
    )
    result_three_armed_cuped = analyze_metric_df(
        df_three_armed,
        num_variations=3,
        metric=RA_METRIC,
        analysis=three_armed_analysis,
    )

    # Test 2: CUPED vs no CUPED (uses different metric)
    df_three_armed_2 = get_metric_dfs(
        pd.DataFrame(THREE_ARMED_CUPED_DATA),
        {"zero": 0, "one": 1, "two": 2},
        ["zero", "one", "two"],
    )
    result_three_armed_no_cuped = analyze_metric_df(
        df_three_armed_2,
        num_variations=3,
        metric=COUNT_METRIC,
        analysis=three_armed_analysis,
    )

    # Test 3: 0 vs 2 comparison
    rows_02_data = [r for r in THREE_ARMED_CUPED_DATA if r["variation"] in ["zero", "two"]]
    rows_02_renamed = []
    for r in rows_02_data:
        r_copy = r.copy()
        if r_copy["variation"] == "two":
            r_copy["variation"] = "one"
        rows_02_renamed.append(r_copy)

    two_armed_analysis_02 = dataclasses.replace(
        DEFAULT_ANALYSIS,
        var_names=["zero", "one"],
        var_ids=["0", "1"],
        weights=[0.5, 0.5],
        stats_engine="frequentist",
    )

    df_02 = get_metric_dfs(pd.DataFrame(rows_02_renamed), {"zero": 0, "one": 1}, ["zero", "one"])
    result_02 = analyze_metric_df(
        df_02,
        num_variations=2,
        metric=RA_METRIC,
        analysis=two_armed_analysis_02,
    )

    fixtures["test_cases"]["TestThreeArmedCuped"] = {
        "test_three_armed_cuped_baseline_stats_hardcoded": {
            "inputs": {
                "rows": THREE_ARMED_CUPED_DATA,
                "var_id_map": {"zero": 0, "one": 1, "two": 2},
                "var_names": ["zero", "one", "two"],
                "metric": dataclasses.asdict(RA_METRIC),
                "analysis": dataclasses.asdict(three_armed_analysis),
            },
            "expected": {
                "baseline_users": result_three_armed_cuped[0].variations[0].stats.users,
                "baseline_count": result_three_armed_cuped[0].variations[0].stats.count,
                "baseline_mean": round_(result_three_armed_cuped[0].variations[0].stats.mean),
                "baseline_stddev": round_(result_three_armed_cuped[0].variations[0].stats.stddev),
                "v1_users": result_three_armed_cuped[0].variations[1].stats.users,
                "v1_count": result_three_armed_cuped[0].variations[1].stats.count,
                "v1_mean": round_(result_three_armed_cuped[0].variations[1].stats.mean),
                "v1_stddev": round_(result_three_armed_cuped[0].variations[1].stats.stddev),
                "v2_users": result_three_armed_cuped[0].variations[2].stats.users,
                "v2_count": result_three_armed_cuped[0].variations[2].stats.count,
                "v2_mean": round_(result_three_armed_cuped[0].variations[2].stats.mean),
                "v2_stddev": round_(result_three_armed_cuped[0].variations[2].stats.stddev),
            },
        },
        "test_three_armed_cuped_baseline_stddev_different_from_no_cuped": {
            "inputs": {
                "rows": THREE_ARMED_CUPED_DATA,
                "var_id_map": {"zero": 0, "one": 1, "two": 2},
                "var_names": ["zero", "one", "two"],
                "metric_cuped": dataclasses.asdict(RA_METRIC),
                "metric_no_cuped": dataclasses.asdict(COUNT_METRIC),
                "analysis": dataclasses.asdict(three_armed_analysis),
            },
            "expected": {
                "cuped_baseline_stddev": round_(result_three_armed_cuped[0].variations[0].stats.stddev),
                "no_cuped_baseline_stddev": round_(result_three_armed_no_cuped[0].variations[0].stats.stddev),
                "cuped_baseline_mean": round_(result_three_armed_cuped[0].variations[0].stats.mean),
                "no_cuped_baseline_mean": round_(result_three_armed_no_cuped[0].variations[0].stats.mean),
                "stddev_different": round_(result_three_armed_cuped[0].variations[0].stats.stddev) != round_(result_three_armed_no_cuped[0].variations[0].stats.stddev),
                "mean_same": round_(result_three_armed_cuped[0].variations[0].stats.mean) == round_(result_three_armed_no_cuped[0].variations[0].stats.mean),
            },
        },
        "test_three_armed_cuped_baseline_stats_same_as_0_vs_2": {
            "inputs": {
                "rows_three_armed": THREE_ARMED_CUPED_DATA,
                "rows_02": rows_02_renamed,
                "metric": dataclasses.asdict(RA_METRIC),
                "analysis_three_armed": dataclasses.asdict(three_armed_analysis),
                "analysis_02": dataclasses.asdict(two_armed_analysis_02),
            },
            "expected": {
                "three_armed_baseline_users": result_three_armed_cuped[0].variations[0].stats.users,
                "three_armed_baseline_count": result_three_armed_cuped[0].variations[0].stats.count,
                "three_armed_baseline_mean": round_(result_three_armed_cuped[0].variations[0].stats.mean),
                "three_armed_baseline_stddev": round_(result_three_armed_cuped[0].variations[0].stats.stddev),
                "two_armed_baseline_users": result_02[0].variations[0].stats.users,
                "two_armed_baseline_count": result_02[0].variations[0].stats.count,
                "two_armed_baseline_mean": round_(result_02[0].variations[0].stats.mean),
                "two_armed_baseline_stddev": round_(result_02[0].variations[0].stats.stddev),
                "users_same": result_three_armed_cuped[0].variations[0].stats.users == result_02[0].variations[0].stats.users,
                "count_same": result_three_armed_cuped[0].variations[0].stats.count == result_02[0].variations[0].stats.count,
                "mean_same": round_(result_three_armed_cuped[0].variations[0].stats.mean) == round_(result_02[0].variations[0].stats.mean),
                "stddev_same": round_(result_three_armed_cuped[0].variations[0].stats.stddev) == round_(result_02[0].variations[0].stats.stddev),
            },
        },
    }

    # ========================================
    # TestReduceDimensionality tests
    # ========================================
    def serialize_metric_df_data(metric_dfs):
        """Serialize the metric df list to JSON-compatible format."""
        result = []
        for mdf in metric_dfs:
            # Extract the data row as dict
            data_dict = mdf.data.iloc[0].to_dict()
            # Round numeric values
            rounded_data = {}
            for k, v in data_dict.items():
                if isinstance(v, (int, float)) and not np.isnan(v):
                    rounded_data[k] = round_(v) if isinstance(v, float) else v
                else:
                    rounded_data[k] = v
            result.append({
                "data": rounded_data,
            })
        return result

    # Test reduce_dimensionality (count metrics)
    # Note: reduce_dimensionality modifies objects in place, so we need fresh data for each call
    combined_rows = QUERY_OUTPUT + THIRD_DIMENSION_DATA
    df_combined_for_3 = get_metric_dfs(pd.DataFrame(combined_rows), {"zero": 0, "one": 1}, ["zero", "one"])
    df_combined_for_2 = get_metric_dfs(pd.DataFrame(combined_rows), {"zero": 0, "one": 1}, ["zero", "one"])
    reduced_3 = reduce_dimensionality(df_combined_for_3, num_variations=2, max=3)
    reduced_2 = reduce_dimensionality(df_combined_for_2, num_variations=2, max=2)

    fixtures["test_cases"]["TestReduceDimensionality"] = {
        "test_reduce_dimensionality": {
            "inputs": {
                "rows": combined_rows,
                "var_id_map": {"zero": 0, "one": 1},
                "var_names": ["zero", "one"],
                "num_variations": 2,
                "max_3": 3,
                "max_2": 2,
            },
            "expected": {
                "reduced_3_length": len(reduced_3),
                "reduced_3_first_dimension": reduced_3[0].data.at[0, "dimension"],
                "reduced_3_first_v1_main_sum": round_(reduced_3[0].data.at[0, "v1_main_sum"]),
                "reduced_2_length": len(reduced_2),
                "reduced_2_second_dimension": reduced_2[1].data.at[0, "dimension"],
                "reduced_2_second_v1_main_sum": round_(reduced_2[1].data.at[0, "v1_main_sum"]),
                "reduced_2_second_v1_main_sum_squares": round_(reduced_2[1].data.at[0, "v1_main_sum_squares"]),
                "reduced_2_second_v1_users": round_(reduced_2[1].data.at[0, "v1_users"]),
                "reduced_2_second_baseline_users": round_(reduced_2[1].data.at[0, "baseline_users"]),
                "reduced_2_second_baseline_main_sum": round_(reduced_2[1].data.at[0, "baseline_main_sum"]),
                "reduced_2_second_baseline_main_sum_squares": round_(reduced_2[1].data.at[0, "baseline_main_sum_squares"]),
            },
        },
    }

    # Test reduce_dimensionality_ratio
    # Note: reduce_dimensionality modifies objects in place, so we need fresh data for each call
    combined_ratio_rows = RATIO_STATISTICS_DATA + RATIO_STATISTICS_ADDITIONAL_DIMENSION_DATA
    df_combined_ratio_for_20 = get_metric_dfs(pd.DataFrame(combined_ratio_rows), {"zero": 0, "one": 1}, ["zero", "one"])
    df_combined_ratio_for_1 = get_metric_dfs(pd.DataFrame(combined_ratio_rows), {"zero": 0, "one": 1}, ["zero", "one"])
    reduced_ratio_20 = reduce_dimensionality(df_combined_ratio_for_20, num_variations=2, max=20)
    reduced_ratio_1 = reduce_dimensionality(df_combined_ratio_for_1, num_variations=2, max=1)

    fixtures["test_cases"]["TestReduceDimensionality"]["test_reduce_dimensionality_ratio"] = {
        "inputs": {
            "rows": combined_ratio_rows,
            "var_id_map": {"zero": 0, "one": 1},
            "var_names": ["zero", "one"],
            "num_variations": 2,
            "max_20": 20,
            "max_1": 1,
        },
        "expected": {
            "reduced_20_length": len(reduced_ratio_20),
            "reduced_20_first_dimension": reduced_ratio_20[0].data.at[0, "dimension"],
            "reduced_20_first_v1_users": round_(reduced_ratio_20[0].data.at[0, "v1_users"]),
            "reduced_20_first_v1_main_sum": round_(reduced_ratio_20[0].data.at[0, "v1_main_sum"]),
            "reduced_20_first_v1_main_sum_squares": round_(reduced_ratio_20[0].data.at[0, "v1_main_sum_squares"]),
            "reduced_20_first_v1_denominator_sum": round_(reduced_ratio_20[0].data.at[0, "v1_denominator_sum"]),
            "reduced_20_first_v1_denominator_sum_squares": round_(reduced_ratio_20[0].data.at[0, "v1_denominator_sum_squares"]),
            "reduced_20_first_v1_main_denominator_sum_product": round_(reduced_ratio_20[0].data.at[0, "v1_main_denominator_sum_product"]),
            "reduced_20_first_baseline_users": round_(reduced_ratio_20[0].data.at[0, "baseline_users"]),
            "reduced_20_first_baseline_main_sum": round_(reduced_ratio_20[0].data.at[0, "baseline_main_sum"]),
            "reduced_20_first_baseline_main_sum_squares": round_(reduced_ratio_20[0].data.at[0, "baseline_main_sum_squares"]),
            "reduced_20_first_baseline_denominator_sum": round_(reduced_ratio_20[0].data.at[0, "baseline_denominator_sum"]),
            "reduced_20_first_baseline_denominator_sum_squares": round_(reduced_ratio_20[0].data.at[0, "baseline_denominator_sum_squares"]),
            "reduced_20_first_baseline_main_denominator_sum_product": round_(reduced_ratio_20[0].data.at[0, "baseline_main_denominator_sum_product"]),
            "reduced_1_length": len(reduced_ratio_1),
            "reduced_1_first_dimension": reduced_ratio_1[0].data.at[0, "dimension"],
            "reduced_1_first_v1_users": round_(reduced_ratio_1[0].data.at[0, "v1_users"]),
            "reduced_1_first_v1_main_sum": round_(reduced_ratio_1[0].data.at[0, "v1_main_sum"]),
            "reduced_1_first_v1_main_sum_squares": round_(reduced_ratio_1[0].data.at[0, "v1_main_sum_squares"]),
            "reduced_1_first_v1_denominator_sum": round_(reduced_ratio_1[0].data.at[0, "v1_denominator_sum"]),
            "reduced_1_first_v1_denominator_sum_squares": round_(reduced_ratio_1[0].data.at[0, "v1_denominator_sum_squares"]),
            "reduced_1_first_v1_main_denominator_sum_product": round_(reduced_ratio_1[0].data.at[0, "v1_main_denominator_sum_product"]),
            "reduced_1_first_baseline_users": round_(reduced_ratio_1[0].data.at[0, "baseline_users"]),
            "reduced_1_first_baseline_main_sum": round_(reduced_ratio_1[0].data.at[0, "baseline_main_sum"]),
            "reduced_1_first_baseline_main_sum_squares": round_(reduced_ratio_1[0].data.at[0, "baseline_main_sum_squares"]),
            "reduced_1_first_baseline_denominator_sum": round_(reduced_ratio_1[0].data.at[0, "baseline_denominator_sum"]),
            "reduced_1_first_baseline_denominator_sum_squares": round_(reduced_ratio_1[0].data.at[0, "baseline_denominator_sum_squares"]),
            "reduced_1_first_baseline_main_denominator_sum_product": round_(reduced_ratio_1[0].data.at[0, "baseline_main_denominator_sum_product"]),
        },
    }

    return fixtures


def generate_devtools_fixtures() -> Dict:
    """
    Generate fixtures for devtools/simulation tests.
    These test the full pipeline from raw data through process_single_metric.
    """
    from gbstats.devtools.simulation import CreateStatistic, CreateRow
    from gbstats.gbstats import process_single_metric

    fixtures = {
        "metadata": {
            "description": "Devtools/simulation test fixtures",
            "source": "packages/stats/tests/test_devtools.py",
            "gbstats_version": gbstats_version,
        },
        "test_cases": {}
    }

    # Set up test data matching test_devtools.py
    metric_settings_1 = MetricSettingsForStatsEngine(
        id="count_metric_1",
        name="count_metric_1",
        inverse=False,
        statistic_type="mean",
        main_metric_type="count",
        business_metric_type=["goal"],
    )
    metric_settings_2 = copy.deepcopy(metric_settings_1)
    metric_settings_2.statistic_type = "ratio_ra"
    metric_settings_2.id = "ratio_ra_metric_1"
    metric_settings_2.name = "ratio_ra_metric_1"
    metric_settings_2.denominator_metric_type = "count"

    analysis_settings_abs = AnalysisSettingsForStatsEngine(
        var_names=["zero", "one"],
        var_ids=["zero", "one"],
        weights=[0.5, 0.5],
        baseline_index=0,
        dimension="",
        stats_engine="frequentist",
        sequential_testing_enabled=False,
        sequential_tuning_parameter=5000,
        difference_type="absolute",
        phase_length_days=7,
    )

    # Generate random data with fixed seeds (matching test_devtools.py)
    rng_a_1 = np.random.default_rng(seed=int(20241213))
    rng_b_1 = np.random.default_rng(seed=int(20241214))
    rng_a_2 = np.random.default_rng(seed=int(20241215))
    rng_b_2 = np.random.default_rng(seed=int(20241216))

    mu_a = 1
    n_0 = 599
    n_1 = 500
    delta_abs = 0.15

    y_a_1 = np.sqrt(1) * rng_a_1.normal(size=n_0) + mu_a
    y_b_1 = np.sqrt(1) * rng_b_1.normal(size=n_1) + mu_a + delta_abs
    y_a_2 = np.sqrt(1) * rng_a_2.normal(size=n_0) + mu_a
    y_b_2 = np.sqrt(1) * rng_b_2.normal(size=n_1) + mu_a + delta_abs

    x_a_1 = np.sqrt(1) * rng_a_1.normal(size=n_0)
    x_b_1 = np.sqrt(1) * rng_b_1.normal(size=n_1)
    x_a_2 = np.sqrt(1) * rng_a_2.normal(size=n_0)
    x_b_2 = np.sqrt(1) * rng_b_2.normal(size=n_1)

    # Create statistics
    stat_a_1 = CreateStatistic("sample_mean", y_a_1, x=None, nu=None).create_statistic()
    stat_b_1 = CreateStatistic("sample_mean", y_b_1, x=None, nu=None).create_statistic()
    stat_a_2 = CreateStatistic("sample_mean", y_a_2, x=None, nu=None).create_statistic()
    stat_b_2 = CreateStatistic("sample_mean", y_b_2, x=None, nu=None).create_statistic()

    stat_a_3 = CreateStatistic(
        "regression_adjusted_ratio", np.c_[y_a_1, y_a_2], np.c_[x_a_1, x_a_2], None
    ).create_statistic()
    stat_b_3 = CreateStatistic(
        "regression_adjusted_ratio", np.c_[y_b_1, y_b_2], np.c_[x_b_1, x_b_2], None
    ).create_statistic()

    # Create rows
    row_a_1 = CreateRow(
        stat_a_1,
        dimension_name="dimension",
        dimension_value=analysis_settings_abs.dimension,
        variation=analysis_settings_abs.var_names[0],
    ).create_row()
    row_b_1 = CreateRow(
        stat_b_1,
        dimension_name="dimension",
        dimension_value=analysis_settings_abs.dimension,
        variation=analysis_settings_abs.var_names[1],
    ).create_row()
    row_a_3 = CreateRow(
        stat_a_3,
        dimension_name="dimension",
        dimension_value=analysis_settings_abs.dimension,
        variation=analysis_settings_abs.var_names[0],
    ).create_row()
    row_b_3 = CreateRow(
        stat_b_3,
        dimension_name="dimension",
        dimension_value=analysis_settings_abs.dimension,
        variation=analysis_settings_abs.var_names[1],
    ).create_row()

    query_output_1 = [row_a_1, row_b_1]
    query_output_3 = [row_a_3, row_b_3]

    # Get expected results from TwoSidedTTest
    config = FrequentistConfig(difference_type="absolute")
    res_1 = TwoSidedTTest([(stat_a_1, stat_b_1)], config).compute_result()
    res_3 = TwoSidedTTest([(stat_a_3, stat_b_3)], config).compute_result()

    # Get results through process_single_metric
    results_gbstats_1 = process_single_metric(
        rows=query_output_1,
        metric=metric_settings_1,
        analyses=[analysis_settings_abs],
    )
    results_gbstats_3 = process_single_metric(
        rows=query_output_3,
        metric=metric_settings_2,
        analyses=[analysis_settings_abs],
    )

    def serialize_metric_settings(m):
        return {
            "id": m.id,
            "name": m.name,
            "inverse": m.inverse,
            "statistic_type": m.statistic_type,
            "main_metric_type": m.main_metric_type,
            "denominator_metric_type": getattr(m, 'denominator_metric_type', None),
            "covariate_metric_type": getattr(m, 'covariate_metric_type', None),
            "business_metric_type": getattr(m, 'business_metric_type', None),
        }

    def serialize_analysis_settings(a):
        return {
            "var_names": a.var_names,
            "var_ids": a.var_ids,
            "weights": a.weights,
            "baseline_index": a.baseline_index,
            "dimension": a.dimension,
            "stats_engine": a.stats_engine,
            "sequential_testing_enabled": a.sequential_testing_enabled,
            "sequential_tuning_parameter": a.sequential_tuning_parameter,
            "difference_type": a.difference_type,
            "phase_length_days": a.phase_length_days,
        }

    # TestCreateRows fixtures
    fixtures["test_cases"]["TestCreateRows"] = {
        "test_count_metric": {
            "description": "Test that count metric pipeline produces same CI as direct TwoSidedTTest",
            "inputs": {
                "rows": query_output_1,
                "metric": serialize_metric_settings(metric_settings_1),
                "analyses": [serialize_analysis_settings(analysis_settings_abs)],
            },
            "expected": {
                "ci": [round_(res_1.ci[0]), round_(res_1.ci[1])],
                "gbstats_ci": [
                    round_(results_gbstats_1.analyses[0].dimensions[0].variations[1].ci[0]),
                    round_(results_gbstats_1.analyses[0].dimensions[0].variations[1].ci[1]),
                ],
            },
            "validation": {
                "ci_should_match": list(results_gbstats_1.analyses[0].dimensions[0].variations[1].ci) == res_1.ci,
            },
        },
        "test_ratio_adjusted_regression_metric": {
            "description": "Test that ratio_ra metric pipeline produces same CI as direct TwoSidedTTest",
            "inputs": {
                "rows": query_output_3,
                "metric": serialize_metric_settings(metric_settings_2),
                "analyses": [serialize_analysis_settings(analysis_settings_abs)],
            },
            "expected": {
                "ci": [round_(res_3.ci[0]), round_(res_3.ci[1])],
                "gbstats_ci": [
                    round_(results_gbstats_3.analyses[0].dimensions[0].variations[1].ci[0]),
                    round_(results_gbstats_3.analyses[0].dimensions[0].variations[1].ci[1]),
                ],
            },
            "validation": {
                "ci_should_match": list(results_gbstats_3.analyses[0].dimensions[0].variations[1].ci) == res_3.ci,
            },
        },
    }

    return fixtures


def main():
    """Generate all fixtures and write to JSON files."""
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    os.makedirs(os.path.join(FIXTURES_DIR, 'frequentist'), exist_ok=True)
    os.makedirs(os.path.join(FIXTURES_DIR, 'bayesian'), exist_ok=True)

    encoder = InfinityHandlingEncoder(indent=2)

    # Generate and write frequentist fixtures
    frequentist_fixtures = generate_frequentist_fixtures()
    with open(os.path.join(FIXTURES_DIR, 'frequentist', 'tests.fixtures.json'), 'w') as f:
        f.write(encoder.encode(frequentist_fixtures))
    total_freq_tests = sum(len(tests) for tests in frequentist_fixtures['test_cases'].values())
    print(f"Generated frequentist fixtures: {len(frequentist_fixtures['test_cases'])} test classes, {total_freq_tests} tests")

    # Generate and write Bayesian fixtures
    bayesian_fixtures = generate_bayesian_fixtures()
    with open(os.path.join(FIXTURES_DIR, 'bayesian', 'tests.fixtures.json'), 'w') as f:
        f.write(encoder.encode(bayesian_fixtures))
    total_bayes_tests = sum(len(tests) for tests in bayesian_fixtures['test_cases'].values())
    print(f"Generated bayesian fixtures: {len(bayesian_fixtures['test_cases'])} test classes, {total_bayes_tests} tests")

    # Generate and write statistics fixtures
    statistics_fixtures = generate_statistics_fixtures()
    with open(os.path.join(FIXTURES_DIR, 'statistics.fixtures.json'), 'w') as f:
        f.write(encoder.encode(statistics_fixtures))
    total_stats_tests = sum(len(tests) for tests in statistics_fixtures['test_cases'].values())
    print(f"Generated statistics fixtures: {len(statistics_fixtures['test_cases'])} test classes, {total_stats_tests} tests")

    # Generate and write utils fixtures
    utils_fixtures = generate_utils_fixtures()
    with open(os.path.join(FIXTURES_DIR, 'utils.fixtures.json'), 'w') as f:
        f.write(encoder.encode(utils_fixtures))
    total_utils_tests = sum(len(tests) for tests in utils_fixtures['test_cases'].values())
    print(f"Generated utils fixtures: {len(utils_fixtures['test_cases'])} test classes, {total_utils_tests} tests")

    # Generate and write mid-experiment power fixtures
    power_fixtures = generate_midexperimentpower_fixtures()
    with open(os.path.join(FIXTURES_DIR, 'midexperimentpower.fixtures.json'), 'w') as f:
        f.write(encoder.encode(power_fixtures))
    total_power_tests = sum(len(tests) for tests in power_fixtures['test_cases'].values())
    print(f"Generated mid-experiment power fixtures: {len(power_fixtures['test_cases'])} test classes, {total_power_tests} tests")

    # Generate and write post-stratification fixtures
    post_strat_fixtures = generate_post_stratification_fixtures()
    with open(os.path.join(FIXTURES_DIR, 'frequentist', 'postStratification.fixtures.json'), 'w') as f:
        f.write(encoder.encode(post_strat_fixtures))
    total_post_strat_tests = sum(len(tests) for tests in post_strat_fixtures['test_cases'].values())
    print(f"Generated post-stratification fixtures: {len(post_strat_fixtures['test_cases'])} test classes, {total_post_strat_tests} tests")

    # Generate and write high-level API fixtures
    gbstats_fixtures = generate_gbstats_fixtures()
    with open(os.path.join(FIXTURES_DIR, 'gbstats.fixtures.json'), 'w') as f:
        f.write(encoder.encode(gbstats_fixtures))
    total_gbstats_tests = sum(len(tests) for tests in gbstats_fixtures['test_cases'].values())
    print(f"Generated high-level API fixtures: {len(gbstats_fixtures['test_cases'])} test classes, {total_gbstats_tests} tests")

    # Generate and write devtools fixtures
    os.makedirs(os.path.join(FIXTURES_DIR, 'devtools'), exist_ok=True)
    devtools_fixtures = generate_devtools_fixtures()
    with open(os.path.join(FIXTURES_DIR, 'devtools', 'simulation.fixtures.json'), 'w') as f:
        f.write(encoder.encode(devtools_fixtures))
    total_devtools_tests = sum(len(tests) for tests in devtools_fixtures['test_cases'].values())
    print(f"Generated devtools fixtures: {len(devtools_fixtures['test_cases'])} test classes, {total_devtools_tests} tests")

    total_tests = total_freq_tests + total_bayes_tests + total_stats_tests + total_utils_tests + total_power_tests + total_post_strat_tests + total_gbstats_tests + total_devtools_tests
    print(f"\nTotal tests generated: {total_tests}")
    print("All fixtures generated successfully!")


if __name__ == '__main__':
    main()
