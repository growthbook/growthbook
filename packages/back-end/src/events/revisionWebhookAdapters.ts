import type {
  Revision,
  ReviewDecision,
  RevisionTargetType,
} from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";

// Webhook-event plugin layer for the generic revision system.
//
// This is a SEPARATE registry from revisions/index (the EntityRevisionAdapter
// registry). That one is loaded during model initialization (context ->
// RevisionModel -> revisions/index -> adapter), so its adapters can't import
// the event-dispatch pipeline without a circular-import (the pipeline imports
// back into the models). This registry instead lives at the handler layer —
// it's only imported by controllers/handlers, never during model init — so it
// can statically import each entity's event-dispatch service safely.
//
// To add webhook events for a new approval type, add one entry to `registry`
// below (plus its dispatch service + notificationEvents). The generic revision
// controller dispatches via `getRevisionWebhookAdapter` and never names a
// specific entity type.

/**
 * Entity-agnostic description of a revision lifecycle transition. Carries any
 * data the handler has on hand that the dispatcher would otherwise re-derive
 * (e.g. the review decision).
 */
export type RevisionLifecycleAction =
  | { type: "created" }
  // `change` is supplied by field-specific handlers (values/condition/metadata/
  // archive). The generic /revision controller omits it, in which case the
  // dispatcher derives it from the revision's proposed-changes.
  | {
      type: "updated";
      change?: "metadata" | "condition" | "values" | "archive";
    }
  | { type: "reviewRequested" }
  | {
      type: "reviewed";
      decision: ReviewDecision;
      userId: string;
      comment?: string;
    }
  | { type: "rebased" }
  | { type: "published" }
  | { type: "discarded" }
  | { type: "reopened" }
  // Fires whenever a revert lands on the live entity — both the direct-publish
  // path and an approval-gated draft that's later merged (the dispatcher
  // detects the latter via the revision's `revertedFrom`).
  | { type: "reverted" };

export interface RevisionWebhookAdapter {
  /**
   * Emit the entity's webhook/notification event for a revision lifecycle
   * transition. Must be fire-and-forget (swallow its own errors) so a failed
   * notification never breaks the revision write.
   */
  dispatch(
    context: Context,
    revision: Revision,
    action: RevisionLifecycleAction,
  ): Promise<void>;
}

// Plug in a new approval type's webhook events here.
const registry: Partial<Record<RevisionTargetType, RevisionWebhookAdapter>> = {
  "saved-group": { dispatch: dispatchSavedGroupRevisionEvent },
};

/** Return the webhook adapter for the given entity type, if one is registered. */
export function getRevisionWebhookAdapter(
  type: RevisionTargetType,
): RevisionWebhookAdapter | undefined {
  return registry[type];
}
