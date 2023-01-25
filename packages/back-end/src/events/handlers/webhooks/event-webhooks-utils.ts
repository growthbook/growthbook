import { createHmac } from "crypto";
import { OrganizationInterface } from "../../../../types/organization";
import { getApiFeatureObj, getSavedGroupMap } from "../../../services/features";
import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
  NotificationEvent,
} from "../../base-events";
import {
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "../../base-types";
import { ApiFeatureInterface } from "../../../../types/api";

export type EventWebHookSuccessResult = {
  result: "success";
  responseBody: string;
  statusCode: number;
};

export type EventWebHookErrorResult = {
  result: "error";
  statusCode: number | null;
  error: string;
};

export type EventWebHookResult =
  | EventWebHookErrorResult
  | EventWebHookSuccessResult;

// region Web hook signing

/**
 * Given a signing key and a JSON serializable payload, serializes the payload and returns a web hook signature.
 * @param signingKey
 * @param payload
 */
export const getEventWebHookSignatureForPayload = <T>({
  signingKey,
  payload,
}: {
  signingKey: string;
  payload: T;
}): string => {
  const requestPayload = JSON.stringify(payload);

  return createHmac("sha256", signingKey).update(requestPayload).digest("hex");
};

// endregion Web hook signing

// region Web hook Payload creation

type BasePayloadCreatorOptions = {
  organization: OrganizationInterface;
};

export const getPayloadForNotificationEvent = async ({
  event,
  organization,
}: BasePayloadCreatorOptions & {
  event: NotificationEvent;
}): Promise<NotificationEventPayload<
  NotificationEventName,
  NotificationEventResource,
  unknown
> | null> => {
  switch (event.event) {
    case "experiment.created":
    case "experiment.updated":
    case "experiment.deleted":
      // TODO: We need to shape this data. BLOCKED on ApiExperimentInterface being ready
      return event;

    case "feature.created":
      return await getPayloadForFeatureCreated({
        event,
        organization,
      });

    case "feature.updated":
      return await getPayloadForFeatureUpdated({
        event,
        organization,
      });

    case "feature.deleted":
      return await getPayloadForFeatureDeleted({
        event,
        organization,
      });
  }
};

// region Feature

const getPayloadForFeatureCreated = async ({
  event,
  organization,
}: BasePayloadCreatorOptions & {
  event: FeatureCreatedNotificationEvent;
}): Promise<
  NotificationEventPayload<
    "feature.created",
    "feature",
    { feature: ApiFeatureInterface }
  >
> => {
  const savedGroupMap = await getSavedGroupMap(organization);

  return {
    ...event,
    data: {
      ...event.data,
      feature: getApiFeatureObj(
        event.data.current,
        organization,
        savedGroupMap
      ),
    },
  };
};

const getPayloadForFeatureUpdated = async ({
  event,
  organization,
}: BasePayloadCreatorOptions & {
  event: FeatureUpdatedNotificationEvent;
}): Promise<
  NotificationEventPayload<
    "feature.updated",
    "feature",
    { current: ApiFeatureInterface; previous: ApiFeatureInterface }
  >
> => {
  const savedGroupMap = await getSavedGroupMap(organization);

  return {
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

const getPayloadForFeatureDeleted = async ({
  event,
  organization,
}: BasePayloadCreatorOptions & {
  event: FeatureDeletedNotificationEvent;
}): Promise<
  NotificationEventPayload<
    "feature.deleted",
    "feature",
    { previous: ApiFeatureInterface }
  >
> => {
  const savedGroupMap = await getSavedGroupMap(organization);

  return {
    ...event,
    data: {
      ...event.data,
      previous: getApiFeatureObj(
        event.data.previous,
        organization,
        savedGroupMap
      ),
    },
  };
};

// endregion Feature

// endregion Web hook Payload creation
