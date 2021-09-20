#!/usr/bin/env python

import pytest
import numpy as np
import pandas as pd
from gbstats.gbstats import (
    check_srm,
    get_adjusted_stats,
    process_user_rows,
    process_metric_rows,
    run_analysis,
)
from functools import partial

DECIMALS = 9
round_ = partial(np.round, decimals=DECIMALS)


def test_srm():
    p = check_srm([1000, 1200], [0.5, 0.5])
    assert round_(p) == 0.000020079


def test_adjusted_stats():
    adjusted = get_adjusted_stats(5, 3, 1000, 2000, False, "revenue")
    print(adjusted)
    assert adjusted["users"] == 2000
    assert adjusted["mean"] == 2.5
    assert round_(adjusted["stddev"]) == 3.278852762
    assert adjusted["total"] == 5000


def test_adjusted_stats_binomial():
    adjusted = get_adjusted_stats(1, 0, 1000, 2000, False, "binomial")
    print(adjusted)
    assert adjusted["users"] == 2000
    assert adjusted["mean"] == 1
    assert round_(adjusted["stddev"]) == 0
    assert adjusted["total"] == 1000


def test_adjusted_stats_ignore_nulls():
    adjusted = get_adjusted_stats(5, 3, 1000, 2000, True, "revenue")
    assert adjusted["users"] == 1000
    assert adjusted["mean"] == 5
    assert adjusted["stddev"] == 3
    assert adjusted["total"] == 5000


def test_process_users():
    vars = {"zero": 0, "one": 1}
    rows = pd.DataFrame(
        [{"variation": "one", "users": 120}, {"variation": "zero", "users": 100}]
    )
    users, unknown_variations = process_user_rows(rows, vars)

    assert users == [100, 120]
    assert unknown_variations == []


def test_process_users_unknown_vars():
    var_id_map = {"zero": 0, "one": 1}
    rows = pd.DataFrame(
        [{"variation": "one", "users": 120}, {"variation": "zeros", "users": 100}]
    )
    users, unknown_variations = process_user_rows(rows, var_id_map)

    assert users == [0, 120]
    assert unknown_variations == ["zeros"]


def test_process_metrics():
    rows = pd.DataFrame(
        [
            {"variation": "one", "count": 120, "mean": 2.5, "stddev": 1},
            {"variation": "zero", "count": 100, "mean": 2.7, "stddev": 1.1},
        ]
    )
    var_id_map = {"zero": 0, "one": 1}
    users = [1000, 1010]

    res = process_metric_rows(rows, var_id_map, users, False, "revenue")
    assert res.loc[0].at["users"] == 1000
    assert res.loc[0].at["count"] == 100
    assert res.loc[0].at["mean"] == 0.27
    assert round_(res.loc[0].at["stddev"]) == 0.881286938


def test_process_metrics_ignore_nulls():
    rows = pd.DataFrame(
        [
            {"variation": "one", "count": 120, "mean": 2.5, "stddev": 1},
            {"variation": "zero", "count": 100, "mean": 2.7, "stddev": 1.1},
        ]
    )
    var_id_map = {"zero": 0, "one": 1}
    users = [1000, 1010]

    res = process_metric_rows(rows, var_id_map, users, True, "revenue")
    assert res.loc[0].at["users"] == 100
    assert res.loc[0].at["count"] == 100
    assert res.loc[0].at["mean"] == 2.7
    assert round_(res.loc[0].at["stddev"]) == 1.1


def test_binomial_analysis():
    metric = pd.DataFrame(
        [
            {"users": 1000, "count": 120, "mean": 1, "stddev": 0, "total": 120},
            {"users": 1024, "count": 128, "mean": 1, "stddev": 0, "total": 128},
            {"users": 1000, "count": 102, "mean": 1, "stddev": 0, "total": 102},
        ]
    )
    var_names = ["Control", "Variation 1", "Variation 2"]
    res = run_analysis(metric, var_names, "binomial", False)

    baseline = res.loc[0]
    var1 = res.loc[1]
    var2 = res.loc[2]

    assert baseline.at["variation"] == "Control"
    assert baseline.at["conversion_rate"] == 0.12
    assert baseline.at["chance_to_beat_control"] == None
    assert round_(baseline.at["risk_of_choosing"]) == 0.069118343
    assert baseline.at["percent_change"] == None

    assert var1.at["variation"] == "Variation 1"
    assert var1.at["conversion_rate"] == 0.125
    assert round_(var1.at["chance_to_beat_control"]) == 0.633751254
    assert round_(var1.at["risk_of_choosing"]) == 0.029338254
    assert round_(var1.at["percent_change"]) == 0.041432724

    assert var2.at["variation"] == "Variation 2"
    assert var2.at["conversion_rate"] == 0.102
    assert round_(var2.at["chance_to_beat_control"]) == 0.100849049
    assert round_(var2.at["risk_of_choosing"]) == 0.182688464
    assert round_(var2.at["percent_change"]) == -0.149376661


def test_gaussian_analysis():
    metric = pd.DataFrame(
        [
            {"users": 1000, "count": 120, "mean": 1.3, "stddev": 1, "total": 156},
            {"users": 1024, "count": 128, "mean": 1.29, "stddev": 0.9, "total": 165.12},
            {"users": 1000, "count": 102, "mean": 1.4, "stddev": 1.1, "total": 142.8},
        ]
    )
    var_names = ["Control", "Variation 1", "Variation 2"]
    res = run_analysis(metric, var_names, "duration", True)

    baseline = res.loc[0]
    var1 = res.loc[1]
    var2 = res.loc[2]

    assert baseline.at["variation"] == "Control"
    assert baseline.at["per_user"] == 0.156
    assert baseline.at["chance_to_beat_control"] == None
    assert round_(baseline.at["risk_of_choosing"]) == 0.138620458
    assert baseline.at["percent_change"] == None

    assert var1.at["variation"] == "Variation 1"
    assert var1.at["per_user"] == 0.16125
    assert round_(var1.at["chance_to_beat_control"]) == 0.593436958
    assert round_(var1.at["risk_of_choosing"]) == 0.076604954
    assert round_(var1.at["percent_change"]) == -0.007692308

    assert var2.at["variation"] == "Variation 2"
    assert round_(var2.at["per_user"]) == 0.1428
    assert round_(var2.at["chance_to_beat_control"]) == 0.016533047
    assert round_(var2.at["risk_of_choosing"]) == 0.702254931
    assert round_(var2.at["percent_change"]) == 0.076923077
