/**
 * Delegates managed ClickHouse operations to central-license-server
 * (see managed-clickhouse/* routes there).
 */
import type { AIPromptType } from "shared/ai";
import type { DailyUsage } from "shared/types/organization";
import { dailyUsageForOrgResponseValidator } from "shared/validators";
import type { RequestInit, Response } from "node-fetch";
import { LICENSE_SERVER_URL } from "back-end/src/enterprise/licenseUtil";
import { logger } from "back-end/src/util/logger";
import { fetch } from "back-end/src/util/http.util";
import { CLOUD_SECRET, IS_CLOUD } from "back-end/src/util/secrets";

const MAX_SENTRY_RESPONSE_BODY_LENGTH = 16_000;
/** Long cap so outbound requests cannot hang indefinitely (e.g. black-holed TCP). */
const MANAGED_CLICKHOUSE_FETCH_TIMEOUT_MS = 60 * 60 * 1000;

function errorDetailForLog(text: string, status: number): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return `HTTP ${status}`;
  }
  try {
    const j = JSON.parse(text) as {
      errorMessage?: string;
      error?: string;
      message?: string;
    };
    const candidate = j.errorMessage ?? j.error ?? j.message;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate.trim();
    }
  } catch {
    // use raw body below
  }
  return trimmed;
}

async function postManagedClickhouse(
  path: string,
  body: unknown,
  { allowStatuses = [] }: { allowStatuses?: number[] } = {},
): Promise<Response> {
  if (!CLOUD_SECRET) {
    throw new Error(
      "CLOUD_SECRET must be set to use license server managed ClickHouse",
    );
  }
  const base = LICENSE_SERVER_URL.endsWith("/")
    ? LICENSE_SERVER_URL
    : `${LICENSE_SERVER_URL}/`;
  const url = `${base}managed-clickhouse/${path}`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, MANAGED_CLICKHOUSE_FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLOUD_SECRET}`,
      },
      body: JSON.stringify(body),
      signal: abortController.signal as RequestInit["signal"],
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const timedOut = error.name === "AbortError";
    logger.error(
      {
        err: error,
        license_server_managed_clickhouse_path: path,
        license_server_managed_clickhouse_url: url,
        license_server_managed_clickhouse_timed_out: timedOut,
      },
      timedOut
        ? "License server managed ClickHouse request timed out before HTTP response"
        : "License server managed ClickHouse request failed before HTTP response",
    );
    throw new Error(
      timedOut
        ? "The managed warehouse service did not respond in time. Please try again in a few minutes. If the problem continues, contact support."
        : "We couldn't reach the managed warehouse service. Please try again in a few minutes. If the problem continues, contact support.",
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok && !allowStatuses.includes(res.status)) {
    const rawBody = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    const detail = errorDetailForLog(rawBody, res.status);
    const bodyForSentry =
      rawBody.length > MAX_SENTRY_RESPONSE_BODY_LENGTH
        ? `${rawBody.slice(0, MAX_SENTRY_RESPONSE_BODY_LENGTH)}\n…[truncated]`
        : rawBody;

    logger.error(
      {
        err: new Error(
          `managed-clickhouse/${path}: HTTP ${res.status} ${res.statusText || ""}`.trim(),
        ),
        license_server_managed_clickhouse_path: path,
        http_status: res.status,
        http_status_text: res.statusText,
        response_content_type: contentType,
        response_body: bodyForSentry,
        response_body_length: rawBody.length,
        license_server_error_detail: detail,
      },
      `License server managed ClickHouse HTTP error: ${path} (${res.status})`,
    );

    throw new Error(
      "The managed warehouse service returned an error. Please try again or contact support if this continues.",
    );
  }

  return res;
}

async function postManagedClickhouseJson<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const res = await postManagedClickhouse(path, body);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      "The managed warehouse service returned invalid JSON. Please try again or contact support if this continues.",
    );
  }
}

/**
 * Kick off an async table rebuild on the license server. The server acks (202)
 * and rebuilds in the background under a datasource lock, so this returns as soon
 * as the rebuild is accepted — not when it finishes. A 423 means a rebuild is
 * already running for this org, so the caller should wait rather than re-request.
 */
export async function dangerousRecreateClickhouseTables(
  orgId: string,
): Promise<"started" | "already-running"> {
  const res = await postManagedClickhouse(
    "recreate-tables",
    { orgId },
    { allowStatuses: [423] },
  );
  return res.status === 423 ? "already-running" : "started";
}

export async function deleteClickhouseUser(orgId: string): Promise<void> {
  await postManagedClickhouse("delete", { orgId });
}

export async function addCloudSDKMapping(
  key: string,
  organization: string,
): Promise<void> {
  await postManagedClickhouse("sdk-key-mapping", {
    key,
    organization,
  });
}

export async function migrateOverageEventsForOrgId(
  orgId: string,
): Promise<void> {
  await postManagedClickhouse("migrate-overage", { orgId });
}

export async function logCloudAIUsage({
  organization,
  type,
  model,
  temperature,
  numPromptTokensUsed,
  numCompletionTokensUsed,
  usedDefaultPrompt,
}: {
  organization: string;
  type: AIPromptType;
  model: string;
  numPromptTokensUsed?: number;
  numCompletionTokensUsed?: number;
  temperature?: number;
  usedDefaultPrompt: boolean;
}): Promise<void> {
  if (!IS_CLOUD) {
    return;
  }

  try {
    await postManagedClickhouse("log-ai-usage", {
      organization,
      type,
      model,
      temperature,
      numPromptTokensUsed,
      numCompletionTokensUsed,
      usedDefaultPrompt,
    });
  } catch (e) {
    logger.error(e, "Failed to log AI usage to Clickhouse");
  }
}

export async function getDailyUsageForOrg(
  orgId: string,
  start: Date,
  end: Date,
): Promise<DailyUsage[]> {
  const json = await postManagedClickhouseJson("daily-usage-for-org", {
    orgId,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const parsed = dailyUsageForOrgResponseValidator.safeParse(json);
  if (!parsed.success) {
    logger.error(
      { zodError: parsed.error.flatten() },
      "Unexpected response shape from daily-usage-for-org endpoint",
    );
    throw new Error(
      "Unexpected response shape from daily-usage-for-org endpoint",
    );
  }
  return parsed.data.days;
}
