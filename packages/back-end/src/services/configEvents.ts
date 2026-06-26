import { ApiConfig } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { createEvent } from "back-end/src/models/EventModel";
import { logger } from "back-end/src/util/logger";

// Config lifecycle webhook events. Emitted from ConfigModel's
// afterCreate/afterUpdate/afterDelete hooks so they fire from every write path
// (internal controllers, public REST API, and revision-publish via the
// adapter's applyChanges). Fire-and-forget — failures are logged and swallowed.

export async function logConfigCreatedEvent(
  context: ReqContext | ApiReqContext,
  config: ApiConfig,
): Promise<void> {
  try {
    await createEvent({
      context,
      object: "config",
      objectId: config.id,
      event: "created",
      data: { object: config },
      projects: config.project ? [config.project] : [],
      tags: [],
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, "Error dispatching config.created event");
  }
}

export async function logConfigUpdatedEvent(
  context: ReqContext | ApiReqContext,
  previous: ApiConfig,
  current: ApiConfig,
): Promise<void> {
  try {
    await createEvent({
      context,
      object: "config",
      objectId: current.id,
      event: "updated",
      data: { object: current, previous_object: previous },
      projects: Array.from(
        new Set(
          [previous.project, current.project].filter((p): p is string => !!p),
        ),
      ),
      tags: [],
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, "Error dispatching config.updated event");
  }
}

export async function logConfigDeletedEvent(
  context: ReqContext | ApiReqContext,
  config: ApiConfig,
): Promise<void> {
  try {
    await createEvent({
      context,
      object: "config",
      objectId: config.id,
      event: "deleted",
      data: { object: config },
      projects: config.project ? [config.project] : [],
      tags: [],
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, "Error dispatching config.deleted event");
  }
}
