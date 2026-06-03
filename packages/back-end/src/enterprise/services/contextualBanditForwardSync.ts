import { ContextualBanditInterface, ExperimentInterface } from "shared/validators";

/**
 * Fields the CB→Experiment forward-sync copies when a CB is updated.
 *
 * Scope is intentionally narrow: only fields the still-experiment-keyed
 * snapshot/event pipeline reads off `experiment.*`. The set was sized
 * by grepping reads in `enterprise/services/contextualBandits.ts`
 * (lines 88-185, 367-393 at the time of writing). Cross-check before
 * widening; in particular, `phases` is intentionally NOT in the set —
 * CB and experiment phase shapes diverge (CB has
 * `currentLeafWeights`, experiment has `banditEvents` + `name`/`reason`)
 * and CB phase writes still flow through the experiment route this
 * session.
 *
 * TODO(pr-8): delete this helper and the `ContextualBanditModel.afterUpdate`
 * override that wraps it once snapshot/event indirection keys by CB id
 * instead of the parent experiment id.
 */
export const CB_TO_EXPERIMENT_SYNC_FIELDS = [
  "variations",
  // `status` flips drive the experiment-rule emitter; CB-side lifecycle
  // helpers (`executeContextualBanditStart`/`Stop`) already update the CB
  // status, so the forward-sync just mirrors it onto the experiment doc.
  "status",
  // Top-level `dateStarted` / `dateStopped` live only on the CB doc — the
  // experiment tracks dates inside its phase entries instead. Phases are
  // intentionally NOT synced (see comment above), so the corresponding
  // experiment-side date fields stay owned by the existing experiment
  // start/stop path.
  "trackingKey",
  "hashAttribute",
  "fallbackAttribute",
  "hashVersion",
  "goalMetrics",
  "secondaryMetrics",
  "guardrailMetrics",
  "metricOverrides",
  "datasource",
  "exposureQueryId",
  "segment",
  "queryFilter",
  "skipPartialData",
  "attributionModel",
  "regressionAdjustmentEnabled",
  "activationMetric",
  "name",
  "description",
  "hypothesis",
  "project",
  "owner",
  "tags",
  "archived",
  "customFields",
] as const satisfies readonly (keyof ContextualBanditInterface &
  keyof ExperimentInterface)[];

/**
 * Build the `changes` payload to pass to `updateExperiment` from the
 * fields that actually changed in a CB update. Only fields present in
 * the `updates` argument are copied — this keeps the forward-sync
 * idempotent (a no-op write doesn't churn the experiment doc) and
 * prevents accidentally overwriting experiment-only fields that the
 * CB doesn't carry.
 *
 * Pure function so it can be unit-tested in isolation; the model
 * `afterUpdate` hook is the only caller.
 */
export function buildExperimentSyncChanges(
  updates: Partial<ContextualBanditInterface>,
  newDoc: ContextualBanditInterface,
): Partial<ExperimentInterface> {
  const changes: Partial<ExperimentInterface> = {};
  for (const field of CB_TO_EXPERIMENT_SYNC_FIELDS) {
    if (field in updates) {
      // Cast through Record<string, unknown> because the two interfaces'
      // value types are structurally identical for the SYNC_FIELDS subset
      // but TypeScript can't prove the keyof intersection on a plain
      // index assignment — the `satisfies` clause on SYNC_FIELDS above
      // is what enforces field-by-field type compatibility at compile
      // time.
      (changes as Record<string, unknown>)[field] = newDoc[field];
    }
  }
  return changes;
}
