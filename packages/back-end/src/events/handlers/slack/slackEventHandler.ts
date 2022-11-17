import {
  NotificationEventName,
  NotificationEventPayload,
} from "../../base-types";
import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../../base-events";
import { FeatureUpdatedNotificationHandler } from "../../notifiers/FeatureUpdatedNotifier";

/**
 * handle Slack events. Can be handled individually or with a common handler, depending on needs.
 * @param payload
 */
export const slackEventHandler = async (
  payload: NotificationEventPayload<NotificationEventName, unknown, unknown>
) => {
  switch (payload.event) {
    case "feature.created":
      return handleFeatureCreated(
        (payload as unknown) as FeatureCreatedNotificationEvent
      );
    case "feature.updated":
      return handleFeatureUpdated(
        (payload as unknown) as FeatureUpdatedNotificationEvent
      );
    case "feature.deleted":
      return handleFeatureDeleted(
        (payload as unknown) as FeatureDeletedNotificationEvent
      );
  }
};

const handleFeatureCreated = async (event: FeatureCreatedNotificationEvent) => {
  console.log("slackEventHandler -> handleFeatureCreated", event);
};

const handleFeatureUpdated: FeatureUpdatedNotificationHandler = async (
  event
) => {
  console.log("slackEventHandler -> handleFeatureUpdated", event);
};

const handleFeatureDeleted = async (event: FeatureDeletedNotificationEvent) => {
  console.log("slackEventHandler -> handleFeatureDeleted", event);
};
