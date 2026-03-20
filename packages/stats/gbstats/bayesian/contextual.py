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
from gbstats.gbstats import get_bandit_result, get_dimension_column_name, SUM_COLS
import numpy as np
import copy
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.tree import DecisionTreeRegressor

BANDIT_DIMENSION_COLUMN = "dimension"
BANDIT_DIMENSION_VALUE = "All"
# Synthetic column for contextual tree: leaf id from DecisionTreeRegressor.apply
LEAF_ID_COLUMN = "leaf_id"


def _zero_like_aggregate(sample: Any) -> Any:
    """Default for an empty variation group, matching the type of an observed value."""
    if isinstance(sample, np.ndarray):
        return np.array([0.0])
    if isinstance(sample, (bool, np.bool_)):
        return False
    if isinstance(sample, (int, np.integer)):
        return 0
    if isinstance(sample, (float, np.floating)):
        return 0.0
    return 0


def _sum_aggregate_field(values: list[Any]) -> Any:
    """Sum numeric or 0-d / 1-d array values; output type follows the first value."""
    if not values:
        return 0
    total = sum(float(np.asarray(x).flat[0]) for x in values)
    v0 = values[0]
    if isinstance(v0, np.ndarray):
        return np.array([total])
    if isinstance(v0, (bool, np.bool_)):
        return bool(round(total))
    if isinstance(v0, (int, np.integer)):
        return int(round(total))
    if isinstance(v0, (float, np.floating)):
        return float(total)
    return float(total)


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


