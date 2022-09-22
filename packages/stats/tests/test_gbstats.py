import pytest
import numpy as np
import pandas as pd
from gbstats.gbstats import (
    check_srm,
    correctMean,
    correctStddev,
    detect_unknown_variations,
    reduce_dimensionality,
    analyze_metric_df,
    get_metric_df,
)
from functools import partial

DECIMALS = 9
round_ = partial(np.round, decimals=DECIMALS)


def test_srm():
    p = check_srm([1000, 1200], [0.5, 0.5])
    assert round_(p) == 0.000020079


def test_correct_stddev():
    s = correctStddev(100, 10, 5, 150, 15, 3)
    assert round_(s) == 4.620540833
    s = correctStddev(0, 0, 0, 1, 15, 0)
    assert s == 0


def test_correct_mean():
    m = correctMean(100, 10, 150, 15)
    assert m == 13
    m = correctMean(0, 0, 1, 15)
    assert m == 15


def test_unknown_variations():
    rows = pd.DataFrame(
        [
            {
                "dimension": "All",
                "variation": "one",
                "count": 120,
                "mean": 2.5,
                "stddev": 1,
                "users": 1000,
            },
            {
                "dimension": "All",
                "variation": "zero",
                "count": 100,
                "mean": 2.7,
                "stddev": 1.1,
                "users": 1100,
            },
        ]
    )
    assert detect_unknown_variations(rows, {"zero": 0, "one": 1}) == set()
    assert detect_unknown_variations(rows, {"zero": 0, "hello": 1}) == {"one"}
    assert detect_unknown_variations(rows, {"hello": 0, "world": 1}) == {"one", "zero"}


def test_multiple_exposures():
    rows = pd.DataFrame(
        [
            {
                "dimension": "All",
                "variation": "one",
                "count": 120,
                "mean": 2.5,
                "stddev": 1,
                "users": 1000,
            },
            {
                "dimension": "All",
                "variation": "two",
                "count": 100,
                "mean": 2.7,
                "stddev": 1.1,
                "users": 1100,
            },
            {
                "dimension": "All",
                "variation": "__multiple__",
                "count": 50,
                "mean": 2.7,
                "stddev": 1.1,
                "users": 500,
            },
        ]
    )
    assert detect_unknown_variations(rows, {"one": 0, "two": 1}) == set()
    assert detect_unknown_variations(rows, {"one": 0, "two": 1}, {"some_other"}) == {
        "__multiple__"
    }


def test_reduce_dimensionality():
    rows = pd.DataFrame(
        [
            {
                "dimension": "one",
                "variation": "one",
                "count": 1000,
                "mean": 2.5,
                "stddev": 1,
                "users": 1000,
            },
            {
                "dimension": "one",
                "variation": "zero",
                "count": 1100,
                "mean": 2.7,
                "stddev": 1.1,
                "users": 1100,
            },
            {
                "dimension": "two",
                "variation": "one",
                "count": 2000,
                "mean": 3.5,
                "stddev": 2,
                "users": 2000,
            },
            {
                "dimension": "two",
                "variation": "zero",
                "count": 2100,
                "mean": 3.7,
                "stddev": 2.1,
                "users": 2100,
            },
            {
                "dimension": "three",
                "variation": "one",
                "count": 3000,
                "mean": 4.5,
                "stddev": 3,
                "users": 3000,
            },
            {
                "dimension": "three",
                "variation": "zero",
                "count": 3100,
                "mean": 4.7,
                "stddev": 3.1,
                "users": 3100,
            },
        ]
    )
    df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
    reduced = reduce_dimensionality(df, 3)
    print(reduced)
    assert len(reduced.index) == 3
    assert reduced.at[0, "dimension"] == "three"
    assert reduced.at[0, "v1_mean"] == 4.5
    assert reduced.at[0, "v1_stddev"] == 3.0
    assert reduced.at[0, "v1_users"] == 3000

    reduced = reduce_dimensionality(df, 2)
    print(reduced)
    assert len(reduced.index) == 2
    assert reduced.at[1, "dimension"] == "(other)"
    assert round_(reduced.at[1, "v1_mean"]) == 3.166666667
    assert round_(reduced.at[1, "v1_stddev"]) == 1.794889811
    assert reduced.at[1, "total_users"] == 6200
    assert reduced.at[1, "v1_users"] == 3000
    assert reduced.at[1, "v1_total"] == 9500
    assert reduced.at[1, "baseline_users"] == 3200
    assert reduced.at[1, "baseline_total"] == 10740


def test_analyze_metric_normal_df():
    rows = pd.DataFrame(
        [
            {
                "dimension": "one",
                "variation": "one",
                "count": 120,
                "mean": 2.5,
                "stddev": 1,
                "users": 120,
            },
            {
                "dimension": "one",
                "variation": "zero",
                "count": 100,
                "mean": 2.7,
                "stddev": 1.1,
                "users": 100,
            },
            {
                "dimension": "two",
                "variation": "one",
                "count": 220,
                "mean": 3.5,
                "stddev": 2,
                "users": 220,
            },
            {
                "dimension": "two",
                "variation": "zero",
                "count": 200,
                "mean": 3.7,
                "stddev": 2.1,
                "users": 200,
            },
        ]
    )
    df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
    result = analyze_metric_df(df, [0.5, 0.5], "revenue", False)

    print(result)

    assert len(result.index) == 2
    assert result.at[0, "dimension"] == "one"
    assert round_(result.at[0, "baseline_cr"]) == 2.7
    assert round_(result.at[0, "baseline_risk"]) == 0.0021006
    assert round_(result.at[0, "v1_cr"]) == 2.5
    assert round_(result.at[0, "v1_risk"]) == 0.0821006
    assert round_(result.at[0, "v1_expected"]) == -0.074074074
    assert round_(result.at[0, "v1_prob_beat_baseline"]) == 0.079755378
