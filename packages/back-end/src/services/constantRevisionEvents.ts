import { Revision, JsonPatchOperation } from "shared/enterprise";
import { ConstantInterface } from "shared/types/constant";
import {
  ResourceEvents,
  NotificationEventPayloadSchemaType,
} from "shared/types/events/base-types";
import { Context } from "back-end/src/models/BaseModel";
import { ApiReqContext } from "back-end/types/api";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { toApiConstantRevision } from "back-end/src/api/constants/toApiConstantRevision";
import type { RevisionLifecycleAction } from "back-end/src/events/revisionWebhookAdapters";
import { bulkPublishFields } from "back-end/src/events/bulkPublishCorrelation";
import { logger } from "back-end/src/util/logger";

type ConstantRevisionEvent = Extract<
  ResourceEvents<"constant">,
  `revision.${string}`
>;

// Map a revision's proposed-changes patch ops to the `change` discriminator on
// the `revision.updated` event (value/environmentValues → "value").
export function deriveChange(
  proposedChanges: JsonPatchOperation[],
): "metadata" | "value" | "archive" {
  const paths = proposedChanges.map((op) => op.path);
  if (paths.some((p) => p.startsWith("/archived"))) return "archive";
  if (
    paths.some(
      (p) => p.startsWith("/value") || p.startsWith("/environmentValues"),
    )
  ) {
    return "value";
  }
  return "metadata";
}

// Dispatch a `constant.revision.*` webhook event for a revision lifecycle
// transition. Called from the constant REST handlers and (via the
// revisionWebhookAdapters registry) the generic /revision controller, so it
// fires for both the public API and the front-end. Self-guards on target type
// so it's a no-op for non-constant revisions. Fire-and-forget.
export async function dispatchConstantRevisionEvent(
  context: Context,
  revision: Revision,
  action: RevisionLifecycleAction,
): Promise<void> {
  if (revision.target.type !== "constant") return;
  try {
    const apiRevision = await toApiConstantRevision(
      revision,
      context as ApiReqContext,
    );
    const snapshot = revision.target.snapshot as ConstantInterface;
    const projects = snapshot.project ? [snapshot.project] : [];

    const emit = async <T extends ConstantRevisionEvent>(
      event: T,
      object: NotificationEventPayloadSchemaType<"constant", T>,
    ): Promise<void> => {
      await createEvent<"constant", T>({
        context,
        object: "constant",
        objectId: revision.target.id,
        event,
        data: { object } as CreateEventData<"constant", T>,
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
          change:
            action.change === "metadata" || action.change === "archive"
              ? action.change
              : deriveChange(revision.target.proposedChanges),
        });
        break;
      case "reviewRequested":
        await emit("revision.reviewRequested", apiRevision);
        break;
      case "reviewed": {
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
        await emit("revision.published", {
          ...apiRevision,
          ...bulkPublishFields(context),
        });
        break;
      case "publishFailed":
        await emit("revision.publishFailed", {
          ...apiRevision,
          ...bulkPublishFields(context),
          failureReason: action.reason,
          terminal: action.terminal,
          attempts: action.attempts,
        });
        break;
      case "discarded":
        await emit("revision.discarded", apiRevision);
        break;
      case "reopened":
        await emit("revision.reopened", apiRevision);
        break;
      case "reverted": {
        const source = revision.revertedFrom
          ? await context.models.revisions
              .getById(revision.revertedFrom)
              .catch(() => null)
          : null;
        await emit("revision.reverted", {
          ...apiRevision,
          ...bulkPublishFields(context),
          ...(source && source.version !== undefined
            ? { revertedToVersion: source.version }
            : {}),
        });
        break;
      }
    }
  } catch (e) {
    logger.error(e, "Error dispatching constant revision event");
  }
}
