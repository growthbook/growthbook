import fetch, { RequestInit, Response } from "node-fetch";
import { ProxyAgent } from "proxy-agent";
import { initializeSdk } from "../services/gb-cloud-sdk/middleware";
import { logger } from "./logger";
import {
  IS_CLOUD,
  PROXY_HOST_INTERNAL,
  PROXY_HOST_PUBLIC,
  USE_PROXY,
  WEBHOOK_PROXY,
} from "./secrets";

export type CancellableFetchCriteria = {
  maxContentSize: number;
  maxTimeMs: number;
};

export type CancellableFetchReturn = {
  // When consuming the stream, we lose the response.
  responseWithoutBody: Response;
  stringBody: string;
};

export function getHttpOptions(url?: string, useWebhookProxy = false) {
  // if there is a ?proxy argument in the url, use that as the proxy
  if (url) {
    // parse the url and extract the proxy argument
    const urlObj = new URL(url);
    const proxy = urlObj.searchParams.get("proxy_test");
    if (proxy) {
      return {
        agent: new ProxyAgent({
          getProxyForUrl: () => proxy,
        }),
      };
    }
  }

  // Don't send sdk_proxy calls that we know are safe from env vars, through the webhook proxy
  // Otherwise the proxy wont get the update of the feature flag to disable the webhook proxy
  const is_call_to_sdk_proxy =
    (PROXY_HOST_PUBLIC && url?.startsWith(PROXY_HOST_PUBLIC)) ||
    (PROXY_HOST_INTERNAL && url?.startsWith(PROXY_HOST_INTERNAL)) ||
    url?.startsWith("https://proxy.growthbook.io");

  if (useWebhookProxy && WEBHOOK_PROXY && !is_call_to_sdk_proxy) {
    logger.debug("Using webhook proxy");
    return {
      agent: new ProxyAgent({
        getProxyForUrl: () => WEBHOOK_PROXY,
      }),
    };
  } else if (WEBHOOK_PROXY) {
    logger.debug("not using webhook proxy");
  }

  if (USE_PROXY) {
    return { agent: new ProxyAgent() };
  }
  return {};
}

export const cancellableFetch = async (
  url: string,
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

  // We don't initialize the sdk anywhere else for AgendaJobs so we need to do it here
  const gb = await initializeSdk();
  // This feature is only dependent upon whether it is on cloud.
  gb.setAttributes({ cloud: IS_CLOUD });
  const useWebhookProxy = gb.isOn("use-webhook-proxy");
  gb.destroy();

  try {
    response = await fetch(url, {
      signal: abortController.signal,
      ...getHttpOptions(url, useWebhookProxy),
      ...fetchOptions,
    });

    stringBody = await readResponseBody(response);
    logger.debug("Got respnse :" + response.status);
    return {
      responseWithoutBody: response,
      stringBody,
    };
  } catch (e) {
    if (e.name === "AbortError" && response) {
      logger.warn(e, `Response aborted due to content size: ${received}`);

      return {
        responseWithoutBody: response,
        stringBody,
      };
    }

    // If we are using the webhook proxy then any ECONNREFUSED error would come from the proxy itself.
    // If the endpoint would have been down but the proxy was up, we would have gotten a 502 from the proxy instead.
    // Hence if we see one we can be sure the webhook proxy is having issues and it is best to disable it.
    if (
      useWebhookProxy &&
      WEBHOOK_PROXY &&
      process.env.GROWTHBOOK_API_KEY &&
      e.name === "FetchError" &&
      e.code === "ECONNREFUSED"
    ) {
      logger.error("Disabling webhook proxy");

      try {
        const results = await fetch(
          (process.env.GROWTHBOOK_API_HOST || "https://api.growthbook.io") +
            "/api/v1/features/use-webhook-proxy/toggle",
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + (process.env.GROWTHBOOK_API_KEY || ""),
            },
            method: "POST",
            body: JSON.stringify({
              reason:
                "Automatic disable webhook proxy do to a refused connection.",
              environments: { production: false },
            }),
          }
        );
        if (results.status === 200) {
          logger.debug("Disabled webhook proxy successfully");
        } else {
          logger.error(
            "Disabling webhook proxy failed: " +
              results.status +
              " " +
              (await results.text())
          );
        }
      } catch (e) {
        logger.error(e, "Failed to automatically disable webhook proxy");
      }
    }

    throw e;
  } finally {
    clearTimeout(timeout);
  }
};
