import { createHmac } from "crypto";
import { EventWebHookInterface } from "back-end/src/validators/event-webhook";

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

export const getEventWebHookAdditionalHeaders = (
  eventWebHook: EventWebHookInterface
): Record<string, string> => {
  if (eventWebHook.payloadType === "datadog") {
    if (!eventWebHook.apiKey) {
      throw new Error("API Key is required for Datadog webhooks");
    }

    return { "DD-API-KEY": eventWebHook.apiKey };
  }

  return {};
};

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
