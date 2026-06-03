import { z } from "zod";
import { baseSchema } from "./base-model";

// Auto-slice variant of a base metric materialized in the same table. Each
// slice has its own slice-encoded metric id (`<baseId>?dim:col=value`) and its
// own warehouse columns (the slice query string is folded into the column name
// via `encodeMetricIdForColumnName`). The slice filter is applied at insert
// time, so a slice only contributes non-null values for rows matching it.
export const aggregatedFactTableSliceStateValidator = z.object({
  metricId: z.string(),
  columns: z.array(z.string()),
});

// Per-metric state for a materialized aggregated fact table. One entry per base
// fact metric whose values are materialized in the table. `settingsHash` lets
// the nightly job detect schema-breaking metric changes (which trigger a
// full-table restate); `columns` are the warehouse-safe column names this
// metric owns; `slices` records the auto-slice variants materialized alongside
// the base metric (added/removed slices are detectable by diffing this list).
export const aggregatedFactTableMetricStateValidator = z.object({
  metricId: z.string(),
  settingsHash: z.string(),
  columns: z.array(z.string()),
  slices: z.array(aggregatedFactTableSliceStateValidator).optional(),
  builtAt: z.date(),
});

const aggregatedFactTable = z
  .object({
    // Refs — one doc per (organization, datasourceId, factTableId, idType)
    datasourceId: z.string(),
    factTableId: z.string(),
    idType: z.string(),

    // Warehouse table this doc mirrors (null until first created)
    tableFullName: z.string().nullable(),

    // Event-time high-water mark. The next incremental run slices events with
    // `timestamp > lastMaxTimestamp` (append-only disjoint deltas).
    lastMaxTimestamp: z.date().nullable(),
    // Min event_date materialized — how far back coverage goes.
    firstEventDate: z.date().nullable(),
    // Max event_date materialized — freshness (read-path "too old" fallback).
    lastEventDate: z.date().nullable(),

    // Hash of the fact table definition (sql/eventName/userIdTypes/filters).
    // Stored to detect FT drift; only acted on via a forced restate.
    factTableSettingsHash: z.string().nullable(),

    // Per-metric materialization state.
    metricState: z.array(aggregatedFactTableMetricStateValidator),

    // Execution lock (mirrors IncrementalRefreshModel).
    currentExecutionId: z.string().nullable(),
    lockHeartbeatAt: z.date().nullable().optional(),
    lastError: z.string().nullable().optional(),

    // Most recent run document (AggregatedFactTableRun). Per-run state and the
    // tracked async queries live on the run docs, not here.
    lastRunId: z.string().nullable(),
  })
  .strict();

export const aggregatedFactTableValidator = baseSchema
  .extend(aggregatedFactTable.shape)
  .strict();

export type AggregatedFactTableInterface = z.infer<
  typeof aggregatedFactTableValidator
>;

export type AggregatedFactTableMetricStateInterface = z.infer<
  typeof aggregatedFactTableMetricStateValidator
>;

export type AggregatedFactTableSliceStateInterface = z.infer<
  typeof aggregatedFactTableSliceStateValidator
>;
