import { ApiSavedGroup } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { createEvent } from "back-end/src/models/EventModel";
import { logger } from "back-end/src/util/logger";

// Saved-group lifecycle webhook events. Emitted from SavedGroupModel's
// afterCreate/afterUpdate/afterDelete hooks so they fire from every write path
// (internal controllers, public REST API, and revision-publish via the
// adapter's applyChanges). Failures are logged and swallowed — events are
// fire-and-forget and must never break the underlying write.

export async function logSavedGroupCreatedEvent(
  context: ReqContext | ApiReqContext,
  savedGroup: ApiSavedGroup,
): Promise<void> {
  try {
    await createEvent({
      context,
      object: "savedGroup",
      objectId: savedGroup.id,
      event: "created",
      data: { object: savedGroup },
      projects: savedGroup.projects ?? [],
      tags: [],
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, "Error dispatching savedGroup.created event");
  }
}

export async function logSavedGroupUpdatedEvent(
  context: ReqContext | ApiReqContext,
  previous: ApiSavedGroup,
  current: ApiSavedGroup,
): Promise<void> {
  try {
    await createEvent({
      context,
      object: "savedGroup",
      objectId: current.id,
      event: "updated",
      data: { object: current, previous_object: previous },
      projects: Array.from(
        new Set([...(previous.projects ?? []), ...(current.projects ?? [])]),
      ),
      tags: [],
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, "Error dispatching savedGroup.updated event");
  }
}

export async function logSavedGroupDeletedEvent(
  context: ReqContext | ApiReqContext,
  savedGroup: ApiSavedGroup,
): Promise<void> {
  try {
    await createEvent({
      context,
      object: "savedGroup",
      objectId: savedGroup.id,
      event: "deleted",
      data: { object: savedGroup },
      projects: savedGroup.projects ?? [],
      tags: [],
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, "Error dispatching savedGroup.deleted event");
  }
}
