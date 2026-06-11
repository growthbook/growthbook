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
import type { RevisionLifecycleAction } from "back-end/src/events/revisionWebhookAdapters";
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
 * transition. Called directly from the saved-group REST handlers and the
 * generic /revision controller after they persist each state change (the same
 * call-site pattern features use with dispatchFeatureRevisionEvent), so it
 * fires for both the front-end and the public REST API. Failures are logged and
 * swallowed — events are fire-and-forget and must never break the write.
 *
 * Self-guards on target type so the generic /revision controller can call it
 * unconditionally for any entity (no-op for non-saved-group revisions).
 */
export async function dispatchSavedGroupRevisionEvent(
  context: Context,
  revision: Revision,
  action: RevisionLifecycleAction,
): Promise<void> {
  if (revision.target.type !== "saved-group") return;
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
          // Field-specific handlers pass the exact change; the generic
          // /revision controller omits it, so derive from the proposed changes.
          change:
            action.change ?? deriveChange(revision.target.proposedChanges),
        });
        break;
      case "reviewRequested":
        await emit("revision.reviewRequested", apiRevision);
        break;
      case "reviewed": {
        // Resolve the reviewer's name/email (best-effort) so Slack/webhook
        // payloads aren't just an opaque id.
        const [user] = await context.getUsersByIds([action.userId]);
        const reviewer = {
          id: action.userId,
          ...(user?.name ? { name: user.name } : {}),
          ...(user?.email ? { email: user.email } : {}),
        };
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
      case "reverted": {
        // `revertedFrom` is the id of the revision being reverted to; surface
        // its version so subscribers know the target. Best-effort: a failed
        // lookup must not suppress the event, since the version is optional.
        const source = revision.revertedFrom
          ? await context.models.revisions
              .getById(revision.revertedFrom)
              .catch(() => null)
          : null;
        await emit("revision.reverted", {
          ...apiRevision,
          ...(source?.version != null
            ? { revertedToVersion: source.version }
            : {}),
        });
        break;
      }
    }
  } catch (e) {
    logger.error(e, "Error dispatching saved group revision event");
  }
}
