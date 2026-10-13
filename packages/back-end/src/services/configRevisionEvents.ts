import { configPublishEnvironments } from "shared/util";
import { Revision, JsonPatchOperation } from "shared/enterprise";
import { ConfigInterface } from "shared/types/config";
import {
  ResourceEvents,
  NotificationEventPayloadSchemaType,
} from "shared/types/events/base-types";
import { revisionEventRouting } from "back-end/src/services/revisionEventRouting";
import {
  revisionReference,
  webhookActor,
} from "back-end/src/events/revisionReference";
import { Context } from "back-end/src/models/BaseModel";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
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
    const reference = {
      ...(await revisionReference(context, revision)),
      config: {
        id: revision.target.id,
        key: revision.target.snapshot.key,
        name: revision.target.snapshot.name,
      },
    };
    const liveForRouting = await context.models.configs.getById(
      revision.target.id,
    );
    // Configs scope by the ENTITY, and `scopedConfig` is read-only in the snapshot
    // (never in `getUpdatableFields`) — so the flavor's scope can only move on the
    // LIVE entity, and each side has to be resolved on its own.
    const { projects, environments } = await revisionEventRouting({
      context,
      revision,
      liveForRouting,
      scopedFor: (entity) =>
        configPublishEnvironments(entity as ConfigInterface),
    });

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
        environments,
        containsSecrets: false,
      });
    };

    switch (action.type) {
      case "created":
        await emit("revision.created", reference);
        break;
      case "updated":
        await emit("revision.updated", {
          ...reference,
          change:
            action.change === "metadata" ||
            action.change === "schema" ||
            action.change === "archive"
              ? action.change
              : deriveChange(revision.target.proposedChanges),
        });
        break;
      case "reviewRequested":
        await emit("revision.reviewRequested", reference);
        break;
      case "reviewed": {
        const reviewer = webhookActor(context.auditUser);
        if (action.decision === "approve") {
          await emit("revision.approved", {
            ...reference,
            reviewer,
            reviewComment: action.comment ?? null,
          });
        } else if (action.decision === "request-changes") {
          await emit("revision.changesRequested", {
            ...reference,
            reviewer,
            reviewComment: action.comment ?? null,
          });
        } else {
          if (!action.comment) break;
          await emit("revision.commented", {
            ...reference,
            reviewer,
            reviewComment: action.comment,
          });
        }
        break;
      }
      case "rebased":
        await emit("revision.rebased", reference);
        break;
      case "published":
        await emit("revision.published", {
          ...reference,
          ...bulkPublishFields(context),
        });
        break;
      case "publishFailed":
        await emit("revision.publishFailed", {
          ...reference,
          ...bulkPublishFields(context),
          failureReason: action.reason,
          terminal: action.terminal,
          attempts: action.attempts,
        });
        break;
      case "discarded":
        await emit("revision.discarded", reference);
        break;
      case "reopened":
        await emit("revision.reopened", reference);
        break;
      case "recalled":
        await emit("revision.recalled", reference);
        break;
      case "reviewRetracted":
        await emit("revision.reviewRetracted", reference);
        break;
      case "publishScheduleChanged":
        await emit("revision.publishScheduleChanged", reference);
        break;
      case "reverted": {
        const source = revision.revertedFrom
          ? await context.models.revisions
              .getById(revision.revertedFrom)
              .catch(() => null)
          : null;
        await emit("revision.reverted", {
          ...reference,
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
