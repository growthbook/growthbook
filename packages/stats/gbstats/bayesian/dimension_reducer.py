"""Dimension reduction strategies for the Contextual Bandit stats engine.

The reducer takes per-context aggregated rows produced by the SQL layer and
groups them into a small set of leaves. v1 ships `RegressionTreeReducer`; the
`linear_thompson` model is stubbed behind the same interface so that v1.x can
flip a config flag without a payload-shape change.

Each context_id is the dimension string emitted by `getContextualBanditCaseWhen`
in the back-end. Its key=value pairs encode the attribute values that the SDK
will match on at assignment time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Protocol

import numpy as np


# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass
class ContextRow:
    """Per-(variation, context) aggregated row coming out of SQL."""

    context_id: str
    variation: str
    n: int
    main_sum: float
    main_sum_squares: float


@dataclass
class Leaf:
    """A leaf produced by the reducer.

    Attributes:
        leaf_id: Unique id within a single reducer run.
        rule: Human-readable description, e.g. ``"country in [US,CA] AND device=mobile"``.
        condition: SDK-condition shape, e.g. ``{"country": {"$in": ["US", "CA"]}, "device": "mobile"}``.
        context_ids: All context ids assigned to this leaf.
        n: Total user count across the contained contexts.
    """

    leaf_id: str
    rule: str
    condition: Dict[str, Any] = field(default_factory=dict)
    context_ids: List[str] = field(default_factory=list)
    n: int = 0


class DimensionReducer(Protocol):
    """Strategy interface — group per-context rows into leaves."""

    def fit(
        self,
        contexts: List[ContextRow],
        variations: List[str],
    ) -> List[Leaf]:
        ...


# ---------------------------------------------------------------------------
# Helpers — context_id parsing
# ---------------------------------------------------------------------------


def parse_context_id(context_id: str) -> Dict[str, str]:
    """Parse the dimension string emitted by SQL into a dict.

    Format produced by `getContextualBanditCaseWhen`:
        "attr1=value1|attr2=value2|..." or "other".
    """
    if not context_id or context_id == "other":
        return {}
    out: Dict[str, str] = {}
    for part in context_id.split("|"):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip()] = v.strip()
    return out


# ---------------------------------------------------------------------------
# RegressionTreeReducer — v1 default
# ---------------------------------------------------------------------------


class _Node:
    __slots__ = ("rows", "split_attr", "split_values", "left", "right")

    def __init__(self, rows: List[ContextRow]):
        self.rows: List[ContextRow] = rows
        self.split_attr: str | None = None
        self.split_values: set[str] | None = None
        self.left: "_Node | None" = None
        self.right: "_Node | None" = None

    def is_leaf(self) -> bool:
        return self.split_attr is None


class RegressionTreeReducer(DimensionReducer):
    """A small CART-style regression tree on per-context posterior reward.

    Parses each ``context_id`` into attribute=value pairs, one-hot encodes,
    and greedily splits to minimize squared-error of the per-context posterior
    mean (using ``main_sum / n`` as the target). Splits respect
    ``min_users_per_leaf`` and stop when ``max_leaves`` is reached.
    """

    def __init__(self, max_leaves: int = 12, min_users_per_leaf: int = 100):
        if max_leaves < 1:
            raise ValueError("max_leaves must be >= 1")
        self.max_leaves = max_leaves
        self.min_users_per_leaf = min_users_per_leaf

    # -------- public --------

    def fit(
        self,
        contexts: List[ContextRow],
        variations: List[str],
    ) -> List[Leaf]:
        if not contexts:
            return []

        # Aggregate to per-context rows (sum across variations) so that splits
        # operate on contexts, not variation-context cells.
        per_ctx = self._aggregate_per_context(contexts)
        if not per_ctx:
            return []

        # Edge case: only one unique context — single leaf.
        if len(per_ctx) == 1:
            (cid, agg) = next(iter(per_ctx.items()))
            return [
                Leaf(
                    leaf_id="leaf_0",
                    rule="all",
                    condition={},
                    context_ids=[cid],
                    n=int(agg["n"]),
                )
            ]

        root = _Node(list(per_ctx.values()))
        leaves: List[_Node] = [root]

        while len(leaves) < self.max_leaves:
            best = self._best_split(leaves)
            if best is None:
                break
            node, attr, left_values, left_rows, right_rows = best
            node.split_attr = attr
            node.split_values = left_values
            node.left = _Node(left_rows)
            node.right = _Node(right_rows)
            leaves.remove(node)
            leaves.extend([node.left, node.right])

        return self._materialize_leaves(root)

    # -------- internals --------

    def _aggregate_per_context(
        self, contexts: List[ContextRow]
    ) -> Dict[str, Dict[str, float]]:
        per: Dict[str, Dict[str, float]] = {}
        for row in contexts:
            agg = per.setdefault(
                row.context_id,
                {"n": 0.0, "sum": 0.0, "context_id": row.context_id},  # type: ignore[dict-item]
            )
            agg["n"] += row.n
            agg["sum"] += row.main_sum
        # convert into ContextRow-like dicts (keep dict for speed)
        return per

    def _best_split(self, leaves: List[_Node]):
        best_score = None
        best_tuple = None
        for node in leaves:
            if len(node.rows) < 2:
                continue
            attrs = self._candidate_attrs(node.rows)
            for attr, values in attrs.items():
                # Try each binary partition of (attr in subset) vs (rest).
                # For categorical: use single-value subsets (greedy, scalable).
                for v in sorted(values):
                    left = [r for r in node.rows if self._row_attr(r, attr) == v]
                    right = [r for r in node.rows if self._row_attr(r, attr) != v]
                    if not self._meets_min_users(left) or not self._meets_min_users(
                        right
                    ):
                        continue
                    score = self._sse(left) + self._sse(right)
                    if best_score is None or score < best_score:
                        best_score = score
                        best_tuple = (node, attr, {v}, left, right)
        return best_tuple

    @staticmethod
    def _row_attr(row: Dict[str, float], attr: str) -> str:
        cid = str(row["context_id"])
        return parse_context_id(cid).get(attr, "")

    def _candidate_attrs(
        self, rows: List[Dict[str, float]]
    ) -> Dict[str, set[str]]:
        attrs: Dict[str, set[str]] = {}
        for r in rows:
            for k, v in parse_context_id(str(r["context_id"])).items():
                attrs.setdefault(k, set()).add(v)
        # Drop attrs with only one distinct value (no split possible).
        return {k: vs for k, vs in attrs.items() if len(vs) > 1}

    def _meets_min_users(self, rows: List[Dict[str, float]]) -> bool:
        return sum(int(r["n"]) for r in rows) >= self.min_users_per_leaf

    @staticmethod
    def _sse(rows: List[Dict[str, float]]) -> float:
        if not rows:
            return 0.0
        total_n = sum(r["n"] for r in rows)
        if total_n <= 0:
            return 0.0
        weighted_mean = sum(r["sum"] for r in rows) / total_n
        return float(
            sum(((r["sum"] / r["n"]) - weighted_mean) ** 2 * r["n"] for r in rows)
        )

    def _materialize_leaves(self, root: _Node) -> List[Leaf]:
        leaves: List[Leaf] = []

        def recurse(node: _Node, conds: Dict[str, set[str]], rule_parts: List[str]):
            if node.is_leaf():
                # Build SDK condition: for each accumulated attribute,
                # use $in for sets with multiple values, scalar otherwise.
                condition: Dict[str, Any] = {}
                for attr, values in conds.items():
                    vals = sorted(values)
                    if len(vals) == 1:
                        condition[attr] = vals[0]
                    else:
                        condition[attr] = {"$in": vals}
                ctx_ids = [str(r["context_id"]) for r in node.rows]
                leaves.append(
                    Leaf(
                        leaf_id=f"leaf_{len(leaves)}",
                        rule=" AND ".join(rule_parts) or "all",
                        condition=condition,
                        context_ids=ctx_ids,
                        n=int(sum(r["n"] for r in node.rows)),
                    )
                )
                return
            assert node.split_attr and node.split_values
            attr = node.split_attr
            left_vals = set(node.split_values)
            new_conds_left = {**conds, attr: left_vals}
            new_conds_right = {**conds}
            # right side: anything not in left_vals (we don't enumerate it
            # at the SDK condition level; the left match wins via order).
            recurse(
                node.left,
                new_conds_left,
                rule_parts + [self._rule_part(attr, left_vals, negated=False)],
            )
            recurse(
                node.right,
                new_conds_right,
                rule_parts + [self._rule_part(attr, left_vals, negated=True)],
            )

        recurse(root, {}, [])
        return leaves

    @staticmethod
    def _rule_part(attr: str, values: set[str], negated: bool) -> str:
        vals = sorted(values)
        if len(vals) == 1:
            op = "!=" if negated else "="
            return f"{attr} {op} {vals[0]}"
        op = "not in" if negated else "in"
        return f"{attr} {op} [{','.join(vals)}]"


# ---------------------------------------------------------------------------
# LinearThompsonReducer — v1.x stub
# ---------------------------------------------------------------------------


class LinearThompsonReducer(DimensionReducer):
    """Placeholder for the linear-Thompson reducer scheduled for v1.x.

    Exists so that the factory can resolve `tree_model: "linear_thompson"`
    without import-time failure; calling `.fit()` raises so callers see a
    clear runtime error.
    """

    def __init__(self, *_: object, **__: object) -> None:
        return None

    def fit(
        self, contexts: List[ContextRow], variations: List[str]
    ) -> List[Leaf]:
        raise NotImplementedError(
            "LinearThompsonReducer is scheduled for v1.x; v1 only supports regression_tree."
        )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def make_reducer(
    tree_model: str,
    max_leaves: int,
    min_users_per_leaf: int,
) -> DimensionReducer:
    if tree_model == "regression_tree":
        return RegressionTreeReducer(
            max_leaves=max_leaves, min_users_per_leaf=min_users_per_leaf
        )
    if tree_model == "linear_thompson":
        return LinearThompsonReducer()
    raise ValueError(f"Unknown tree_model: {tree_model!r}")


# Keep numpy reachable so static checkers don't drop it for unused imports;
# downstream code (`ContextualBandits`) needs np for posterior aggregation.
_ = np
