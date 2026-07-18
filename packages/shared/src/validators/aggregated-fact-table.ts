import { z } from "zod";
import { baseSchema } from "./base-model";

// Auto-slice variant of a base metric, with its own slice-encoded metric id
// (`<baseId>?dim:col=value`) and warehouse columns.
export const aggregatedFactTableSliceStateValidator = z.object({
  metricId: z.string(),
  columns: z.array(z.string()),
});

// Per-metric materialization state. `settingsHash` lets the nightly job detect
// schema-breaking metric changes (triggering a full-table restate).
export const aggregatedFactTableMetricStateValidator = z.object({
  metricId: z.string(),
  settingsHash: z.string(),
  columns: z.array(z.string()),
  slices: z.array(aggregatedFactTableSliceStateValidator).optional(),
  builtAt: z.date(),
});

const aggregatedFactTable = z
  .object({
    // One doc per (organization, datasourceId, factTableId, idType)
    datasourceId: z.string(),
    factTableId: z.string(),
    idType: z.string(),

    // Warehouse table this doc mirrors (null until first created)
    tableFullName: z.string().nullable(),

    // Event-time high-water mark. The next incremental run slices events with
    // `timestamp > lastMaxTimestamp` (append-only disjoint deltas).
    lastMaxTimestamp: z.date().nullable(),
    firstEventDate: z.date().nullable(),
    lastEventDate: z.date().nullable(),

    // Hash of the fact table definition; detects FT drift, acted on only via a forced restate.
    factTableSettingsHash: z.string().nullable(),

    metricState: z.array(aggregatedFactTableMetricStateValidator),

    // Execution lock (mirrors IncrementalRefreshModel).
    currentExecutionId: z.string().nullable(),
    lockHeartbeatAt: z.date().nullable().optional(),
    lastError: z.string().nullable().optional(),

    // In-flight write marker to force a restate if the insert succeeds
    // without advancing the watermark.
    inFlightExecutionId: z.string().nullable().optional(),

    // The fireTime (per-table daily updateTime occurrence) most recently claimed
    // by the poller. The idempotency gate so the frequent poller only enqueues a
    // given day's slot once.
    lastScheduledRunAt: z.date().nullable().optional(),

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
