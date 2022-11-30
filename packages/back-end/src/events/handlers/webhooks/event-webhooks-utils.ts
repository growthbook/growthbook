import { createHmac } from "crypto";
import fetch from "node-fetch";
import { logger } from "../../../util/logger";
import { EventWebHookInterface } from "../../../../types/event-webhook";

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

type PostWebHookOptions<DataType> = {
  eventWebHook: EventWebHookInterface;
  payload: DataType;
};

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

export const performEventWebHookNotification = async <DataType>({
  payload,
  eventWebHook,
}: PostWebHookOptions<DataType>): Promise<
  EventWebHookSuccessResult | EventWebHookErrorResult
> => {
  // TODO: Enqueue everything below in Agenda

  const { signingKey, url } = eventWebHook;

  const requestPayload = JSON.stringify(payload);

  const signature = createHmac("sha256", signingKey)
    .update(requestPayload)
    .digest("hex");

  try {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-GrowthBook-Signature": signature,
      },
      method: "POST",
      body: requestPayload,
    });

    if (!res.ok) {
      // TODO: Log run with error result
      // TODO: Update webhook with latest error status
      // TODO: Retry logic

      return {
        result: "error",
        statusCode: res.status,
        error: res.statusText,
      };
    }

    // TODO: Log run with success result
    // TODO: Update webhook with latest success status

    return {
      result: "success",
      statusCode: res.status,
    };
  } catch (e) {
    logger.error("postWebHook", e);

    return {
      result: "error",
      statusCode: null,
      error: "Unknown Error",
    };
  }
};

const handleWebHookSuccess = async (
  successResult: EventWebHookSuccessResult,
  eventWebHook: EventWebHookInterface
) => {};

const handleWebHookError = async (
  errorResult: EventWebHookErrorResult,
  eventWebHook: EventWebHookInterface
) => {};
