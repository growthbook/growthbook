import { Revision, JsonPatchOperation } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  ResourceEvents,
  NotificationEventPayloadSchemaType,
} from "shared/types/events/base-types";
import { Context } from "back-end/src/models/BaseModel";
import { ApiReqContext } from "back-end/types/api";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { toApiSavedGroupRevision } from "back-end/src/api/saved-groups/toApiSavedGroupRevision";
import {
  RevisionLifecycleAction,
  registerRevisionLifecycleHook,
} from "back-end/src/revisions/revisionEventHooks";
import { logger } from "back-end/src/util/logger";

type SavedGroupRevisionEvent = Extract<
  ResourceEvents<"savedGroup">,
  `revision.${string}`
>;

// Map a revision's proposed-changes patch ops to the `change` discriminator on
// the `revision.updated` event. Both the front-end (generic /revision
// controller) and the public API funnel through `updateProposedChanges`, which
// carries the cumulative ops, so we report the most significant category
// touched rather than a per-edit delta.
export function deriveChange(
  proposedChanges: JsonPatchOperation[],
): "metadata" | "condition" | "values" | "archive" {
  const paths = proposedChanges.map((op) => op.path);
  if (paths.some((p) => p.startsWith("/condition"))) return "condition";
  if (paths.some((p) => p.startsWith("/values"))) return "values";
  if (paths.some((p) => p.startsWith("/archived"))) return "archive";
  return "metadata";
}

/**
 * Dispatch a `savedGroup.revision.*` webhook event for a revision lifecycle
 * transition. Invoked from the saved-group adapter's `onRevisionLifecycle`
 * hook, which RevisionModel calls after persisting each state change — so this
 * fires uniformly for both the front-end (generic revision controller) and the
 * public REST API. Failures are logged and swallowed.
 */
export async function dispatchSavedGroupRevisionEvent(
  context: Context,
  revision: Revision,
  action: RevisionLifecycleAction,
): Promise<void> {
  try {
    const apiRevision = await toApiSavedGroupRevision(
      revision,
      context as ApiReqContext,
    );
    const snapshot = revision.target.snapshot as SavedGroupInterface;
    const projects = snapshot.projects ?? [];

    const emit = async <T extends SavedGroupRevisionEvent>(
      event: T,
      object: NotificationEventPayloadSchemaType<"savedGroup", T>,
    ): Promise<void> => {
      await createEvent<"savedGroup", T>({
        context,
        object: "savedGroup",
        objectId: revision.target.id,
        event,
        data: { object } as CreateEventData<"savedGroup", T>,
        projects,
        tags: [],
        environments: [],
        containsSecrets: false,
      });
    };

    switch (action.type) {
      case "created":
        await emit("revision.created", apiRevision);
        break;
      case "updated":
        await emit("revision.updated", {
          ...apiRevision,
          change: deriveChange(revision.target.proposedChanges),
        });
        break;
      case "reviewRequested":
        await emit("revision.reviewRequested", apiRevision);
        break;
      case "reviewed": {
        const reviewer = { id: action.userId };
        if (action.decision === "approve") {
          await emit("revision.approved", {
            ...apiRevision,
            reviewer,
            reviewComment: action.comment ?? null,
          });
        } else if (action.decision === "request-changes") {
          await emit("revision.changesRequested", {
            ...apiRevision,
            reviewer,
            reviewComment: action.comment ?? null,
          });
        } else {
          // Empty comments are no-ops — don't emit an empty event.
          if (!action.comment) break;
          await emit("revision.commented", {
            ...apiRevision,
            reviewer,
            reviewComment: action.comment,
          });
        }
        break;
      }
      case "rebased":
        await emit("revision.rebased", apiRevision);
        break;
      case "published":
        await emit("revision.published", apiRevision);
        break;
      case "discarded":
        await emit("revision.discarded", apiRevision);
        break;
      case "reopened":
        await emit("revision.reopened", apiRevision);
        break;
      case "reverted":
        await emit("revision.reverted", apiRevision);
        break;
    }
  } catch (e) {
    logger.error(e, "Error dispatching saved group revision event");
  }
}

// Register the saved-group revision lifecycle hook so RevisionModel dispatches
// these events for both the internal and public API surfaces. This module is
// imported at startup (see app.ts) — outside the model-init graph — so the
// registration runs without creating an import cycle.
registerRevisionLifecycleHook("saved-group", dispatchSavedGroupRevisionEvent);
