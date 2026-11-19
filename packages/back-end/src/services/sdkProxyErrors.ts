import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { formatSdkPayloadBytes } from "shared/health";
import { createEvent } from "back-end/src/models/EventModel";
import type { ProxyErrorResult } from "back-end/src/models/SdkConnectionModel";
import { getAdminEmails } from "back-end/src/services/adminEmails";
import {
  isEmailEnabled,
  sendSdkProxyErrorEmail,
} from "back-end/src/services/email";
import { getWebhookTimeoutMs } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

/** How long a proxy fails before the first alert. */
export const PROXY_ALERT_AFTER_MS = 60 * 60 * 1000;
/** How often to remind while the proxy keeps failing. */
export const PROXY_ALERT_REMINDER_MS = 24 * 60 * 60 * 1000;

/** Which proxy alert to send. Each has its own event. */
export type ProxyAlertState = "failing" | "disabled" | "recovered";

/** Describes a failed proxy push for the SDK Connection page and alerts. */
export function describeProxyError(status: number, payloadBytes: number) {
  if (status === 413) {
    return `The SDK payload (${formatSdkPayloadBytes(payloadBytes)}) exceeds the proxy's request size limit. Increase MAX_PAYLOAD_SIZE on the proxy, and any request size limit on a load balancer or ingress in front of it.`;
  }
  return "POST returned an invalid status code: " + status;
}

/** Describes a push that got no response from the proxy. */
export function describeProxyRequestError(e: unknown): string {
  if (e instanceof Error && e.name === "AbortError") {
    return `The proxy didn't respond within ${getWebhookTimeoutMs() / 1000} seconds.`;
  }
  const message = e instanceof Error ? e.message : String(e);
  return `Couldn't reach the proxy: ${message}`;
}

/**
 * Picks the alert to send after a failed attempt, if any. Failures only alert
 * once the retry has failed too, so a failure the retry fixes is silent.
 * @param failureAlertedAt - When the last failure alert was sent, if any.
 * @param lastAttempt - Whether this was the push's last attempt.
 */
export function getProxyFailureAlert(
  result: ProxyErrorResult,
  failureAlertedAt: Date | null | undefined,
  lastAttempt: boolean,
  now: Date,
): Exclude<ProxyAlertState, "recovered"> | null {
  if (result.disabled) return "disabled";
  if (!lastAttempt) return null;
  if (!failureAlertedAt) {
    return now.getTime() - result.failingSince.getTime() >= PROXY_ALERT_AFTER_MS
      ? "failing"
      : null;
  }
  return now.getTime() - failureAlertedAt.getTime() >= PROXY_ALERT_REMINDER_MS
    ? "failing"
    : null;
}

/**
 * Sends a proxy alert to event subscribers, and emails admins unless the
 * proxy recovered. Never throws: an alert failure must not change the push's
 * outcome.
 * @returns Whether the event was saved.
 */
export async function sendSdkProxyAlert(
  context: ReqContext,
  connection: SDKConnectionInterface,
  {
    state,
    status,
    error,
    failingSince,
  }: {
    state: ProxyAlertState;
    status: number | null;
    error: string;
    failingSince: Date | null | undefined;
  },
): Promise<boolean> {
  const fields = {
    connectionId: connection.id,
    connectionName: connection.name,
    environment: connection.environment,
    projects: connection.projects,
    proxyHost: connection.proxy.host,
    failingSince: failingSince ? failingSince.toISOString() : null,
  };
  const eventParams = {
    context,
    object: "sdkConnection" as const,
    objectId: connection.id,
    projects: connection.projects,
    tags: [],
    environments: [connection.environment],
    containsSecrets: false,
  };
  try {
    const eventId =
      state === "recovered"
        ? await createEvent({
            ...eventParams,
            event: "proxy.recovered",
            data: { object: fields },
          })
        : await createEvent({
            ...eventParams,
            event: state === "disabled" ? "proxy.disabled" : "proxy.failing",
            data: { object: { ...fields, status, error } },
          });
    if (!eventId) return false;
    if (state !== "recovered" && isEmailEnabled()) {
      // Not awaited, so a slow mail server doesn't hold up the job
      void getAdminEmails(context)
        .then((emails) =>
          sendSdkProxyErrorEmail({
            emails,
            connectionId: connection.id,
            connectionName: connection.name,
            proxyHost: connection.proxy.host,
            error,
            disabled: state === "disabled",
          }),
        )
        .catch((e) => logger.error(e, "Failed to send SDK proxy error email"));
    }
    return true;
  } catch (e) {
    logger.error(e, "Failed to send SDK proxy alert");
    return false;
  }
}
