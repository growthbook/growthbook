from dataclasses import dataclass, field
from typing import Any, cast
from gbstats.models.results import BanditResult
from gbstats.models.settings import (
    AnalysisSettingsForStatsEngine,
    ContextKey,
    ExperimentMetricQueryResponseRows,
    MetricSettingsForStatsEngine,
    BanditSettingsForStatsEngine,
    ContextualBanditSettingsForStatsEngine,
    ContextualTreeBanditSettingsForStatsEngine,
)
from gbstats.gbstats import get_bandit_result, get_dimension_column_name
import numpy as np
import copy
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.tree import DecisionTreeRegressor

BANDIT_DIMENSION_COLUMN = "dimension"
BANDIT_DIMENSION_VALUE = "All"


def _rows_for_bandit(
    rows: ExperimentMetricQueryResponseRows,
    dimension_value: str = BANDIT_DIMENSION_VALUE,
) -> ExperimentMetricQueryResponseRows:
    """Copy rows and set dimension column to value so get_bandit_result's filter passes."""
    out = []
    for r in rows:
        row = copy.copy(r)
        row[BANDIT_DIMENSION_COLUMN] = dimension_value
        out.append(row)
    return out


@dataclass
class ContextualBanditResponse:
    """Container for per-context bandit results. responses maps context (str or tuple) to BanditResult."""

    responses: dict[ContextKey, BanditResult] = field(default_factory=dict)


@dataclass
class ContextualTreeBanditResponse(ContextualBanditResponse):
    """Per-context bandit result. leaf_map is context -> leaf_id for reference."""

    leaf_map: dict = field(default_factory=dict)  # context -> leaf_id


def no_update_result(weights: list) -> BanditResult:
    """Build a BanditResult that leaves weights unchanged (no update)."""
    w = weights.copy()
    return BanditResult(
        singleVariationResults=None,
        currentWeights=w,
        updatedWeights=w,
        bestArmProbabilities=w,
        seed=0,
        updateMessage=None,
        error=None,
        reweight=False,
        weightsWereUpdated=False,
    )


def create_contexts(
    rows: ExperimentMetricQueryResponseRows, context_columns: list[str]
) -> list[tuple[str, ...]]:
    """Unique context tuples from rows, one value per dimension column in context_columns."""
    return sorted(set(tuple(str(row[col]) for col in context_columns) for row in rows))


def create_rows_by_context(
    rows: ExperimentMetricQueryResponseRows,
    context_columns: list[str],
    unique_contexts: list[tuple[str, ...]],
) -> dict[tuple[str, ...], ExperimentMetricQueryResponseRows]:
    return {
        ctx: [r for r in rows if tuple(str(r[col]) for col in context_columns) == ctx]
        for ctx in unique_contexts
    }


