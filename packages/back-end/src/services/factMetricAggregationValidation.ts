import { getSelectedColumnDatatype } from "shared/experiments";
import {
  ColumnRef,
  FactMetricType,
  FactTableInterface,
} from "shared/types/fact-table";
import { getKllEventCountSourceColumn } from "back-end/src/services/factMetrics";

export function validateAggregationSpecification({
  column,
  factTable,
  metricType,
  quantileType,
  quantileIgnoreZeros,
  quantileEventCountColumn,
  errorPrefix,
}: {
  column: ColumnRef;
  factTable: FactTableInterface;
  metricType: FactMetricType;
  quantileType: "unit" | "event" | undefined;
  quantileIgnoreZeros: boolean | undefined;
  quantileEventCountColumn: string | undefined;
  errorPrefix: string;
}) {
  const datatype = getSelectedColumnDatatype({
    factTable,
    column: column.column,
  });
  if (column.aggregation === "count distinct" && datatype !== "string") {
    throw new Error(
      `${errorPrefix}Cannot use 'count distinct' aggregation with the special or numeric column '${column.column}'.`,
    );
  }
  if (
    (column.aggregation === "hll merge" ||
      column.aggregation === "kll merge") &&
    datatype !== "binary"
  ) {
    throw new Error(
      `${errorPrefix}Cannot use '${column.aggregation}' aggregation with the ${datatype || "unknown"} column '${column.column}'. The column must have a binary datatype (e.g. BigQuery BYTES).`,
    );
  }
  if (datatype === "string" && column.aggregation !== "count distinct") {
    throw new Error(
      `${errorPrefix}Must use 'count distinct' aggregation with string column '${column.column}'.`,
    );
  }
  if (
    datatype === "binary" &&
    column.aggregation !== "hll merge" &&
    column.aggregation !== "kll merge"
  ) {
    throw new Error(
      `${errorPrefix}Must use 'hll merge' or 'kll merge' aggregation with binary column '${column.column}'.`,
    );
  }
  // 'kll merge' is only meaningful in event-quantile metrics — the
  // back-end aggregation pipeline silently falls through to a SUM in
  // any other context (which would produce broken SQL on a binary
  // sketch column). Block it at the API boundary when we have enough
  // context to tell.
  if (
    column.aggregation === "kll merge" &&
    metricType !== undefined &&
    (metricType !== "quantile" || quantileType !== "event")
  ) {
    throw new Error(
      `${errorPrefix}'kll merge' aggregation is only valid for event-quantile metrics (metricType=quantile, quantileSettings.type=event).`,
    );
  }
  // Inverse of the guard above: an event-quantile metric on a binary
  // (sketch) column MUST use 'kll merge'. Other binary aggregations
  // (currently just 'hll merge') don't produce a quantile and would
  // otherwise fall through to APPROX_PERCENTILE over raw BYTES in
  // __eventQuantileMetric — the warehouse rejects this at runtime with
  // an opaque type error rather than a clear API-level message.
  if (
    metricType === "quantile" &&
    quantileType === "event" &&
    datatype === "binary" &&
    column.aggregation !== "kll merge"
  ) {
    throw new Error(
      `${errorPrefix}Event-quantile metrics on the binary column '${column.column}' must use 'kll merge' aggregation (got '${column.aggregation}').`,
    );
  }
  // `ignoreZeros` cannot be applied when re-aggregating pre-built KLL
  // sketches: the zero-filtering must happen in the upstream pipeline
  // that built the sketch (we can no longer see individual event
  // values). Reject explicit attempts to combine the two.
  if (column.aggregation === "kll merge" && quantileIgnoreZeros) {
    throw new Error(
      `${errorPrefix}'ignoreZeros' is not supported with 'kll merge' aggregation. Filter zero-valued events before building the KLL sketch in your source pipeline.`,
    );
  }
  // KLL sketches do not expose an internal "items inserted" count via any
  // current SQL engine. To recover per-user event counts (needed for the
  // cluster-aware variance estimator and the two-pass rank recovery in
  // kllRankApprox) we require the user to materialize a paired count column
  // of numeric datatype alongside the sketch column on the same fact table.
  // Default name: `<sketch>_n_events`. The metric author can override that
  // default via quantileSettings.quantileEventCountColumn — useful when their
  // upstream pipeline already emits a count under a different name.
  if (column.aggregation === "kll merge") {
    const expectedNEventsColumn = getKllEventCountSourceColumn({
      column,
      quantileEventCountColumn,
    });
    const overrideUsed =
      !!quantileEventCountColumn && quantileEventCountColumn.trim().length > 0;
    const pairedColumn = factTable.columns.find(
      (c) => c.column === expectedNEventsColumn && !c.deleted,
    );
    if (!pairedColumn) {
      throw new Error(
        overrideUsed
          ? `${errorPrefix}quantileSettings.quantileEventCountColumn references '${expectedNEventsColumn}', which does not exist on the fact table. Add it as a numeric column or remove the override.`
          : `${errorPrefix}'kll merge' on column '${column.column}' requires a paired event-count column named '${expectedNEventsColumn}' on the same fact table. Add it as a numeric column, or set quantileSettings.quantileEventCountColumn to point at an existing one.`,
      );
    }
    if (pairedColumn.datatype !== "number") {
      throw new Error(
        `${errorPrefix}Paired event-count column '${expectedNEventsColumn}' must have a numeric datatype (got '${pairedColumn.datatype || "unknown"}').`,
      );
    }
    if (pairedColumn.isVirtual) {
      throw new Error(
        `${errorPrefix}Paired event-count column '${expectedNEventsColumn}' cannot be a virtual column.`,
      );
    }
  } else if (
    quantileEventCountColumn !== undefined &&
    quantileEventCountColumn !== ""
  ) {
    // The override is only meaningful for 'kll merge'. Any other context (raw
    // event quantiles, unit quantiles, non-quantile metrics) computes
    // n_events from the row stream itself, so a custom source column has no
    // semantics. Reject explicit attempts to combine the two.
    throw new Error(
      `${errorPrefix}quantileSettings.quantileEventCountColumn is only valid when numerator.aggregation === 'kll merge'.`,
    );
  }
}
