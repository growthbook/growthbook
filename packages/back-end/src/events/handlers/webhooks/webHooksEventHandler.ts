import { getAllEventWebHooksForEvent } from "../../../models/EventWebhookModel";
import { NotificationEventHandler } from "../../notifiers/EventNotifier";
import { getEvent } from "../../../models/EventModel";
import {
  getApiFeatureObj,
  getSavedGroupMap,
  GroupMap,
} from "../../../services/features";
import { findOrganizationById } from "../../../models/OrganizationModel";
import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../../base-events";
import { OrganizationInterface } from "../../../../types/organization";
import { EventWebHookInterface } from "../../../../types/event-webhook";
import { NotificationEventPayload } from "../../base-types";
import { ApiFeatureInterface } from "../../../../types/api";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler: NotificationEventHandler = async (
  eventId
) => {
  const event = await getEvent(eventId);
  if (!event) {
    // We should never get here
    throw new Error(
      "webHooksEventHandler -> ImplementationError: No event for provided ID"
    );
  }

  const organization = await findOrganizationById(event.organizationId);
  if (!organization) {
    throw new Error("webHooksEventHandler -> Invalid organization ID");
  }

  const savedGroupMap = await getSavedGroupMap(organization);

  const eventWebHooks = await getAllEventWebHooksForEvent(
    event.organizationId,
    event.data.event
  );

  console.log("relevant web hooks", eventWebHooks);

  switch (event.data.event) {
    case "feature.created":
      return handleWebHooksForFeatureCreated({
        organization,
        savedGroupMap,
        eventWebHooks,
        event: event.data,
      });
    case "feature.updated":
      return handleWebHooksForFeatureUpdated({
        organization,
        savedGroupMap,
        eventWebHooks,
        event: event.data,
      });
    case "feature.deleted":
      return handleWebHooksForFeatureDeleted({
        organization,
        savedGroupMap,
        eventWebHooks,
        event: event.data,
      });
  }
};

type BaseHandlerOptions = {
  organization: OrganizationInterface;
  savedGroupMap: GroupMap;
  eventWebHooks: EventWebHookInterface[];
};

const handleWebHooksForFeatureCreated = async ({
  event,
  organization,
  savedGroupMap,
}: BaseHandlerOptions & {
  event: FeatureCreatedNotificationEvent;
}): Promise<void> => {
  console.log("handleWebHooksForFeatureCreated");
};

const handleWebHooksForFeatureUpdated = async ({
  event,
  organization,
  savedGroupMap,
}: BaseHandlerOptions & {
  event: FeatureUpdatedNotificationEvent;
}): Promise<void> => {
  console.log("handleWebHooksForFeatureUpdated");

  const payload: NotificationEventPayload<
    "feature.updated",
    "feature",
    { current: ApiFeatureInterface; previous: ApiFeatureInterface }
  > = {
    ...event,
    data: {
      ...event.data,
      current: getApiFeatureObj(
        event.data.current,
        organization,
        savedGroupMap
      ),
      previous: getApiFeatureObj(
        event.data.previous,
        organization,
        savedGroupMap
      ),
    },
  };
};

const handleWebHooksForFeatureDeleted = async ({
  event,
  organization,
  savedGroupMap,
}: BaseHandlerOptions & {
  event: FeatureDeletedNotificationEvent;
}): Promise<void> => {
  console.log("handleWebHooksForFeatureDeleted");
};
