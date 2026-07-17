import { ApiConstant } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { createEvent } from "back-end/src/models/EventModel";
import { logger } from "back-end/src/util/logger";

// Constant lifecycle webhook events. Emitted from ConstantModel's
// afterCreate/afterUpdate/afterDelete hooks so they fire from every write path
// (internal controllers, public REST API, and revision-publish via the
// adapter's applyChanges). Fire-and-forget — failures are logged and swallowed
// so they never break the underlying write.

export async function logConstantCreatedEvent(
  context: ReqContext | ApiReqContext,
  constant: ApiConstant,
): Promise<void> {
  try {
    await createEvent({
      context,
      object: "constant",
      objectId: constant.id,
      event: "created",
      data: { object: constant },
      projects: constant.project ? [constant.project] : [],
      tags: [],
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, "Error dispatching constant.created event");
  }
}

export async function logConstantUpdatedEvent(
  context: ReqContext | ApiReqContext,
  previous: ApiConstant,
  current: ApiConstant,
): Promise<void> {
  try {
    await createEvent({
      context,
      object: "constant",
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
    logger.error(e, "Error dispatching constant.updated event");
  }
}

export async function logConstantDeletedEvent(
  context: ReqContext | ApiReqContext,
  constant: ApiConstant,
): Promise<void> {
  try {
    await createEvent({
      context,
      object: "constant",
      objectId: constant.id,
      event: "deleted",
      data: { object: constant },
      projects: constant.project ? [constant.project] : [],
      tags: [],
      environments: [],
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, "Error dispatching constant.deleted event");
  }
}
