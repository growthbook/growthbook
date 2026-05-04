"""Tests for the Contextual Bandit stats-engine pieces (P2.1–P2.4)."""

import json

import pytest

from gbstats.bayesian.dimension_reducer import (
    ContextRow,
    LinearThompsonReducer,
    RegressionTreeReducer,
    make_reducer,
    parse_context_id,
)
from gbstats.bayesian.bandits import ContextualBandits
from gbstats.gbstats import process_contextual_bandit_results
from gbstats.models.settings import ContextualBanditSettingsForStatsEngine


# ---------- P2.1: settings round-trip ----------


def test_contextual_bandit_settings_roundtrip():
    payload = {
        "var_names": ["A", "B"],
        "var_ids": ["0", "1"],
        "reweight": True,
        "decision_metric": "purchases",
        "bandit_weights_seed": 42,
        "contextual_attributes": ["country", "device"],
        "current_weights_by_context": {
            "country=US|device=mobile": [0.5, 0.5],
            "country=CA|device=mobile": [0.5, 0.5],
        },
        "max_leaves": 8,
        "min_users_per_leaf": 50,
        "tree_model": "regression_tree",
        "top_two": True,
    }
    settings = ContextualBanditSettingsForStatsEngine(**payload)
    assert settings.var_ids == ["0", "1"]
    assert settings.tree_model == "regression_tree"

    # The dataclass keeps the same shape after JSON serialization.
    serialized = json.loads(json.dumps(payload))
    again = ContextualBanditSettingsForStatsEngine(**serialized)
    assert again == settings


# ---------- P2.2: regression tree reducer ----------


def _two_attr_rows():
    contexts = []
    for ctx in [
        "country=US|device=mobile",
        "country=US|device=desktop",
        "country=CA|device=mobile",
        "country=CA|device=desktop",
    ]:
        for var in ("0", "1"):
            # Variation 1 is best on mobile, control wins on desktop in US.
            mobile_bonus = 0.2 if "mobile" in ctx and var == "1" else 0.0
            n = 500
            mean = 0.5 + mobile_bonus
            sq = n * (mean ** 2 + 0.1 ** 2)
            contexts.append(
                ContextRow(
                    context_id=ctx,
                    variation=var,
                    n=n,
                    main_sum=n * mean,
                    main_sum_squares=sq,
                )
            )
    return contexts


def test_parse_context_id_handles_other_and_kvs():
    assert parse_context_id("other") == {}
    assert parse_context_id("") == {}
    assert parse_context_id("country=US|device=mobile") == {
        "country": "US",
        "device": "mobile",
    }


def test_regression_tree_partitions_contexts_disjointly():
    rows = _two_attr_rows()
    reducer = RegressionTreeReducer(max_leaves=4, min_users_per_leaf=100)
    leaves = reducer.fit(rows, ["0", "1"])
    assert leaves, "reducer produced no leaves"

    # Every context appears in exactly one leaf
    seen = []
    for leaf in leaves:
        seen.extend(leaf.context_ids)
    assert sorted(seen) == sorted(set(seen))
    assert sorted(seen) == sorted(
        {r.context_id for r in rows}
    )

    # Population sums match
    total_n = sum(leaf.n for leaf in leaves)
    expected_n = sum(r.n for r in rows) // len(["0", "1"]) * len(["0", "1"])
    # leaves aggregate per-context (n counted once per context, not per
    # variation), so total should equal sum of per-context populations.
    per_ctx_n = {}
    for r in rows:
        per_ctx_n[r.context_id] = per_ctx_n.get(r.context_id, 0) + r.n
    assert total_n == sum(per_ctx_n.values())
    _ = expected_n


def test_linear_thompson_stub_raises_on_fit():
    with pytest.raises(NotImplementedError):
        LinearThompsonReducer().fit([], [])


def test_make_reducer_factory():
    r1 = make_reducer("regression_tree", max_leaves=5, min_users_per_leaf=10)
    assert isinstance(r1, RegressionTreeReducer)
    r2 = make_reducer("linear_thompson", max_leaves=5, min_users_per_leaf=10)
    assert isinstance(r2, LinearThompsonReducer)
    with pytest.raises(ValueError):
        make_reducer("nope", max_leaves=1, min_users_per_leaf=1)


# ---------- P2.3: ContextualBandits ----------


def _settings(seed=12345):
    return ContextualBanditSettingsForStatsEngine(
        var_names=["control", "variant"],
        var_ids=["0", "1"],
        reweight=True,
        decision_metric="metric_x",
        bandit_weights_seed=seed,
        contextual_attributes=["country", "device"],
        current_weights_by_context={
            "country=US|device=mobile": [0.5, 0.5],
            "country=US|device=desktop": [0.5, 0.5],
            "country=CA|device=mobile": [0.5, 0.5],
            "country=CA|device=desktop": [0.5, 0.5],
        },
        max_leaves=4,
        min_users_per_leaf=100,
        tree_model="regression_tree",
        top_two=True,
    )


def test_contextual_bandits_returns_one_result_per_context():
    rows = _two_attr_rows()
    settings = _settings()
    cb = ContextualBandits(settings)
    result = cb.run(rows)

    assert result.error is None
    assert {r.contextId for r in result.result} == {
        "country=US|device=mobile",
        "country=US|device=desktop",
        "country=CA|device=mobile",
        "country=CA|device=desktop",
    }
    # Every context must inherit weights from its parent leaf
    for ctx_result in result.result:
        leaf = next(
            l for l in result.tree_summary.leaves if l.leafId == ctx_result.leafId
        )
        assert ctx_result.weights == leaf.weights


def test_contextual_bandits_deterministic_given_seed():
    rows = _two_attr_rows()
    a = ContextualBandits(_settings(seed=42)).run(rows)
    b = ContextualBandits(_settings(seed=42)).run(rows)
    assert [r.weights for r in a.result] == [r.weights for r in b.result]


def test_contextual_bandits_handles_empty_input():
    settings = _settings()
    out = ContextualBandits(settings).run([])
    assert out.result == []
    assert out.error is None


# ---------- P2.4: top-level entrypoint ----------


def test_process_contextual_bandit_results_round_trip():
    rows = [
        {
            "context_id": r.context_id,
            "variation": r.variation,
            "n": r.n,
            "main_sum": r.main_sum,
            "main_sum_squares": r.main_sum_squares,
        }
        for r in _two_attr_rows()
    ]
    out = process_contextual_bandit_results(rows, _settings())
    assert out.error is None
    assert len(out.result) == 4


def test_process_contextual_bandit_results_invalid_rows_returns_error():
    out = process_contextual_bandit_results(
        [{"context_id": "a"}],  # missing required fields
        _settings(),
    )
    assert out.error is not None
    assert out.result == []


def test_process_contextual_bandit_results_linear_thompson_returns_error():
    settings = ContextualBanditSettingsForStatsEngine(
        var_names=["control", "variant"],
        var_ids=["0", "1"],
        reweight=True,
        decision_metric="metric_x",
        bandit_weights_seed=42,
        contextual_attributes=["country"],
        current_weights_by_context={},
        max_leaves=4,
        min_users_per_leaf=100,
        tree_model="linear_thompson",
        top_two=True,
    )
    rows = [
        {
            "context_id": "country=US",
            "variation": "0",
            "n": 100,
            "main_sum": 10.0,
            "main_sum_squares": 5.0,
        }
    ]
    out = process_contextual_bandit_results(rows, settings)
    assert out.error is not None
    assert "v1.x" in (out.error or "") or "linear" in (out.error or "").lower()
