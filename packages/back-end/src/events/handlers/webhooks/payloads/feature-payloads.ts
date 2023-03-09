import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../../../base-events";
import { NotificationEventPayload } from "../../../base-types";
import { ApiFeature } from "../../../../../types/openapi";
import { getApiFeatureObj } from "../../../../services/features";
import { BasePayloadCreatorOptions } from "./base-payloads";

export const getPayloadForFeatureCreated = ({
  event,
  organization,
  savedGroupMap,
}: BasePayloadCreatorOptions & {
  event: FeatureCreatedNotificationEvent;
}): NotificationEventPayload<
  "feature.created",
  "feature",
  { feature: ApiFeature }
> => ({
  ...event,
  data: {
    ...event.data,
    feature: getApiFeatureObj(event.data.current, organization, savedGroupMap),
  },
});

export const getPayloadForFeatureUpdated = ({
  event,
  organization,
  savedGroupMap,
}: BasePayloadCreatorOptions & {
  event: FeatureUpdatedNotificationEvent;
}): NotificationEventPayload<
  "feature.updated",
  "feature",
  { current: ApiFeature; previous: ApiFeature }
> => ({
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

export const getPayloadForFeatureDeleted = ({
  event,
  organization,
  savedGroupMap,
}: BasePayloadCreatorOptions & {
  event: FeatureDeletedNotificationEvent;
}): NotificationEventPayload<
  "feature.deleted",
  "feature",
  { previous: ApiFeature }
> => ({
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
