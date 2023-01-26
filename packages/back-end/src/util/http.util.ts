import fetch, { RequestInfo, RequestInit, Response } from "node-fetch";
import { logger } from "./logger";

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
