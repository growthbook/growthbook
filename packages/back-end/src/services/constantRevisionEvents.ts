import {
  Revision,
  JsonPatchOperation,
  getConstantRevisionChange,
} from "shared/enterprise";
import { ConstantInterface } from "shared/types/constant";
import {
  ResourceEvents,
  NotificationEventPayloadSchemaType,
} from "shared/types/events/base-types";
import { constantPublishEnvironments } from "shared/util";
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
    const reference = {
      ...revisionReference(revision),
      constant: {
        id: revision.target.id,
        key: revision.target.snapshot.key,
        name: revision.target.snapshot.name,
      },
    };
    const snapshot = revision.target.snapshot as ConstantInterface;
    const liveForRouting = await context.models.constants.getById(
      revision.target.id,
    );
    // Constants scope by the CHANGE — a per-environment override names its
    // environments, a base-value change names none — so the same list answers for
    // both snapshot and live.
    const changedEnvironments = constantPublishEnvironments(
      getConstantRevisionChange(snapshot, revision.target.proposedChanges)
        .changedEnvironments,
    );
    const { projects, environments } = await revisionEventRouting({
      context,
      revision,
      liveForRouting,
      scopedFor: () => changedEnvironments,
    });

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
            action.change === "metadata" || action.change === "archive"
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
    logger.error(e, "Error dispatching constant revision event");
  }
}
