import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { fetch } from "back-end/src/util/http.util";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { UnrecoverableApiError } from "back-end/src/util/errors";
import { resolveProxyUrl } from "back-end/src/routers/importing/importing.util";

// Allowed HTTP methods for proxy requests
const ALLOWED_HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
type AllowedHttpMethod = (typeof ALLOWED_HTTP_METHODS)[number];

function validateHttpMethod(method: string): AllowedHttpMethod {
  if (!ALLOWED_HTTP_METHODS.includes(method as AllowedHttpMethod)) {
    throw new UnrecoverableApiError(`Invalid HTTP method: ${method}.`);
  }
  return method as AllowedHttpMethod;
}

export const proxyStatsigRequest = async (
  req: AuthRequest<{
    endpoint: string;
    method?: string;
    apiKey: string;
    apiVersion?: string;
  }>,
  res: Response,
) => {
  // Block cloud users
  if (IS_CLOUD) {
    throw new UnrecoverableApiError(
      "Backend proxy is not available for cloud users",
    );
  }

  const {
    endpoint,
    apiKey,
    method = "GET",
    apiVersion = "20240601",
  } = req.body;

  if (!endpoint || !apiKey || !apiVersion) {
    return res.status(400).json({
      status: 400,
      message: "Missing required fields: endpoint and apiKey",
    });
  }

  // Validate HTTP method
  const validatedMethod = validateHttpMethod(method);

  // Resolve the URL before the try block so an invalid/origin-violating URL
  // surfaces as a 4xx (via the global error handler) rather than a 500.
  const url = resolveProxyUrl(endpoint, "https://statsigapi.net/console/v1/");

  try {
    const response = await fetch(url, {
      method: validatedMethod,
      headers: {
        "STATSIG-API-KEY": apiKey,
        "STATSIG-API-VERSION": apiVersion,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        status: response.status,
        message: `Statsig Console API error: ${response.statusText} - ${errorText}`,
      });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      status: 500,
      message: error.message || "Failed to fetch from Statsig API",
    });
  }
};

export const proxyLaunchDarklyRequest = async (
  req: AuthRequest<{
    url: string;
    apiToken: string;
  }>,
  res: Response,
) => {
  // Block cloud users
  if (IS_CLOUD) {
    throw new UnrecoverableApiError(
      "Backend proxy is not available for cloud users",
    );
  }

  const { url, apiToken } = req.body;

  if (!url || !apiToken) {
    return res.status(400).json({
      status: 400,
      message: "Missing required fields: url and apiToken",
    });
  }

  // Resolve the URL before the try block so an invalid/origin-violating URL
  // surfaces as a 4xx (via the global error handler) rather than a 500.
  const fullUrl = resolveProxyUrl(url, "https://app.launchdarkly.com");

  try {
    const response = await fetch(fullUrl, {
      headers: {
        Authorization: apiToken,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        status: response.status,
        message: `LaunchDarkly API error: ${response.statusText}`,
      });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      status: 500,
      message: error.message || "Failed to fetch from LaunchDarkly API",
    });
  }
};