class UpdateWeightsContextualBandit:
    """Updates variation weights per context. rows (ExperimentMetricQueryResponseRows) is an input; contexts are derived from analysis_settings.dimension. Call compute_result() to get per-context BanditResults (optionally pass rows to override, and current_weights_by_context for priors)."""

    def __init__(
        self,
        rows: ExperimentMetricQueryResponseRows,
        metric_settings: MetricSettingsForStatsEngine,
        analysis_settings: AnalysisSettingsForStatsEngine,
        contextual_bandit_settings: ContextualBanditSettingsForStatsEngine,
    ):
        """Store rows, metric/analysis settings, and contextual bandit settings for later use in compute_result()."""
        self.rows = rows
        self.metric_settings = metric_settings
        self.analysis_settings = analysis_settings
        self.contextual_bandit_settings = contextual_bandit_settings

    def compute_result(self) -> ContextualBanditResponse:
        """Derive contexts from rows and contextual_bandit_settings.contexts (list of column names); run bandit per context; return per-context BanditResult. If current_weights is provided per context, use it as prior; otherwise use analysis_settings.weights."""
        num_variations = len(self.contextual_bandit_settings.var_ids)
        default_weights = (
            list(self.analysis_settings.weights)
            if getattr(self.analysis_settings, "weights", None)
            else [1.0 / num_variations] * num_variations
        )

        if not self.rows:
            # If there are no rows, return no-update results for all contexts we have weights for.
            context_keys = list(
                self.contextual_bandit_settings.current_contextual_weights
            ) or [BANDIT_DIMENSION_VALUE]
            responses = {
                ctx: no_update_result(
                    self.contextual_bandit_settings.current_contextual_weights.get(ctx)
                    or default_weights
                )
                for ctx in context_keys
            }
            return ContextualBanditResponse(
                responses=cast(dict[ContextKey, BanditResult], responses)
            )
        elif not self.contextual_bandit_settings.contexts:
            # If there are no contexts, return no-update results for all contexts we have weights for.
            context_keys = list(
                self.contextual_bandit_settings.current_contextual_weights
            ) or [BANDIT_DIMENSION_VALUE]
            return ContextualBanditResponse(
                responses={
                    ctx: no_update_result(default_weights) for ctx in context_keys
                }
            )
        else:
            # Unique contexts: one tuple per combination of (col0, col1, ...) across rows
            contexts = create_contexts(
                self.rows, self.contextual_bandit_settings.contexts
            )
            rows_by_ctx = create_rows_by_context(
                self.rows, self.contextual_bandit_settings.contexts, contexts
            )
            result = ContextualBanditResponse({})

            for ctx in contexts:
                if (
                    ctx
                    not in self.contextual_bandit_settings.current_contextual_weights
                ):
                    self.contextual_bandit_settings.current_contextual_weights[ctx] = (
                        default_weights.copy()
                    )

            for ctx in contexts:
                rows_for_bandit = _rows_for_bandit(
                    rows_by_ctx[ctx], BANDIT_DIMENSION_VALUE
                )
                bandit_settings = BanditSettingsForStatsEngine(
                    var_names=self.contextual_bandit_settings.var_names,
                    var_ids=self.contextual_bandit_settings.var_ids,
                    current_weights=self.contextual_bandit_settings.current_contextual_weights.get(
                        ctx, default_weights
                    ),
                    reweight=self.contextual_bandit_settings.reweight,
                    decision_metric=self.contextual_bandit_settings.decision_metric,
                    bandit_weights_seed=self.contextual_bandit_settings.bandit_weights_seed,
                    bandit_weights_rng=self.contextual_bandit_settings.bandit_weights_rng,
                    weight_by_period=self.contextual_bandit_settings.weight_by_period,
                    top_two=self.contextual_bandit_settings.top_two,
                )
                r = get_bandit_result(
                    rows=rows_for_bandit,
                    metric=self.metric_settings,
                    settings=self.analysis_settings,
                    bandit_settings=bandit_settings,
                )
                result.responses[ctx] = r
            return ContextualBanditResponse(
                responses=cast(dict[ContextKey, BanditResult], result.responses)
            )


