import nodeFetch, { type RequestInit, type Response } from "node-fetch";
import { ProxyAgent } from "proxy-agent";
import { logger } from "./logger";
import { API_USER_AGENT, USE_PROXY, WEBHOOK_PROXY } from "./secrets";

export type CancellableFetchCriteria = {
  maxContentSize: number;
  maxTimeMs: number;
};

export type CancellableFetchReturn = {
  // When consuming the stream, we lose the response.
  responseWithoutBody: Response;
  stringBody: string;
};

export function fetch(url: string, init?: RequestInit) {
  return nodeFetch(url, {
    ...init,
    headers: { ...init?.headers, "User-Agent": API_USER_AGENT },
  });
}

export function getHttpOptions(
  getProxyForUrl: (url: string) => string = () => WEBHOOK_PROXY,
) {
  if (WEBHOOK_PROXY) {
    return { agent: new ProxyAgent({ getProxyForUrl }) };
  }
  if (USE_PROXY) {
    return { agent: new ProxyAgent() };
  }
  return {};
}

// Identity providers we configure ourselves, so SSO keeps working while the proxy restarts.
const AUTH_PROXY_BYPASS_DOMAINS = [
  "auth0.com",
  "login.microsoftonline.com",
  "login.windows.net",
  "sts.windows.net",
  "okta.com",
  "oktapreview.com",
  "okta-emea.com",
  "accounts.google.com",
  "googleapis.com",
  "api.vercel.com",
  "marketplace.vercel.com",
];

export function getAuthProxyForUrl(url: string) {
  const { hostname } = new URL(url);
  const bypass = AUTH_PROXY_BYPASS_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith("." + domain),
  );
  // Under a mandatory egress proxy (USE_PROXY) a direct connection would not get out anyway.
  return bypass && !USE_PROXY ? "" : WEBHOOK_PROXY;
}

export function getAuthHttpOptions() {
  return getHttpOptions(getAuthProxyForUrl);
}
export const cancellableFetch = async (
  url: string,
  fetchOptions: RequestInit,
  abortOptions: CancellableFetchCriteria,
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
      signal: abortController.signal as RequestInit["signal"],
      ...getHttpOptions(),
      ...fetchOptions,
    });

    stringBody = await readResponseBody(response);
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

    // An unreachable endpoint comes back as a 502 from the proxy, so ECONNREFUSED means the proxy itself is down.
    if (WEBHOOK_PROXY && e.name === "FetchError" && e.code === "ECONNREFUSED") {
      logger.error({ err: e }, "Webhook proxy connection refused");
    }

    throw e;
  } finally {
    clearTimeout(timeout);
  }
};
