from dataclasses import dataclass
from typing import Any, cast
from gbstats.models.settings import (
    ExperimentMetricQueryResponseRows,
    ContextualBanditSettingsForStatsEngine,
)
import numpy as np

from sklearn.preprocessing import OneHotEncoder
from sklearn.tree import DecisionTreeRegressor
from sklearn.compose import ColumnTransformer


@dataclass(frozen=True)
class ContextWeightRule:
    condition: dict[str, Any]
    weights: list[float]  # same length as variations; order matches var_ids


class BuildClassificationTree:
    """Fit a decision tree over context tuples using per-context variation means as targets (sklearn DecisionTreeRegressor + one-hot encoded context indices).

    Despite the name, the implementation uses a **regression** tree on continuous mean outcomes per variation.
    """

    def __init__(
        self,
        *,
        contexts: list[tuple[str, ...]],
        num_variations: int,
        max_leaf_nodes: int,
        rng: np.random.Generator,
        bandit_settings: ContextualBanditSettingsForStatsEngine,
    ) -> None:
        self.contexts = contexts
        self.num_variations = num_variations
        self.max_leaf_nodes = max_leaf_nodes
        self.rng = rng
        self.bandit_settings = bandit_settings
        self.leaf_map: dict[tuple[str, ...], int] = {}
        self.leaf_ids: list[int] = []
        self.tree_feature_names: list[str] = []

    def build(
        self, rows_by_context: dict[tuple[str, ...], ExperimentMetricQueryResponseRows]
    ) -> None:
        """Populate ``leaf_map``, ``leaf_ids``, ``fitted_tree``, and ``tree_feature_names`` from grouped rows."""
        rows_by_context = {ctx: r for ctx, r in rows_by_context.items() if r}
        groups_with_data = [
            ctx
            for ctx in self.contexts
            if ctx in rows_by_context and rows_by_context[ctx]
        ]
        if not groups_with_data:
            self.leaf_map = {}
            self.leaf_ids = []
            self.fitted_tree = None
            self.tree_feature_names = []
            return

        num_dims = len(self.contexts[0])
        dimension_names: list[str] = getattr(
            self.bandit_settings, "dimension", None
        ) or [f"dimension_{i}" for i in range(num_dims)]
        if len(dimension_names) != num_dims:
            dimension_names = [
                dimension_names[i] if i < len(dimension_names) else f"dimension_{i}"
                for i in range(num_dims)
            ]
        unique_by_dim: list[list[str]] = [
            sorted(set(c[i] for c in self.contexts)) for i in range(num_dims)
        ]
        X_list: list[list[int]] = []
        Y_list: list[list[float]] = []
        sample_weight_list: list[int] = []
        for ctx in groups_with_data:
            rows = rows_by_context[ctx]
            means = [0.0] * self.num_variations
            n_ctx = 0
            for entry in rows:
                v = int(entry["variation"])
                n = int(entry["users"])
                n_ctx += n
                s = entry["main_sum"]
                if isinstance(s, np.ndarray):
                    s = float(s[0])
                else:
                    s = float(s)
                means[v] = (s / n) if n > 0 else 0.0
            x_row = [unique_by_dim[i].index(ctx[i]) for i in range(num_dims)]
            X_list.append(x_row)
            Y_list.append(means)
            sample_weight_list.append(n_ctx)
        X_train = np.array(X_list, dtype=np.float64)
        transformers = [
            (
                f"dim_{i}",
                OneHotEncoder(
                    categories=cast(
                        Any,
                        [np.arange(len(unique_by_dim[i]), dtype=np.int64)],
                    ),
                    sparse_output=False,
                ),
                [i],
            )
            for i in range(num_dims)
        ]
        ct = ColumnTransformer(transformers, remainder="drop")
        X_train_encoded = ct.fit_transform(X_train)
        Y_train = np.array(Y_list, dtype=np.float64)
        tree = DecisionTreeRegressor(
            max_leaf_nodes=self.max_leaf_nodes,
            random_state=np.random.RandomState(self.rng.integers(0, 2**31 - 1)),
        )
        tree.fit(
            X_train_encoded,
            Y_train,
            sample_weight=np.array(sample_weight_list, dtype=np.float64),
        )

        def _row(c: tuple[str, ...]) -> list[float]:
            return [float(unique_by_dim[i].index(c[i])) for i in range(num_dims)]

        X_full = np.array([_row(c) for c in self.contexts], dtype=np.float64)
        X_full_encoded = ct.transform(X_full)
        leaf_ids_arr = tree.apply(X_full_encoded)
        self.leaf_map = {
            self.contexts[i]: int(leaf_ids_arr[i]) for i in range(len(self.contexts))
        }
        self.leaf_ids = sorted(set(self.leaf_map.values()))
        self.fitted_tree = tree
        self.tree_feature_names = ct.get_feature_names_out(dimension_names).tolist()
