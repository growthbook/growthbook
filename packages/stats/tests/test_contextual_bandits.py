import hashlib
import json
from pathlib import Path

import pytest

from gbstats.gbstats import process_contextual_bandit_results


FIXTURE_PATH = (
    Path(__file__).parents[2]
    / "back-end"
    / "test"
    / "fixtures"
    / "contextual-bandit"
    / "mock-input.json"
)


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=True)


def load_fixture():
    return json.loads(FIXTURE_PATH.read_text())


def test_contextual_bandit_mock_golden_fixture(monkeypatch):
    monkeypatch.setenv("GROWTHBOOK_CB_MOCK_STATS", "1")
    data = load_fixture()

    result = process_contextual_bandit_results(data["rows"], data["settings"])

    assert len(result["result"]) == 12
    assert result["tree_summary"]["leaves"][0]["context_ids"] == [
        "leaf0_ctx0",
        "leaf0_ctx1",
        "leaf0_ctx2",
        "leaf1_ctx0",
        "leaf1_ctx1",
        "leaf1_ctx2",
        "leaf2_ctx0",
        "leaf2_ctx1",
        "leaf2_ctx2",
        "leaf3_ctx0",
        "leaf3_ctx1",
        "leaf3_ctx2",
    ]
    assert hashlib.sha256(canonical_json(result).encode()).hexdigest() == (
        "2e206ceee064b8e9c6783362669c91ddb62ea1ec0d8412bb1fae69a02f1e4545"
    )


def test_contextual_bandit_identical_mean_contexts_keep_even_weights(monkeypatch):
    monkeypatch.setenv("GROWTHBOOK_CB_MOCK_STATS", "1")
    data = load_fixture()
    rows = [
        {
            **row,
            "main_sum": row["n"],
            "main_sum_squares": row["n"],
        }
        for row in data["rows"]
    ]

    result = process_contextual_bandit_results(rows, data["settings"])

    for context_result in result["result"]:
        assert context_result["updatedWeights"] == pytest.approx([0.5, 0.5])


def test_contextual_bandit_result_count_matches_input_contexts(monkeypatch):
    monkeypatch.setenv("GROWTHBOOK_CB_MOCK_STATS", "1")
    data = load_fixture()

    result = process_contextual_bandit_results(data["rows"], data["settings"])

    assert len(result["result"]) == len({row["context_id"] for row in data["rows"]})


def test_linear_thompson_reducer_is_stubbed(monkeypatch):
    monkeypatch.delenv("GROWTHBOOK_CB_MOCK_STATS", raising=False)
    data = load_fixture()
    data["settings"]["tree_model"] = "linear_thompson"

    with pytest.raises(NotImplementedError):
        process_contextual_bandit_results(data["rows"], data["settings"])
