import { Revision } from "shared/enterprise";
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
import { ApiReqContext } from "back-end/types/api";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { findSDKConnectionById } from "back-end/src/models/SdkConnectionModel";
import { toApiSdkConnectionRevision } from "back-end/src/api/sdk-connections/revisionShared";
import type { RevisionLifecycleAction } from "back-end/src/events/revisionWebhookAdapters";
import { bulkPublishFields } from "back-end/src/events/bulkPublishCorrelation";
import { logger } from "back-end/src/util/logger";

type SdkConnectionRevisionEvent = Extract<
  ResourceEvents<"sdkConnection">,
  `revision.${string}`
>;

// The `change` discriminator on the `revision.updated` event. Archiving rides
// inside the settings op, so it is read from the settings themselves.
function deriveChange(
  base: { archived?: boolean },
  proposed: { archived?: boolean },
  proposedChanges: { path: string }[],
): "settings" | "webhooks" | "archive" {
  if (!!base.archived !== !!proposed.archived) return "archive";
  const paths = proposedChanges.map((op) => op.path);
  if (paths.length > 0 && paths.every((p) => p.startsWith("/sdkWebhooks"))) {
    return "webhooks";
  }
  return "settings";
}

// Dispatch an `sdkConnection.revision.*` webhook event for a revision lifecycle
// transition. Called from the SDK Connection REST handlers and (via the
// revisionWebhookAdapters registry) the generic revision engine, so it fires
// for both the public API and the front-end. Self-guards on target type so
// it's a no-op for other revisions. Fire-and-forget.
export async function dispatchSdkConnectionRevisionEvent(
  context: Context,
  revision: Revision,
  action: RevisionLifecycleAction,
): Promise<void> {
  if (revision.target.type !== "sdk-connection") return;
  try {
    // Without `withHeaders`, so webhook headers are scrubbed from the
    // snapshots and the patch alike.
    const {
      baseSdkConnection,
      proposedSdkConnection,
      baseSdkWebhooks,
      proposedSdkWebhooks,
      proposedChanges,
      contributors,
      revertedFrom,
      reviews,
      resolution,
    } = await toApiSdkConnectionRevision(context as ApiReqContext, revision);
    const payload = {
      ...(await revisionReference(context, revision)),
      sdkConnection: {
        id: revision.target.id,
        name: baseSdkConnection.name,
      },
      baseSdkConnection,
      proposedSdkConnection,
      baseSdkWebhooks,
      proposedSdkWebhooks,
      proposedChanges,
      contributors,
      revertedFrom,
      reviews,
      resolution,
    };
    const liveForRouting = await findSDKConnectionById(
      context,
      revision.target.id,
    );
    // A connection serves one environment, so the event reaches the one it
    // came from, the one it proposes, and the one it serves now.
    const changedEnvironments = [
      ...new Set([
        baseSdkConnection.environment,
        proposedSdkConnection.environment,
        ...(liveForRouting ? [liveForRouting.environment] : []),
      ]),
    ];
    const routing = await revisionEventRouting({
      context,
      revision,
      liveForRouting,
      scopedFor: () => changedEnvironments,
    });
    // The snapshot keeps its Projects under `sdkConnection`, where the shared
    // routing doesn't look.
    const projects = [
      ...new Set([...baseSdkConnection.projects, ...routing.projects]),
    ];
    const { environments } = routing;

    const emit = async <T extends SdkConnectionRevisionEvent>(
      event: T,
      object: NotificationEventPayloadSchemaType<"sdkConnection", T>,
    ): Promise<void> => {
      await createEvent<"sdkConnection", T>({
        context,
        object: "sdkConnection",
        objectId: revision.target.id,
        event,
        data: { object } as CreateEventData<"sdkConnection", T>,
        projects,
        tags: [],
        environments,
        containsSecrets: false,
      });
    };

    switch (action.type) {
      case "created":
        await emit("revision.created", payload);
        break;
      case "updated":
        // The cross-entity `change` union has no SDK Connection kinds.
        await emit("revision.updated", {
          ...payload,
          change: deriveChange(
            baseSdkConnection,
            proposedSdkConnection,
            proposedChanges,
          ),
        });
        break;
      case "reviewRequested":
        await emit("revision.reviewRequested", payload);
        break;
      case "reviewed": {
        const reviewer = webhookActor(context.auditUser);
        if (action.decision === "approve") {
          await emit("revision.approved", {
            ...payload,
            reviewer,
            reviewComment: action.comment ?? null,
          });
        } else if (action.decision === "request-changes") {
          await emit("revision.changesRequested", {
            ...payload,
            reviewer,
            reviewComment: action.comment ?? null,
          });
        } else {
          if (!action.comment) break;
          await emit("revision.commented", {
            ...payload,
            reviewer,
            reviewComment: action.comment,
          });
        }
        break;
      }
      case "rebased":
        await emit("revision.rebased", payload);
        break;
      case "published":
        await emit("revision.published", {
          ...payload,
          ...bulkPublishFields(context),
        });
        break;
      case "publishFailed":
        await emit("revision.publishFailed", {
          ...payload,
          ...bulkPublishFields(context),
          failureReason: action.reason,
          terminal: action.terminal,
          attempts: action.attempts,
        });
        break;
      case "discarded":
        await emit("revision.discarded", payload);
        break;
      case "reopened":
        await emit("revision.reopened", payload);
        break;
      case "recalled":
        await emit("revision.recalled", payload);
        break;
      case "reviewRetracted":
        await emit("revision.reviewRetracted", payload);
        break;
      case "publishScheduleChanged":
        await emit("revision.publishScheduleChanged", payload);
        break;
      case "reverted": {
        const source = revision.revertedFrom
          ? await context.models.revisions
              .getById(revision.revertedFrom)
              .catch(() => null)
          : null;
        await emit("revision.reverted", {
          ...payload,
          ...bulkPublishFields(context),
          ...(source && source.version !== undefined
            ? { revertedToVersion: source.version }
            : {}),
        });
        break;
      }
    }
  } catch (e) {
    logger.error(e, "Error dispatching SDK Connection revision event");
  }
}
