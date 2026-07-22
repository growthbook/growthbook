import { Revision, JsonPatchOperation } from "shared/enterprise";
import { ConfigInterface } from "shared/types/config";
import {
  ResourceEvents,
  NotificationEventPayloadSchemaType,
} from "shared/types/events/base-types";
import { Context } from "back-end/src/models/BaseModel";
import { ApiReqContext } from "back-end/types/api";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { toApiConfigRevision } from "back-end/src/api/configs/toApiConfigRevision";
import type { RevisionLifecycleAction } from "back-end/src/events/revisionWebhookAdapters";
import { bulkPublishFields } from "back-end/src/events/bulkPublishCorrelation";
import { logger } from "back-end/src/util/logger";

type ConfigRevisionEvent = Extract<
  ResourceEvents<"config">,
  `revision.${string}`
>;

// Map a revision's proposed-changes patch ops to the `change` discriminator on
// the `revision.updated` event. Configs add "schema" on top of the constant set.
export function deriveChange(
  proposedChanges: JsonPatchOperation[],
): "metadata" | "value" | "schema" | "archive" {
  const paths = proposedChanges.map((op) => op.path);
  if (paths.some((p) => p.startsWith("/archived"))) return "archive";
  if (paths.some((p) => p.startsWith("/schema"))) return "schema";
  // Lineage changes (re-parent / mixin edits) change the resolved value.
  if (
    paths.some(
      (p) =>
        p.startsWith("/value") ||
        p.startsWith("/parent") ||
        p.startsWith("/extends"),
    )
  ) {
    return "value";
  }
  return "metadata";
}

// Dispatch a `config.revision.*` webhook event for a revision lifecycle
// transition. Called from the config REST handlers and (via the
// revisionWebhookAdapters registry) the generic /revision controller. Self-
// guards on target type so it's a no-op for non-config revisions.
// Fire-and-forget.
export async function dispatchConfigRevisionEvent(
  context: Context,
  revision: Revision,
  action: RevisionLifecycleAction,
): Promise<void> {
  if (revision.target.type !== "config") return;
  try {
    const apiRevision = await toApiConfigRevision(
      revision,
      context as ApiReqContext,
    );
    const snapshot = revision.target.snapshot as ConfigInterface;
    const projects = snapshot.project ? [snapshot.project] : [];

    const emit = async <T extends ConfigRevisionEvent>(
      event: T,
      object: NotificationEventPayloadSchemaType<"config", T>,
    ): Promise<void> => {
      await createEvent<"config", T>({
        context,
        object: "config",
        objectId: revision.target.id,
        event,
        data: { object } as CreateEventData<"config", T>,
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
            action.change === "metadata" ||
            action.change === "schema" ||
            action.change === "archive"
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
    logger.error(e, "Error dispatching config revision event");
  }
}
