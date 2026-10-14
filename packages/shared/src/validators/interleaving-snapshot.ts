import { z } from "zod";
import { baseSchema } from "./base-model";
import {
  interleavingMetricConfigValidator,
  interleavingVariationValidator,
} from "./interleaving";
import { queryPointerValidator } from "./queries";

/**
 * Frozen, self-contained settings for a single interleaving snapshot run,
 * copied from the parent Interleaving and its Interleaving Query
 * (contextual-bandit-snapshot pattern: `.strict()` and feature-specific).
 */
export const interleavingSnapshotSettingsValidator = z
  .object({
    interleavingId: z.string(),
    trackingKey: z.string(),
    datasourceId: z.string(),
    interleavingQueryId: z.string(),
    query: z.string(),
    userIdType: z.string(),
    // Control first. `key` is matched against the exposure items' `variation`;
    // `name` is what results display.
    variations: z.tuple([
      interleavingVariationValidator.pick({ id: true, key: true, name: true }),
      interleavingVariationValidator.pick({ id: true, key: true, name: true }),
    ]),
    metrics: z.array(interleavingMetricConfigValidator),
    startDate: z.date(),
    endDate: z.date().nullable().optional(),
  })
  .strict();

export type InterleavingSnapshotSettings = z.infer<
  typeof interleavingSnapshotSettingsValidator
>;

export const interleavingSnapshotValidator = baseSchema
  .extend({
    interleavingId: z.string(),
    status: z.enum(["pending", "running", "success", "error"]),
    error: z.string().optional(),
    runStarted: z.date().nullable(),
    queries: z.array(queryPointerValidator),
    frozenSettings: interleavingSnapshotSettingsValidator.optional(),
    // results typed loosely for Mongo storage;
    // the runner produces and the front-end consumes the real type
    results: z.array(z.unknown()).optional(),
  })
  .strict();

export type InterleavingSnapshotInterface = z.infer<
  typeof interleavingSnapshotValidator
>;
