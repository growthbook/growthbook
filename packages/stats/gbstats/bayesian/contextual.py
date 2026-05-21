from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List
import pandas as pd

from gbstats.models.results import BanditResult
from gbstats.models.settings import (
    AnalysisSettingsForStatsEngine,
    ContextKey,
    ExperimentMetricQueryResponseRows,
    MetricSettingsForStatsEngine,
    BanditSettingsForStatsEngine,
    ContextualBanditSettingsForStatsEngine,
    ContextualTreeBanditSettingsForStatsEngine,
    VarIdMap,
)
from gbstats.gbstats import (
    get_bandit_result,
    get_var_id_map,
    ROW_COLS,
    SUM_COLS,
    variation_statistic_from_metric_row,
)
from gbstats.models.statistics import (
    SampleMeanStatistic,
    SummableStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
)
from gbstats.bayesian.bandits import (
    BanditConfig,
    BanditsRatio,
    BanditsCuped,
    BanditsSimple,
)
from gbstats.bayesian.tests import GaussianPrior

import numpy as np
import copy

BANDIT_DIMENSION_COLUMN = "dimension"
BANDIT_DIMENSION_VALUE = "All"
BANDIT_DEFAULT_CONTEXT_VALUE = "All"
# Synthetic column for contextual tree: leaf id from DecisionTreeRegressor.apply
LEAF_ID_COLUMN = "leaf_id"


@dataclass(frozen=True)
class RowsByContextWithData:
    """Context-keyed metric rows where every key has a non-empty row list, plus sorted keys.

    Context tuples (``unique_keys``) come from ``bandit_settings.attributes`` only. Use
    :meth:`from_experiment_rows` to partition from flat rows and rewrite each row's ``variation``
    to canonical ``var_ids`` strings. For partitions built another way, use
    :meth:`with_canonical_variation_ids`.

    Inbound ``variation`` cells must match ``bandit_settings.var_ids`` (after ``str(...)``),
    same as :func:`get_var_id_map`.
    """

    rows_with_data: dict[tuple[str, ...], ExperimentMetricQueryResponseRows]
    unique_keys: list[tuple[str, ...]]

    @classmethod
    def from_rows_by_context(
        cls,
        rows_by_context: dict[tuple[str, ...], ExperimentMetricQueryResponseRows],
    ) -> "RowsByContextWithData":
        """Drop empty context buckets and return a partition with sorted ``unique_keys``."""
        rows_with_data = {ctx: r for ctx, r in rows_by_context.items() if r}
        unique_keys = sorted(rows_with_data.keys())
        return cls(rows_with_data=rows_with_data, unique_keys=unique_keys)

    @classmethod
    def from_experiment_rows(
        cls,
        rows: ExperimentMetricQueryResponseRows,
        bandit_settings: ContextualBanditSettingsForStatsEngine,
    ) -> "RowsByContextWithData":
        """Partition ``rows`` by ``bandit_settings.attributes``."""
        if not rows:
            return cls(rows_with_data={}, unique_keys=[])
        context_columns = bandit_settings.attributes
        rows_by_context: dict[tuple[str, ...], ExperimentMetricQueryResponseRows] = {}
        for row in rows:
            ctx = tuple(str(row[column]) for column in context_columns)
            rows_by_context.setdefault(ctx, []).append(row)
        return cls.from_rows_by_context(rows_by_context)


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


