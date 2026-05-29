import type {
  Revision,
  ReviewDecision,
  RevisionTargetType,
} from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";

// Leaf module: imports only TYPES, so it can be imported from RevisionModel
// without dragging in the event-dispatch graph (EventModel -> EventNotifier ->
// handlers -> context -> RevisionModel), which would create an init-time cycle.
//
// RevisionModel calls the registered hook after each state change; an entity
// type's event service registers its handler at startup via
// `registerRevisionLifecycleHook`. This keeps RevisionModel as the single
// convergence point for both the internal and public API surfaces while
// avoiding both a static import cycle and any runtime `import()`.

/**
 * Entity-agnostic description of a revision lifecycle transition. Carries any
 * data the model method has on hand that the hook would otherwise re-derive
 * (e.g. the review decision).
 */
export type RevisionLifecycleAction =
  | { type: "created" }
  | { type: "updated" }
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
  | { type: "reverted" };

export type RevisionLifecycleHook = (
  context: Context,
  revision: Revision,
  action: RevisionLifecycleAction,
) => Promise<void>;

const hooks = new Map<RevisionTargetType, RevisionLifecycleHook>();

/** Register the lifecycle hook for an entity type (called once at startup). */
export function registerRevisionLifecycleHook(
  type: RevisionTargetType,
  hook: RevisionLifecycleHook,
): void {
  hooks.set(type, hook);
}

/** Look up the lifecycle hook for an entity type, if one is registered. */
export function getRevisionLifecycleHook(
  type: RevisionTargetType,
): RevisionLifecycleHook | undefined {
  return hooks.get(type);
}