class UpdateWeightsContextualTree:
    """Fits a tree over contexts and updates variation weights per leaf via UpdateWeightsContextualBandit. Same constructor args as UpdateWeightsContextualBandit except bandit_settings is ContextualTreeBanditSettingsForStatsEngine."""

    def __init__(
        self,
        rows: ExperimentMetricQueryResponseRows,
        metric_settings: MetricSettingsForStatsEngine,
        analysis_settings: AnalysisSettingsForStatsEngine,
        bandit_settings: ContextualTreeBanditSettingsForStatsEngine,
    ):
        """Initialize the tree with rows and settings; derive contexts from rows and analysis_settings.dimension, and set up leaf structure and internal bandit for per-leaf weight updates."""
        self.rows = rows
        self.metric_settings = metric_settings
        self.analysis_settings = analysis_settings
        self.bandit_settings = bandit_settings
        self.max_leaf_nodes = getattr(bandit_settings, "max_leaf_nodes", 12)
        num_vars = len(bandit_settings.var_ids or bandit_settings.var_names)
        if num_vars == 0:
            raise ValueError("No variations found in bandit settings")
        default_w = getattr(analysis_settings, "weights", None)
        self.initial_weights = (
            list(default_w) if default_w is not None else [1.0 / num_vars] * num_vars
        )
        self.num_variations = num_vars
        self.rng = bandit_settings.bandit_weights_rng

        if not rows or len(rows) == 0:
            self.contexts = [(BANDIT_DIMENSION_VALUE,)]
        else:
            dim_str = (analysis_settings.dimension or "").strip()
            dim_col = (
                get_dimension_column_name(dim_str)
                if dim_str
                else BANDIT_DIMENSION_COLUMN
            )
            if dim_col not in rows[0]:
                self.contexts = [(BANDIT_DIMENSION_VALUE,)]
            else:
                # Normalize to 1-tuples so build_tree can use c[0]
                # self.contexts = [(c,) for c in sorted(set(str(row[dim_col]) for row in rows))]
                self.contexts = create_contexts(rows, self.bandit_settings.contexts)
        self.leaf_ids = []
        self.leaf_map = {}
        self.merge_combined_rows = lambda a, b: (a or []) + (b or [])

    @property
    def contexts_by_leaf(self) -> dict:
        """Leaf id -> list of contexts in that leaf. Derived from leaf_map."""
        out: dict = {}
        for ctx, leaf_id in self.leaf_map.items():
            out.setdefault(leaf_id, []).append(ctx)
        return out

    def set_leaf_structure(self, leaf_map: dict, leaf_ids: list):
        """Set leaf structure (called by build_tree)."""
        self.leaf_map = leaf_map
        self.leaf_ids = leaf_ids

    def rows_to_rows_by_context(
        self, rows: ExperimentMetricQueryResponseRows
    ) -> dict[tuple, ExperimentMetricQueryResponseRows]:
        """Transform flat ExperimentMetricQueryResponseRows into the structure expected by build_tree: dict mapping context (tuple of dimension values) -> list of rows.
        Uses bandit_settings.dimension for column names (arbitrary number of dimensions), falling back to analysis_settings.dimension for a single dimension.
        Example:
        rows = [
            {"dimension": "A", "variation": 0, "users": 100, "main_sum": 1000},
            {"dimension": "A", "variation": 1, "users": 200, "main_sum": 2000},
            {"dimension": "B", "variation": 0, "users": 150, "main_sum": 1500},
        ]
        """
        if not rows:
            return {}
        out: dict[tuple, ExperimentMetricQueryResponseRows] = {}
        for row in rows:
            ctx = tuple(
                str(row.get(col, BANDIT_DIMENSION_VALUE))
                for col in self.bandit_settings.contexts
            )
            out.setdefault(ctx, []).append(row)
        return out

    def build_tree(self, rows_by_context: dict):
        """Fit DecisionTreeRegressor on observed variation means per group. Dimension info and one-hot encoding come from bandit_settings.dimension (arbitrary number of dimensions). Sets leaf_map and leaf_ids."""
        rows_by_context = {ctx: r for ctx, r in rows_by_context.items() if r}
        groups_with_data = [
            ctx
            for ctx in self.contexts
            if ctx in rows_by_context and rows_by_context[ctx]
        ]
        if not groups_with_data:
            self.set_leaf_structure({}, [])
            self._last_fitted_tree = None
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
        unique_by_dim: list[list] = [
            sorted(set(cast(Any, c)[i] for c in self.contexts)) for i in range(num_dims)
        ]
        X_list, Y_list, sample_weight_list = [], [], []
        for ctx in groups_with_data:
            rows = rows_by_context[ctx]
            means = [0.0] * self.num_variations
            n_ctx = 0
            for entry in rows:
                v = entry["variation"]
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
        # Stubs narrow OneHotEncoder.categories; runtime accepts list of category arrays.
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

        def _row(c: tuple) -> list[float]:
            return [float(unique_by_dim[i].index(c[i])) for i in range(num_dims)]

        X_full = np.array([_row(c) for c in self.contexts], dtype=np.float64)
        X_full_encoded = ct.transform(X_full)
        leaf_ids_arr = tree.apply(X_full_encoded)
        leaf_map = {
            self.contexts[i]: int(leaf_ids_arr[i]) for i in range(len(self.contexts))
        }
        leaf_ids_list = sorted(set(leaf_map.values()))
        self.set_leaf_structure(leaf_map, leaf_ids_list)
        self._last_fitted_tree = tree
        self._last_tree_feature_names = ct.get_feature_names_out(
            dimension_names
        ).tolist()

    def _build_by_leaf_cumulative(self, rows_by_context: dict) -> dict:
        """Aggregate rows_by_context (context -> rows) into per-leaf rows by merging all contexts that map to the same leaf_id. Returns dict mapping leaf_id -> merged list of rows."""
        by_leaf_cumulative = {}
        for leaf_id in self.leaf_ids:
            rows_leaf = None
            for ctx in self.contexts:
                if self.leaf_map.get(ctx) == leaf_id and rows_by_context.get(ctx):
                    if rows_leaf is None:
                        rows_leaf = copy.deepcopy(rows_by_context[ctx])
                    else:
                        rows_leaf = self.merge_combined_rows(
                            rows_leaf, rows_by_context[ctx]
                        )
            if rows_leaf is not None:
                by_leaf_cumulative[leaf_id] = rows_leaf
        return by_leaf_cumulative

    def _aggregate_leaf_rows_for_bandit(
        self, rows: ExperimentMetricQueryResponseRows
    ) -> ExperimentMetricQueryResponseRows:
        """Merge all rows in a leaf (many contexts × variations) into one row per variation with summed users, main_sum, and main_sum_squares for get_bandit_result."""
        if not rows:
            return []
        by_var: dict[int, list[dict[str, Any]]] = {}
        for r in rows:
            v = int(r["variation"])
            by_var.setdefault(v, []).append(r)
        bandit_period = rows[0].get("bandit_period", 0)
        out: list[dict[str, Any]] = []
        for v in range(self.num_variations):
            grp = by_var.get(v, [])
            if not grp:
                out.append(
                    {
                        "dimension": BANDIT_DIMENSION_VALUE,
                        "bandit_period": bandit_period,
                        "variation": v,
                        "users": 0,
                        "count": 0,
                        "main_sum": np.array([0.0]),
                        "main_sum_squares": np.array([0.0]),
                    }
                )
                continue
            users = sum(int(r["users"]) for r in grp)
            main_sum = sum(float(np.asarray(r["main_sum"]).flat[0]) for r in grp)
            main_sum_squares = sum(
                float(np.asarray(r.get("main_sum_squares", 0)).flat[0]) for r in grp
            )
            row = {
                "dimension": BANDIT_DIMENSION_VALUE,
                "bandit_period": bandit_period,
                "variation": v,
                "users": users,
                "count": users,
                "main_sum": np.array([main_sum]),
                "main_sum_squares": np.array([main_sum_squares]),
            }
            out.append(row)
        return cast(ExperimentMetricQueryResponseRows, out)

    def compute_result(self) -> ContextualTreeBanditResponse:
        """Call build_tree(rows_by_context derived from self.rows), then for each leaf aggregate rows to one row per variation and run get_bandit_result. Reads and updates current_weights keyed by str(leaf_id). Returns ContextualTreeBanditResponse mapping each context (str) to its leaf's BanditResult."""
        rows_by_context = self.rows_to_rows_by_context(self.rows)
        self.build_tree(rows_by_context)
        if not self.leaf_ids:
            w = self.initial_weights.copy()
            no_update = no_update_result(w)
            return ContextualTreeBanditResponse(
                responses={str(ctx): no_update for ctx in self.contexts},
                leaf_map=copy.copy(self.leaf_map),
            )
        by_leaf_cumulative = self._build_by_leaf_cumulative(rows_by_context)
        # Per leaf: collapse all context rows to one row per variation, run pooled bandit once,
        # store updated weights under str(leaf_id); then map each context to its leaf's result.
        result_by_leaf: dict[int, BanditResult] = {}
        for leaf_id in self.leaf_ids:
            key = str(leaf_id)
            self.bandit_settings.current_contextual_weights.setdefault(
                key, self.initial_weights.copy()
            )
            rows_leaf = by_leaf_cumulative.get(leaf_id) or []
            if not rows_leaf:
                raise ValueError(f"No rows for leaf {leaf_id}")
            rows_agg = self._aggregate_leaf_rows_for_bandit(rows_leaf)
            rows_for_bandit = _rows_for_bandit(rows_agg, BANDIT_DIMENSION_VALUE)
            leaf_weights = list(self.bandit_settings.current_contextual_weights[key])
            bandit_settings = BanditSettingsForStatsEngine(
                var_names=self.bandit_settings.var_names,
                var_ids=self.bandit_settings.var_ids,
                current_weights=leaf_weights,
                reweight=self.bandit_settings.reweight,
                decision_metric=self.bandit_settings.decision_metric,
                bandit_weights_seed=self.bandit_settings.bandit_weights_seed,
                bandit_weights_rng=self.bandit_settings.bandit_weights_rng,
                weight_by_period=self.bandit_settings.weight_by_period,
                top_two=self.bandit_settings.top_two,
            )
            r = get_bandit_result(
                rows=rows_for_bandit,
                metric=self.metric_settings,
                settings=self.analysis_settings,
                bandit_settings=bandit_settings,
            )
            new_weights = (
                r.updatedWeights
                if r.updatedWeights is not None
                else r.bestArmProbabilities
            )
            if new_weights is not None:
                self.bandit_settings.current_contextual_weights[key] = (
                    new_weights.copy()
                )
            result_by_leaf[leaf_id] = r
        # Map context -> BanditResult (each context gets its leaf's result, or a no-update result if leaf had no data)
        context_to_result: dict[ContextKey, BanditResult] = {}
        for ctx in self.contexts:
            leaf_id = self.leaf_map.get(ctx)
            if leaf_id is None:
                continue
            if leaf_id in result_by_leaf:
                context_to_result[ctx] = result_by_leaf[leaf_id]
            else:
                weights = self.bandit_settings.current_contextual_weights.get(
                    str(leaf_id), self.initial_weights.copy()
                )
                context_to_result[ctx] = no_update_result(weights)

        return ContextualTreeBanditResponse(
            responses=cast(dict[ContextKey, BanditResult], context_to_result),
            leaf_map=copy.copy(self.leaf_map),
        )