class UpdateWeightsContextualBandit:
    """Updates variation weights per context. rows (ExperimentMetricQueryResponseRows) is an input; contexts are derived from analysis_settings.dimension. Call compute_result() to get per-context BanditResults (optionally pass rows to override, and current_weights_by_context for priors).

    **Variation encoding:** ``partition`` is built with :meth:`RowsByContextWithData.from_experiment_rows`,
    so each row's ``variation`` is normalized to the canonical ``var_ids`` string for that arm.
    """

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
        self.partition = RowsByContextWithData.from_experiment_rows(
            rows,
            contextual_bandit_settings,
        )

    @property
    def default_contextual_weights(self) -> dict[ContextKey, list[float]]:
        """Snapshot of ``current_contextual_weights`` for each key in the row partition."""
        return {
            context_key: list(
                self.contextual_bandit_settings.current_contextual_weights[context_key]
            )
            for context_key in self.partition.unique_keys
        }

    def default_responses(self, update_message: str) -> dict[ContextKey, BanditResult]:
        """Return a no-update :class:`BanditResult` for every context using current weights."""
        default_weights = self.default_contextual_weights.copy()
        return {
            context_key: no_update_result(default_weights[context_key], update_message)
            for context_key in self.partition.unique_keys
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
            update_message = "no rows"
            no_row_responses: dict[ContextKey, BanditResult] = {
                context_key: no_update_result(
                    weights=self.contextual_bandit_settings.current_contextual_weights.get(
                        context_key
                    )
                    or default_weights,
                    update_message=update_message,
                )
                for context_key in self.partition.unique_keys
            }
            return ContextualBanditResponse(responses=no_row_responses)

        else:
            # Unique contexts: one tuple per combination of (col0, col1, ...) across rows
            per_context_responses: dict[ContextKey, BanditResult] = {}

            for context_key in self.partition.unique_keys:
                if (
                    context_key
                    not in self.contextual_bandit_settings.current_contextual_weights
                ):
                    self.contextual_bandit_settings.current_contextual_weights[
                        context_key
                    ] = default_weights.copy()

                rows_for_bandit = [
                    {**d, BANDIT_DIMENSION_COLUMN: BANDIT_DIMENSION_VALUE}
                    for d in self.partition.rows_with_data[context_key]
                ]
                bandit_settings = BanditSettingsForStatsEngine(
                    var_names=self.contextual_bandit_settings.var_names,
                    var_ids=self.contextual_bandit_settings.var_ids,
                    current_weights=self.contextual_bandit_settings.current_contextual_weights.get(
                        context_key, default_weights
                    ),
                    reweight=self.contextual_bandit_settings.reweight,
                    decision_metric=self.contextual_bandit_settings.decision_metric,
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
                per_context_responses[context_key] = r

            return ContextualBanditResponse(responses=per_context_responses)


class UpdateWeightsContextualTree:
    """Fits a tree over contexts and updates variation weights per leaf via UpdateWeightsContextualBandit.

    Same constructor args as :class:`UpdateWeightsContextualBandit` except ``bandit_settings`` is
    :class:`ContextualTreeBanditSettingsForStatsEngine`. Subclass :class:`UpdateWeightsContextualTreePackage`
    swaps :meth:`build_tree` for a greedy SSE-based partition. Default :meth:`build_tree` fits
    :class:`BuildRegressionTree`.

    **Variation encoding:** ``partition`` comes from :meth:`RowsByContextWithData.from_experiment_rows`
    (``variation`` cells use ``var_ids``). Per-arm stats columns and synthesized leaf-bandit rows
    use the same ids.
    """

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
        self.var_id_map = get_var_id_map(list(self.bandit_settings.var_ids))
        self.partition = RowsByContextWithData.from_experiment_rows(
            rows,
            bandit_settings,
        )
        self.max_leaves = getattr(bandit_settings, "max_leaves")
        default_w = getattr(analysis_settings, "weights", None)
        self.num_variations = len(bandit_settings.var_ids)
        self.initial_weights = (
            list(default_w)
            if default_w is not None
            else [1.0 / self.num_variations] * self.num_variations
        )
        self.rng = bandit_settings.bandit_weights_rng
        self.leaf_ids = []
        self.leaf_map = {}
        self.merge_combined_rows = lambda a, b: (a or []) + (b or [])

    @staticmethod
    def _numeric_cell_for_metric_series(value: Any) -> Any:
        """Normalize a raw metric cell to a Python scalar (or float from a small ndarray)."""
        if isinstance(value, np.ndarray):
            return float(value.flat[0])
        if isinstance(value, (bool, np.bool_)):
            return bool(value)
        if isinstance(value, (int, np.integer)):
            return int(value)
        if isinstance(value, (float, np.floating)):
            return float(value)
        return value

    @staticmethod
    def _sum_aggregate_metric_field(values: List[Any]) -> Any:
        """Sum values in a metric column across rows, keeping type consistent with the first element."""
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

    @staticmethod
    def _merge_summable_experiment_metric_rows(
        rows: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Collapse multiple experiment-metric rows into one dict by summing SUM_COLS fields."""
        if not rows:
            return {}
        out: Dict[str, Any] = dict(rows[0])
        for col in SUM_COLS:
            vals = [r[col] for r in rows if col in r]
            if vals:
                out[col] = UpdateWeightsContextualTree._sum_aggregate_metric_field(vals)
            elif col not in out:
                out[col] = 0
        return out

    @staticmethod
    def _empty_prefixed_metric_series(prefix: str) -> pd.Series:
        """Return a prefixed metric series with zeros for every ROW_COLS slot used by gbstats."""
        return pd.Series({f"{prefix}_{col}": 0 for col in ROW_COLS})

    @staticmethod
    def _narrow_experiment_metric_row_to_prefixed_series(
        row: Dict[str, Any], prefix: str
    ) -> pd.Series:
        """Convert a narrow SQL-style metric row dict into a prefixed ``pd.Series`` for ``variation_statistic_from_metric_row``."""
        data: Dict[str, Any] = {f"{prefix}_{col}": 0 for col in ROW_COLS}
        for col in ROW_COLS:
            if col in row:
                data[f"{prefix}_{col}"] = (
                    UpdateWeightsContextualTree._numeric_cell_for_metric_series(
                        row[col]
                    )
                )
        if "users" in row:
            data[f"{prefix}_users"] = (
                UpdateWeightsContextualTree._numeric_cell_for_metric_series(
                    row["users"]
                )
            )
        if "count" in row:
            data[f"{prefix}_count"] = (
                UpdateWeightsContextualTree._numeric_cell_for_metric_series(
                    row["count"]
                )
            )
        elif "users" in row:
            data[f"{prefix}_count"] = data[f"{prefix}_users"]
        return pd.Series(data)

    @staticmethod
    def _summable_statistic_for_variation_row_group(
        metric_settings: MetricSettingsForStatsEngine,
        grp: List[Dict[str, Any]],
    ) -> SummableStatistic:
        """Produce one summable statistic for a list of rows that all belong to the same variation arm."""
        merged = (
            UpdateWeightsContextualTree._merge_summable_experiment_metric_rows(grp)
            if grp
            else None
        )
        series = (
            UpdateWeightsContextualTree._narrow_experiment_metric_row_to_prefixed_series(
                merged, "baseline"
            )
            if merged
            else UpdateWeightsContextualTree._empty_prefixed_metric_series("baseline")
        )
        raw_stat = variation_statistic_from_metric_row(
            series, "baseline", metric_settings
        )
        if not isinstance(raw_stat, SummableStatistic):
            raise TypeError(
                f"Expected SummableStatistic, got {type(raw_stat).__name__}"
            )
        return raw_stat

    @staticmethod
    def summable_statistics_per_variation_from_experiment_metric_rows(
        partition: RowsByContextWithData,
        metric_settings: MetricSettingsForStatsEngine,
        bandit_settings: ContextualTreeBanditSettingsForStatsEngine,
        var_id_map: VarIdMap,
    ) -> pd.DataFrame:
        """Build a DataFrame with context columns plus one merged summable statistic per ``var_id`` per context."""
        var_ids = list(var_id_map.keys())
        num_variations = len(var_ids)
        stat_columns = list(var_ids)
        context_columns = bandit_settings.attributes
        out_columns = list(context_columns) + stat_columns

        records: List[Dict[str, Any]] = []
        for ctx in partition.unique_keys:
            rows_ctx = partition.rows_with_data[ctx]
            record: Dict[str, Any] = {
                context_columns[i]: ctx[i] for i in range(len(context_columns))
            }
            for k in range(num_variations):
                grp = [
                    r for r in rows_ctx if var_id_map.get(str(r.get("variation"))) == k
                ]
                record[var_ids[k]] = (
                    UpdateWeightsContextualTree._summable_statistic_for_variation_row_group(
                        metric_settings, grp
                    )
                )
            records.append(record)
        return pd.DataFrame.from_records(records, columns=out_columns)

    @staticmethod
    def contextual_bandit_settings_for_tree(
        tree_settings: ContextualTreeBanditSettingsForStatsEngine,
    ) -> ContextualBanditSettingsForStatsEngine:
        """Copy bandit + contextual fields from tree settings into ContextualBanditSettingsForStatsEngine.

        Omits ``max_leaves``. Each key in ``current_contextual_weights`` is kept; weights are reset to
        uniform ``1 / num_variations`` per arm.
        """
        bandit_fields = {
            k: v
            for k, v in asdict(tree_settings).items()
            if k in ContextualBanditSettingsForStatsEngine.__dataclass_fields__
        }
        bandit_fields["attributes"] = ["leaf_id"]
        return ContextualBanditSettingsForStatsEngine(**bandit_fields)

    @property
    def contexts_by_leaf(self) -> dict:
        """Leaf id -> list of contexts in that leaf. Derived from leaf_map."""
        out: dict = {}
        for ctx, leaf_id in self.leaf_map.items():
            out.setdefault(leaf_id, []).append(ctx)
        return out

    def set_leaf_structure(self, leaf_map: dict):
        """Set leaf structure (called by build_tree)."""
        self.leaf_map = leaf_map
        self.leaf_ids = sorted(set(leaf_map.values()))

    def rows_to_rows_by_context(
        self, rows: ExperimentMetricQueryResponseRows
    ) -> dict[tuple, ExperimentMetricQueryResponseRows]:
        """Transform flat ExperimentMetricQueryResponseRows into the structure expected by build_tree: dict mapping context (tuple of targeting attribute values) -> list of rows.
        Uses bandit_settings.dimension for column names (arbitrary number of dimensions), falling back to analysis_settings.dimension for a single dimension.
        Example:
        rows = [
            {"country": "US", "browser": "Chrome", "variation": 0, "users": 100, "main_sum": 1000},
            {"country": "UK", "browser": "Firefox", "variation": 1, "users": 200, "main_sum": 2000},
            {"country": "DE", "browser": "Chrome", "variation": 0, "users": 150, "main_sum": 1500},
        ]
        rows_by_context = {
            ("US", "Chrome"): [
                {"country": "US", "browser": "Chrome", "variation": 0, "users": 100, "main_sum": 1000},
            ],
            ("UK", "Firefox"): [
                {"country": "UK", "browser": "Firefox", "variation": 1, "users": 200, "main_sum": 2000},
            ],
            ("DE", "Chrome"): [
                {"country": "DE", "browser": "Chrome", "variation": 0, "users": 150, "main_sum": 1500},
            ],
        }
        """
        if not rows:
            return {}
        out: dict[tuple, ExperimentMetricQueryResponseRows] = {}
        for row in rows:
            ctx = tuple(
                str(row.get(attribute, BANDIT_DIMENSION_VALUE))
                for attribute in self.bandit_settings.attributes
            )
            out.setdefault(ctx, []).append(row)
        return out

    @staticmethod
    def aggregate_variation_columns(
        df: pd.DataFrame, variation_columns: List[str]
    ) -> Dict[str, SummableStatistic]:
        """Pool each named variation column in ``df`` into summed statistics and variance values."""
        if df.empty:
            return {}
        summed: Dict[str, SummableStatistic] = {}
        for col in variation_columns:
            if col not in df.columns:
                raise KeyError(f"variation column {col!r} not in dataframe")
            stat = df[col].sum()
            summed[col] = stat
        return summed

    @staticmethod
    def ordered_variation_statistics(
        summed: Dict[str, SummableStatistic], variation_columns: List[str]
    ) -> list[SummableStatistic]:
        return list(summed[col] for col in variation_columns)

    @staticmethod
    def calculate_sse(d: Dict[str, SummableStatistic]) -> np.ndarray:
        """Calculate the sum of squared errors for a dictionary of summable statistics."""
        return np.array([(stat.n - 1) * stat.variance for stat in d.values()])

    @staticmethod
    def identify_update(
        stats_encoded: pd.DataFrame,
        dummy_feature_names: List[str],
        variation_columns: List[str],
        analysis_settings: AnalysisSettingsForStatsEngine,
        metric_settings: MetricSettingsForStatsEngine,
        rng: np.random.Generator,
    ) -> tuple[int, int]:
        """Given the current tree, which feature inside of which leaf most reduces SSE?

        ``variation_columns`` must match stat columns from ``summable_statistics_...``, i.e.
        ``bandit_settings.var_ids`` in canonical form.
        """
        num_features = len(dummy_feature_names)
        num_variations = len(variation_columns)
        num_leaves_current = len(np.unique(stats_encoded["current_leaf"]))
        sse_current = np.zeros((num_leaves_current, num_variations))
        sse_split = np.zeros((num_features, num_leaves_current, num_variations))

        for leaf_index in range(num_leaves_current):
            # use observations only from the current leaf
            this_leaf = stats_encoded[stats_encoded["current_leaf"] == leaf_index]
            # calculate SSE for the current leaf
            aggregated = UpdateWeightsContextualTree.aggregate_variation_columns(
                this_leaf, variation_columns
            )
            sse_current[leaf_index, :] = [
                (stat.n - 1) * stat.variance for stat in aggregated.values()
            ]
            for feature_index in range(num_features):
                # calculate SSE if the feature is split into 0 and 1
                stats_df_0 = this_leaf[
                    this_leaf[dummy_feature_names[feature_index]] == 0
                ]
                stats_df_1 = this_leaf[
                    this_leaf[dummy_feature_names[feature_index]] == 1
                ]
                if len(stats_df_0) == 0 or len(stats_df_1) == 0:
                    sse_split[feature_index, leaf_index, :] = sse_current[leaf_index, :]
                else:
                    b_0 = UpdateWeightsContextualTree.aggregate_variation_columns(
                        stats_df_0, variation_columns
                    )
                    b_1 = UpdateWeightsContextualTree.aggregate_variation_columns(
                        stats_df_1, variation_columns
                    )
                    sse_0 = np.array(
                        [(stat.n - 1) * stat.variance for stat in b_0.values()]
                    )
                    sse_1 = np.array(
                        [(stat.n - 1) * stat.variance for stat in b_1.values()]
                    )
                    sse_split[feature_index, leaf_index, :] = sse_0 + sse_1

        sse_current_across_variations = np.sum(sse_current, axis=1)
        sse_split_across_variations = np.sum(sse_split, axis=2)
        diff = (
            np.tile(sse_current_across_variations, (num_features, 1))
            - sse_split_across_variations
        )
        idx = np.argmax(diff)
        pos = np.unravel_index(idx, diff.shape)
        return (int(pos[0]), int(pos[1]))

    @staticmethod
    def create_stats_df(
        partition: RowsByContextWithData,
        metric_settings: MetricSettingsForStatsEngine,
        bandit_settings: ContextualTreeBanditSettingsForStatsEngine,
    ) -> pd.DataFrame:
        """Build a DataFrame with context columns plus one merged summable statistic per ``var_id`` per context."""
        stats_df = UpdateWeightsContextualTree.summable_statistics_per_variation_from_experiment_metric_rows(
            partition,
            metric_settings,
            bandit_settings,
            get_var_id_map(list(bandit_settings.var_ids)),
        )
        stats_df["key"] = list(
            zip(*(stats_df[c].astype(str) for c in bandit_settings.attributes))
        )
        return stats_df

    @staticmethod
    def create_stats_encoded(
        stats_df: pd.DataFrame,
        bandit_settings: ContextualTreeBanditSettingsForStatsEngine,
    ) -> pd.DataFrame:
        """One-hot encode contextual attribute columns, keeping variation statistic columns as-is."""
        stats_encoded = pd.get_dummies(
            stats_df,
            columns=bandit_settings.attributes,
            prefix=bandit_settings.attributes,  # or prefix="ctx" and let pandas suffix with level name
            dtype=float,  # 0/1 as float; use int if you prefer
        )
        return stats_encoded

    @staticmethod
    def calculate_sse_final(
        stats_encoded: pd.DataFrame, variation_columns: List[str]
    ) -> float:
        """Calculate the final SSE for the tree."""
        sse_final = 0
        for leaf_id in np.unique(stats_encoded["current_leaf"]):
            this_leaf = stats_encoded[stats_encoded["current_leaf"] == leaf_id]
            aggregated = UpdateWeightsContextualTree.aggregate_variation_columns(
                this_leaf, variation_columns
            )
            sse_final += sum(
                [(stat.n - 1) * stat.variance for stat in aggregated.values()]
            )
        return sse_final

    def _build_by_leaf_cumulative(self, rows_by_context: dict) -> dict:
        """Aggregate rows_by_context (context -> rows) into per-leaf rows by merging all contexts that map to the same leaf_id. Returns dict mapping leaf_id -> merged list of rows."""
        by_leaf_cumulative = {}
        for leaf_id in self.leaf_ids:
            rows_leaf = None
            for ctx in self.partition.unique_keys:
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
            v = self.var_id_map[str(r["variation"])]
            by_var.setdefault(v, []).append(r)
        bandit_period = rows[0].get("bandit_period", 0)
        var_ids_canon = [str(v) for v in list(self.bandit_settings.var_ids)]
        out: ExperimentMetricQueryResponseRows = []
        for v in range(self.num_variations):
            grp = by_var.get(v, [])
            row: dict[str, Any] = {
                LEAF_ID_COLUMN: leaf_id,
                "dimension": BANDIT_DIMENSION_VALUE,
                "bandit_period": bandit_period,
                "variation": var_ids_canon[v],
            }
            for col in sum_cols_active:
                if not grp:
                    row[col] = 0
                    continue
                vals = [r[col] for r in grp if col in r]
                row[col] = sum(vals)
            out.append(row)
        return out

    def build_tree(self):
        """Build context leaves by iterative ``identify_update`` splits on one-hot encoded attributes."""
        self.stats_df = self.create_stats_df(
            self.partition,
            self.metric_settings,
            self.bandit_settings,
        )
        # store one-hot-encoding of the contextual features
        self.stats_encoded = self.create_stats_encoded(
            self.stats_df, self.bandit_settings
        )

        # initialize the tree with all contexts in leaf 0
        self.stats_encoded["leaf_0"] = 0
        self.stats_encoded["current_leaf"] = copy.deepcopy(
            self.stats_encoded["leaf_0"].astype(int)
        )

        dummy_feature_names = [
            c for c in self.stats_encoded.columns if c not in self.stats_df.columns
        ]
        variation_columns = [str(v) for v in list(self.bandit_settings.var_ids)]

        for current_leaf in range(0, self.max_leaves - 1):
            feature_to_update, leaf_to_update = self.identify_update(
                self.stats_encoded,
                dummy_feature_names,
                variation_columns,
                self.analysis_settings,
                self.metric_settings,
                self.rng,
            )
            new_leaf = current_leaf + 1
            matches_update_leaf = self.stats_encoded["current_leaf"] == int(
                leaf_to_update
            )
            matches_update_features = (
                self.stats_encoded[dummy_feature_names[int(feature_to_update)]] == 1.0
            )
            mask = matches_update_leaf & matches_update_features
            self.stats_encoded.loc[mask, "current_leaf"] = int(new_leaf)
            # Snapshot column (must use df[col] = …, not df.loc[col] — loc[col] is row indexing).
            update_column = "leaf_" + str(new_leaf)
            self.stats_encoded[update_column] = self.stats_encoded[
                "current_leaf"
            ].copy()

        self.leaf_map = dict(
            zip(
                self.stats_encoded["key"],
                self.stats_encoded["current_leaf"].astype(int),
            )
        )
        self.set_leaf_structure(self.leaf_map)
        self.sse_final = self.calculate_sse_final(self.stats_encoded, variation_columns)

    def compute_result(self) -> ContextualTreeBanditResponse:
        """Fit tree, aggregate rows per leaf with LEAF_ID_COLUMN, run **one** UpdateWeightsContextualBandit with contexts=[LEAF_ID_COLUMN], then map leaf-level results and weights onto each real context via leaf_map."""
        self.build_tree()
        if not self.leaf_ids:
            w = self.initial_weights.copy()
            no_update = no_update_result(w)
            return ContextualTreeBanditResponse(
                responses={ctx: no_update for ctx in self.partition.unique_keys},
                leaf_map=copy.copy(self.leaf_map),
            )
        by_leaf_cumulative = self._build_by_leaf_cumulative(
            self.partition.rows_with_data
        )

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
                        for c in self.partition.unique_keys
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
        for ctx in self.partition.unique_keys:
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
            responses=context_to_result,
            leaf_map=copy.copy(self.leaf_map),
        )


class UpdateWeightsContextualTreeReward(UpdateWeightsContextualTree):
    @staticmethod
    def calculate_expected_reward(
        aggregated: Dict[str, SummableStatistic],
        variation_columns: List[str],
        rng: np.random.Generator,
        analysis_settings: AnalysisSettingsForStatsEngine,
        metric_settings: MetricSettingsForStatsEngine,
    ) -> float:
        """Calculate the expected reward for a given set of aggregated statistics."""
        num_variations = len(variation_columns)
        default_weights = np.full(num_variations, 1 / num_variations).tolist()
        bandit_config = BanditConfig(
            prior_distribution=GaussianPrior(mean=0, variance=float(1e4), proper=True),
            bandit_weights_rng=rng,
            weight_by_period=True,
            top_two=False,
            alpha=analysis_settings.alpha,
            inverse=metric_settings.inverse,
        )
        ordered_stats = UpdateWeightsContextualTree.ordered_variation_statistics(
            aggregated, variation_columns
        )
        if isinstance(ordered_stats, list) and all(
            isinstance(stat, RatioStatistic) for stat in ordered_stats
        ):
            bandit_instance = BanditsRatio(ordered_stats, default_weights, bandit_config)  # type: ignore
        elif ordered_stats and isinstance(
            ordered_stats[0], RegressionAdjustedStatistic
        ):
            bandit_instance = BanditsCuped(ordered_stats, default_weights, bandit_config)  # type: ignore
        elif isinstance(ordered_stats, list) and all(
            isinstance(stat, SampleMeanStatistic) for stat in ordered_stats
        ):
            bandit_instance = BanditsSimple(ordered_stats, default_weights, bandit_config)  # type: ignore
        else:
            raise ValueError(f"Invalid ordered statistics: {ordered_stats}")
        leaf_response = bandit_instance.compute_result()
        leaf_weights = np.asarray(
            leaf_response.bandit_weights
            if leaf_response.bandit_weights is not None
            else default_weights
        )
        leaf_means = np.asarray(
            leaf_response.cr
            if leaf_response.cr is not None
            else [stat.mean for stat in aggregated.values()]
        )
        # remove this later
        if leaf_response.bandit_weights is None:
            raise ValueError(f"Leaf response weights are None: {leaf_response}")
        cr = np.asarray(leaf_response.cr)
        diff = np.max(
            np.abs(cr - np.array([stat.mean for stat in aggregated.values()]))
        )
        if diff > 0.0001:
            raise ValueError(f"Leaf response means are not equal: {diff}")
        # remove above here later
        n = np.sum([stat.n for stat in ordered_stats])
        return float(n * np.sum(leaf_means * leaf_weights))

    @staticmethod
    def identify_update(
        stats_encoded: pd.DataFrame,
        dummy_feature_names: List[str],
        variation_columns: List[str],
        analysis_settings: AnalysisSettingsForStatsEngine,
        metric_settings: MetricSettingsForStatsEngine,
        rng: np.random.Generator,
    ) -> tuple[int, int]:
        """Given the current tree, which feature inside of which leaf most increases expected reward?

        ``variation_columns`` must match stat columns from ``summable_statistics_...``, i.e.
        ``bandit_settings.var_ids`` in canonical form.
        """
        num_features = len(dummy_feature_names)
        num_leaves_current = len(np.unique(stats_encoded["current_leaf"]))
        expected_reward_current = np.zeros((num_leaves_current))
        expected_reward_split = np.zeros((num_features, num_leaves_current))

        for leaf_index in range(num_leaves_current):
            # use observations only from the current leaf
            this_leaf = stats_encoded[stats_encoded["current_leaf"] == leaf_index]
            # calculate SSE for the current leaf
            aggregated = UpdateWeightsContextualTree.aggregate_variation_columns(
                this_leaf, variation_columns
            )
            expected_reward_current[leaf_index] = (
                UpdateWeightsContextualTreeReward.calculate_expected_reward(
                    aggregated,
                    variation_columns,
                    rng,
                    analysis_settings,
                    metric_settings,
                )
            )

            for feature_index in range(num_features):
                # calculate SSE if the feature is split into 0 and 1
                stats_df_0 = this_leaf[
                    this_leaf[dummy_feature_names[feature_index]] == 0
                ]
                stats_df_1 = this_leaf[
                    this_leaf[dummy_feature_names[feature_index]] == 1
                ]
                if len(stats_df_0) == 0 or len(stats_df_1) == 0:
                    expected_reward_split[feature_index, leaf_index] = (
                        expected_reward_current[leaf_index]
                    )
                else:
                    aggregated_0 = (
                        UpdateWeightsContextualTree.aggregate_variation_columns(
                            stats_df_0, variation_columns
                        )
                    )
                    aggregated_1 = (
                        UpdateWeightsContextualTree.aggregate_variation_columns(
                            stats_df_1, variation_columns
                        )
                    )
                    expected_reward_0 = (
                        UpdateWeightsContextualTreeReward.calculate_expected_reward(
                            aggregated_0,
                            variation_columns,
                            rng,
                            analysis_settings,
                            metric_settings,
                        )
                    )
                    expected_reward_1 = (
                        UpdateWeightsContextualTreeReward.calculate_expected_reward(
                            aggregated_1,
                            variation_columns,
                            rng,
                            analysis_settings,
                            metric_settings,
                        )
                    )
                    expected_reward_split[feature_index, leaf_index] = (
                        expected_reward_0 + expected_reward_1
                    )
        current_matrix = np.tile(expected_reward_current, (num_features, 1))
        diff = expected_reward_split - current_matrix

        # delete below me later
        dir_desktop = "/Users/lukesmith/Desktop/"
        pd.DataFrame(expected_reward_split).to_csv(
            dir_desktop + "expected_reward_split_" + str(num_leaves_current) + ".csv"
        )
        pd.DataFrame(expected_reward_current).to_csv(
            dir_desktop + "expected_reward_current_" + str(num_leaves_current) + ".csv"
        )
        # delete above me later

        idx = np.argmax(diff)
        pos = np.unravel_index(idx, diff.shape)
        return (int(pos[0]), int(pos[1]))
