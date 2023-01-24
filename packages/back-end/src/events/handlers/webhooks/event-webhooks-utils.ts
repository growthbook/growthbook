import { createHmac } from "crypto";
import fetch, { RequestInfo, RequestInit, Response } from "node-fetch";
import { OrganizationInterface } from "../../../../types/organization";
import { getApiFeatureObj } from "../../../services/features";
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
import { logger } from "../../../util/logger";
import { GroupMap } from "../../../../types/saved-group";

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
> | null => {
  switch (event.event) {
    case "experiment.created":
    case "experiment.updated":
    case "experiment.deleted":
      // TODO: https://linear.app/growthbook/issue/GB-18
      return null;

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
    feature: getApiFeatureObj(event.data.current, organization, savedGroupMap),
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

// endregion Web hook Payload creation

// region HTTP

export type CancellableFetchCriteria = {
  maxContentSize: number;
  maxTimeMs: number;
};

export type CancellableFetchReturn = {
  // When consuming the stream, we lose the response.
  responseWithoutBody: Response;
  stringBody: string;
};

/**
 * Performs a request with the optionally provided {@link AbortController}.
 * Aborts the request if any of the limits in the abortOptions are exceeded.
 * @param url
 * @param fetchOptions
 * @param abortOptions
 */
export const cancellableFetch = async (
  url: RequestInfo,
  fetchOptions: RequestInit,
  abortOptions: CancellableFetchCriteria
): Promise<CancellableFetchReturn> => {
  const abortController: AbortController = new AbortController();

  const chunks: string[] = [];

  const timeout = setTimeout(() => {
    abortController.abort();
  }, abortOptions.maxTimeMs);

  let received = 0; // for monitoring progress

  const readResponseBody = async (res: Response): Promise<string> => {
    for await (const chunk of res.body) {
      received += chunk.length;
      chunks.push(chunk.toString());

      if (received > abortOptions.maxContentSize) {
        abortController.abort();
        break;
      }
    }

    return chunks.join("");
  };

  let response: Response | null = null;
  let stringBody = "";

  try {
    response = await fetch(url, {
      signal: abortController.signal,
      ...fetchOptions,
    });

    stringBody = await readResponseBody(response);
    return {
      responseWithoutBody: response,
      stringBody,
    };
  } catch (e) {
    logger.error(e, "cancellableFetch -> readResponseBody");

    if (e.name === "AbortError" && response) {
      logger.warn(e, `Response aborted due to content size: ${received}`);

      return {
        responseWithoutBody: response,
        stringBody,
      };
    }

    throw e;
  } finally {
    clearTimeout(timeout);
  }
};

// endregion HTTP