def no_update_result(weights: list, update_message: str | None = None) -> BanditResult:
    """Build a BanditResult that leaves weights unchanged (no update)."""
    w = weights.copy()
    return BanditResult(
        singleVariationResults=None,
        currentWeights=w,
        updatedWeights=w,
        bestArmProbabilities=w,
        seed=0,
        updateMessage=update_message,
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

    @property
    def default_contextual_weights(self) -> dict[ContextKey, list[float]]:
        return {
            ctx: list(self.contextual_bandit_settings.current_contextual_weights[ctx])
            for ctx in self.contextual_bandit_settings.contexts
        }

    def default_responses(self, update_message: str) -> dict[ContextKey, BanditResult]:
        default_weights = self.default_contextual_weights.copy()
        return {
            ctx: no_update_result(default_weights[ctx], update_message)
            for ctx in self.contextual_bandit_settings.contexts
        }

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
            update_message = "no rows"
            responses = {
                ctx: no_update_result(
                    weights=self.contextual_bandit_settings.current_contextual_weights.get(
                        ctx
                    )
                    or default_weights,
                    update_message=update_message,
                )
                for ctx in context_keys
            }
            return ContextualBanditResponse(
                responses=cast(dict[ContextKey, BanditResult], responses)
            )

        elif not self.contextual_bandit_settings.contexts:
            context_keys = list(
                self.contextual_bandit_settings.current_contextual_weights
            ) or [BANDIT_DIMENSION_VALUE]
            update_message = "no context columns configured"
            responses = self.default_responses(update_message)
            return ContextualBanditResponse(
                responses=cast(dict[ContextKey, BanditResult], responses)
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
        bandit_settings: ContextualTreeBanditSettingsForStatsEngine,
    ) -> None:
        self.contexts = contexts
        self.num_variations = num_variations
        self.max_leaf_nodes = max_leaf_nodes
        self.rng = rng
        self.bandit_settings = bandit_settings
        self.leaf_map: dict[tuple[str, ...], int] = {}
        self.leaf_ids: list[int] = []
        self.fitted_tree: DecisionTreeRegressor | None = None
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

    @staticmethod
    def contextual_bandit_settings_for_tree(
        tree_settings: ContextualTreeBanditSettingsForStatsEngine,
    ) -> ContextualBanditSettingsForStatsEngine:
        """Copy bandit + contextual fields from tree settings into ContextualBanditSettingsForStatsEngine.

        Omits ``max_leaf_nodes``. Each key in ``current_contextual_weights`` is kept; weights are reset to
        uniform ``1 / num_variations`` per arm.
        """
        num_variations = len(tree_settings.var_ids or tree_settings.var_names or [])
        if num_variations == 0:
            raise ValueError(
                "Cannot derive num_variations: var_ids and var_names are both empty"
            )
        uniform = [1.0 / num_variations] * num_variations
        uniform_weights: dict[ContextKey, list[float]] = {
            k: uniform.copy() for k in tree_settings.current_contextual_weights
        }
        return ContextualBanditSettingsForStatsEngine(
            var_names=list(tree_settings.var_names),
            var_ids=list(tree_settings.var_ids),
            current_weights=list(tree_settings.current_weights),
            reweight=tree_settings.reweight,
            decision_metric=tree_settings.decision_metric,
            bandit_weights_seed=tree_settings.bandit_weights_seed,
            bandit_weights_rng=tree_settings.bandit_weights_rng,
            weight_by_period=tree_settings.weight_by_period,
            top_two=tree_settings.top_two,
            current_contextual_weights=uniform_weights,
            contexts=[LEAF_ID_COLUMN],
        )

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
        """Delegate tree fitting to :class:`BuildClassificationTree`."""
        builder = BuildClassificationTree(
            contexts=self.contexts,
            num_variations=self.num_variations,
            max_leaf_nodes=self.max_leaf_nodes,
            rng=self.rng,
            bandit_settings=self.bandit_settings,
        )
        builder.build(rows_by_context)
        self.set_leaf_structure(builder.leaf_map, builder.leaf_ids)
        self._last_fitted_tree = builder.fitted_tree
        self._last_tree_feature_names = builder.tree_feature_names

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
        self, rows: ExperimentMetricQueryResponseRows, leaf_id: int
    ) -> ExperimentMetricQueryResponseRows:
        """Merge all rows in a leaf (many contexts × variations) into one row per variation.

        Sums every field in SUM_COLS that appears on any input row. Sets LEAF_ID_COLUMN for
        UpdateWeightsContextualBandit (leaf as context).
        """
        if not rows:
            return []
        sum_cols_active = [c for c in SUM_COLS if any(c in r for r in rows)]
        by_var: dict[int, list[dict[str, Any]]] = {}
        for r in rows:
            v = int(r["variation"])
            by_var.setdefault(v, []).append(r)
        bandit_period = rows[0].get("bandit_period", 0)
        out: list[dict[str, Any]] = []
        for v in range(self.num_variations):
            grp = by_var.get(v, [])
            row: dict[str, Any] = {
                LEAF_ID_COLUMN: leaf_id,
                "dimension": BANDIT_DIMENSION_VALUE,
                "bandit_period": bandit_period,
                "variation": v,
            }
            for col in sum_cols_active:
                sample = next((r[col] for r in rows if col in r), None)
                if not grp:
                    row[col] = _zero_like_aggregate(sample) if sample is not None else 0
                    continue
                vals = [r[col] for r in grp if col in r]
                row[col] = (
                    _sum_aggregate_field(vals)
                    if vals
                    else (_zero_like_aggregate(sample) if sample is not None else 0)
                )
            out.append(row)
        return cast(ExperimentMetricQueryResponseRows, out)

    def compute_result(self) -> ContextualTreeBanditResponse:
        """Fit tree, aggregate rows per leaf with LEAF_ID_COLUMN, run **one** UpdateWeightsContextualBandit with contexts=[LEAF_ID_COLUMN], then map leaf-level results and weights onto each real context via leaf_map."""
        rows_by_context = self.rows_to_rows_by_context(self.rows)
        self.build_tree(rows_by_context)
        if not self.leaf_ids:
            w = self.initial_weights.copy()
            no_update = no_update_result(w)
            return ContextualTreeBanditResponse(
                responses={ctx: no_update for ctx in self.contexts},
                leaf_map=copy.copy(self.leaf_map),
            )
        by_leaf_cumulative = self._build_by_leaf_cumulative(rows_by_context)

        rows_all: ExperimentMetricQueryResponseRows = []
        leaf_weight_keys: dict[int, tuple[str, ...]] = {}
        current_leaf_cw: dict[ContextKey, list[float]] = {}
        for leaf_id in self.leaf_ids:
            rows_leaf = by_leaf_cumulative.get(leaf_id) or []
            if not rows_leaf:
                raise ValueError(f"No rows for leaf {leaf_id}")
            leaf_key = (str(leaf_id),)
            leaf_weight_keys[leaf_id] = leaf_key
            prior = self.bandit_settings.current_contextual_weights.get(str(leaf_id))
            if prior is None:
                prior = next(
                    (
                        self.bandit_settings.current_contextual_weights[c]
                        for c in self.contexts
                        if self.leaf_map.get(c) == leaf_id
                        and c in self.bandit_settings.current_contextual_weights
                    ),
                    None,
                )
            current_leaf_cw[leaf_key] = list(
                prior if prior is not None else self.initial_weights
            )
            rows_all.extend(
                self._aggregate_leaf_rows_for_bandit(rows_leaf, leaf_id=leaf_id)
            )

        leaf_bandit_settings = self.contextual_bandit_settings_for_tree(
            self.bandit_settings
        )
        leaf_bandit = UpdateWeightsContextualBandit(
            rows_all,
            self.metric_settings,
            self.analysis_settings,
            leaf_bandit_settings,
        )
        leaf_response = leaf_bandit.compute_result()

        context_to_result: dict[ContextKey, BanditResult] = {}
        for ctx in self.contexts:
            leaf_id = self.leaf_map.get(ctx)
            if leaf_id is None:
                continue
            lkey = leaf_weight_keys.get(leaf_id)
            if lkey is None:
                continue
            r = leaf_response.responses.get(lkey)
            if r is not None:
                context_to_result[ctx] = r
                new_w = (
                    r.updatedWeights
                    if r.updatedWeights is not None
                    else r.bestArmProbabilities
                )
                if new_w is not None:
                    wlist = new_w.copy()
                    self.bandit_settings.current_contextual_weights[ctx] = wlist
                    self.bandit_settings.current_contextual_weights[str(leaf_id)] = (
                        wlist
                    )
            else:
                w = leaf_bandit_settings.current_contextual_weights.get(
                    lkey, self.initial_weights
                )
                context_to_result[ctx] = no_update_result(list(w))

        return ContextualTreeBanditResponse(
            responses=cast(dict[ContextKey, BanditResult], context_to_result),
            leaf_map=copy.copy(self.leaf_map),
        )
