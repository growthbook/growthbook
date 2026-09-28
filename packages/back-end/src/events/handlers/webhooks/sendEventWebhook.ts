import {
  EventWebHookInterface,
  EventWebHookMethod,
} from "shared/types/event-webhook";
import { cancellableFetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import { SecretsReplacer } from "back-end/src/util/secrets";
import {
  EventWebHookResult,
  getEventWebHookSignatureForPayload,
} from "./event-webhooks-utils";

export async function sendEventWebhook<DataType>({
  payload,
  eventWebHook,
  method,
  applySecrets,
}: {
  payload: DataType;
  eventWebHook: EventWebHookInterface;
  method: EventWebHookMethod;
  applySecrets: SecretsReplacer;
}): Promise<EventWebHookResult> {
  const requestTimeout = 30000;
  const maxContentSize = 1000;

  try {
    const { url, signingKey, headers = {} } = eventWebHook;

    const signature = getEventWebHookSignatureForPayload({
      signingKey,
      payload,
    });

    const result = await cancellableFetch(
      applySecrets(url, { encode: encodeURIComponent }),
      {
        headers: {
          ...applySecrets(headers),
          "Content-Type": "application/json",
          "User-Agent": "GrowthBook Webhook",
          "X-GrowthBook-Signature": signature,
        },
        method,
        body: JSON.stringify(payload),
      },
      {
        maxTimeMs: requestTimeout,
        maxContentSize: maxContentSize,
      },
    );

    const { stringBody, responseWithoutBody } = result;

    if (!responseWithoutBody.ok) {
      // Server error
      return {
        result: "error",
        statusCode: responseWithoutBody.status,
        error: responseWithoutBody.statusText,
      };
    }

    return {
      result: "success",
      statusCode: responseWithoutBody.status,
      responseBody: stringBody,
    };
  } catch (e) {
    // Unknown error
    logger.error(e, "Unknown Error");

    return {
      result: "error",
      statusCode: null,
      error: e.message,
    };
  }
}
