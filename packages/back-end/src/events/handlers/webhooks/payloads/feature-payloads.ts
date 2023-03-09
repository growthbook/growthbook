import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../../../base-events";
import { NotificationEventPayload } from "../../../base-types";
import { ApiFeature } from "../../../../../types/openapi";
import { getApiFeatureObj } from "../../../../services/features";
import { PayloadCreator } from "./base-payloads";

export const getPayloadForFeatureCreated: PayloadCreator<
  FeatureCreatedNotificationEvent,
  NotificationEventPayload<
    "feature.created",
    "feature",
    { feature: ApiFeature }
  >
> = ({ event, organization, savedGroupMap }) => ({
  ...event,
  data: {
    ...event.data,
    feature: getApiFeatureObj(event.data.current, organization, savedGroupMap),
  },
});

export const getPayloadForFeatureUpdated: PayloadCreator<
  FeatureUpdatedNotificationEvent,
  NotificationEventPayload<
    "feature.updated",
    "feature",
    { current: ApiFeature; previous: ApiFeature }
  >
> = ({ event, organization, savedGroupMap }) => ({
  ...event,
  data: {
    ...event.data,
    current: getApiFeatureObj(event.data.current, organization, savedGroupMap),
    previous: getApiFeatureObj(
      event.data.previous,
      organization,
      savedGroupMap
    ),
  },
});

export const getPayloadForFeatureDeleted: PayloadCreator<
  FeatureDeletedNotificationEvent,
  NotificationEventPayload<
    "feature.deleted",
    "feature",
    { previous: ApiFeature }
  >
> = ({ event, organization, savedGroupMap }) => ({
  ...event,
  data: {
    ...event.data,
    previous: getApiFeatureObj(
      event.data.previous,
      organization,
      savedGroupMap
    ),
  },
});
