import { createHmac } from "crypto";
import fetch from "node-fetch";
import { logger } from "../../../util/logger";
import { EventWebHookInterface } from "../../../../types/event-webhook";
import { OrganizationInterface } from "../../../../types/organization";
import { getApiFeatureObj, GroupMap } from "../../../services/features";
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

// export type EventWebHookSuccessResult = {
//   result: "success";
//   statusCode: number;
// };
//
// export type EventWebHookErrorResult = {
//   result: "error";
//   statusCode: number | null;
//   error: string;
// };
//
// export type EventWebHookResult =
//   | EventWebHookErrorResult
//   | EventWebHookSuccessResult;

// type PostWebHookOptions<DataType> = {
//   eventWebHook: EventWebHookInterface;
//   payload: DataType;
// };

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
//
// const performEventWebHookNotification = async <DataType>({
//   payload,
//   eventWebHook,
// }: PostWebHookOptions<DataType>): Promise<
//   EventWebHookSuccessResult | EventWebHookErrorResult
// > => {
//   // TODO: Enqueue everything below in Agenda
//
//   const { signingKey, url } = eventWebHook;
//
//   const requestPayload = JSON.stringify(payload);
//
//   const signature = createHmac("sha256", signingKey)
//     .update(requestPayload)
//     .digest("hex");
//
//   // try {
//   //   const res = await fetch(url, {
//   //     headers: {
//   //       "Content-Type": "application/json",
//   //       "X-GrowthBook-Signature": signature,
//   //     },
//   //     method: "POST",
//   //     body: requestPayload,
//   //   });
//   //
//   //   if (!res.ok) {
//   //     // TODO: Log run with error result
//   //     // TODO: Update webhook with latest error status
//   //     // TODO: Retry logic
//   //
//   //     return {
//   //       result: "error",
//   //       statusCode: res.status,
//   //       error: res.statusText,
//   //     };
//   //   }
//   //
//   //   // TODO: Log run with success result
//   //   // TODO: Update webhook with latest success status
//   //
//   //   return {
//   //     result: "success",
//   //     statusCode: res.status,
//   //   };
//   // } catch (e) {
//   //   logger.error("postWebHook", e);
//   //
//   //   return {
//   //     result: "error",
//   //     statusCode: null,
//   //     error: "Unknown Error",
//   //   };
//   // }
// };
//
// // const handleWebHookSuccess = async (
// //   successResult: EventWebHookSuccessResult,
// //   eventWebHook: EventWebHookInterface
// // ) => {};
// //
// // const handleWebHookError = async (
// //   errorResult: EventWebHookErrorResult,
// //   eventWebHook: EventWebHookInterface
// // ) => {};

type BasePayloadCreatorOptions = {
  organization: OrganizationInterface;
  savedGroupMap: GroupMap;
};

export const getPayloadForNotificationEvent = ({
  event,
  organization,
  savedGroupMap,
}: BasePayloadCreatorOptions & {
  event: NotificationEvent;
}): NotificationEventPayload<
  NotificationEventName,
  NotificationEventResource,
  unknown
> => {
  switch (event.event) {
    case "feature.created":
      return getPayloadForFeatureCreated({
        event,
        organization,
        savedGroupMap,
      });
    case "feature.updated":
      return getPayloadForFeatureUpdated({
        event,
        organization,
        savedGroupMap,
      });
    case "feature.deleted":
      return getPayloadForFeatureDeleted({
        event,
        organization,
        savedGroupMap,
      });
  }
};

const getPayloadForFeatureCreated = ({
  event,
  organization,
  savedGroupMap,
}: BasePayloadCreatorOptions & {
  event: FeatureCreatedNotificationEvent;
}): NotificationEventPayload<
  "feature.created",
  "feature",
  { feature: ApiFeatureInterface }
> => ({
  ...event,
  data: {
    ...event.data,
    feature: getApiFeatureObj(event.data, organization, savedGroupMap),
  },
});

const getPayloadForFeatureUpdated = ({
  event,
  organization,
  savedGroupMap,
}: BasePayloadCreatorOptions & {
  event: FeatureUpdatedNotificationEvent;
}): NotificationEventPayload<
  "feature.updated",
  "feature",
  { current: ApiFeatureInterface; previous: ApiFeatureInterface }
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

const getPayloadForFeatureDeleted = ({
  event,
  organization,
  savedGroupMap,
}: BasePayloadCreatorOptions & {
  event: FeatureDeletedNotificationEvent;
}): NotificationEventPayload<
  "feature.deleted",
  "feature",
  { previous: ApiFeatureInterface }
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

export type EventWebHookSuccessResult = {
  result: "success";
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
