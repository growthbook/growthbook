import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { formatSdkPayloadBytes } from "shared/health";
import { createEvent } from "back-end/src/models/EventModel";
import { getAdminEmails } from "back-end/src/services/adminEmails";
import {
  isEmailEnabled,
  sendSdkProxyErrorEmail,
} from "back-end/src/services/email";
import { getWebhookTimeoutMs } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export const PROXY_ALERT_AFTER_MS = 60 * 60 * 1000;
export const PROXY_ALERT_REMINDER_MS = 24 * 60 * 60 * 1000;
// After this, a failing proxy is only checked again on the next push, so a
// retired proxy that's still enabled doesn't get pushed to forever
export const PROXY_CHECKS_FOR_MS = 7 * 24 * 60 * 60 * 1000;
// Keeps a scheduled check from running again right away when an alert is
// overdue, e.g. because the last one couldn't be saved
const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type ProxyAlertState = "failing" | "disabled" | "recovered";

export function describeProxyError(status: number, payloadBytes: number) {
  if (status === 413) {
    return `The SDK payload (${formatSdkPayloadBytes(payloadBytes)}) exceeds the proxy's request size limit. Increase MAX_FEATURES_PAYLOAD_SIZE on the proxy (MAX_PAYLOAD_SIZE on older versions), and any request size limit on a load balancer or ingress in front of it.`;
  }
  return "POST returned an invalid status code: " + status;
}

export function describeProxyRequestError(e: unknown): string {
  if (e instanceof Error && e.name === "AbortError") {
    return `The proxy didn't respond within ${getWebhookTimeoutMs() / 1000} seconds.`;
  }
  // The fetch error's message includes the URL, which can carry a login, so
  // only its code is shown
  const code =
    e instanceof Error && "code" in e && typeof e.code === "string"
      ? e.code
      : null;
  return code
    ? `Couldn't reach the proxy (${code}).`
    : "Couldn't reach the proxy.";
}

export function isProxyFailureAlertDue(
  failingSince: Date,
  failureAlertedAt: Date | null,
  now: Date,
): boolean {
  return now.getTime() >= getProxyAlertDueAt(failingSince, failureAlertedAt);
}

// When to push again after a push fails for good, so the next alert can fire
// without waiting for another change to the payload
export function getNextProxyCheck(
  failingSince: Date,
  failureAlertedAt: Date | null,
  now: Date,
): Date | null {
  if (now.getTime() - failingSince.getTime() >= PROXY_CHECKS_FOR_MS) {
    return null;
  }
  return new Date(
    Math.max(
      getProxyAlertDueAt(failingSince, failureAlertedAt),
      now.getTime() + MIN_CHECK_INTERVAL_MS,
    ),
  );
}

function getProxyAlertDueAt(
  failingSince: Date,
  failureAlertedAt: Date | null,
): number {
  return failureAlertedAt
    ? failureAlertedAt.getTime() + PROXY_ALERT_REMINDER_MS
    : failingSince.getTime() + PROXY_ALERT_AFTER_MS;
}

/**
 * Never throws: an alert failure must not change the push's outcome.
 * @param email - Also email admins. Emails can't be turned off, so only the
 * first `failing` alert and `disabled` send one.
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
    email = false,
  }: {
    state: ProxyAlertState;
    status: number | null;
    error: string;
    failingSince: Date | null | undefined;
    email?: boolean;
  },
): Promise<boolean> {
  const fields = {
    connectionId: connection.id,
    connectionName: connection.name,
    environment: connection.environment,
    projects: connection.projects,
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
    if (email && state !== "recovered" && isEmailEnabled()) {
      // Not awaited, so a slow mail server doesn't hold up the job
      void getAdminEmails(context)
        .then((emails) =>
          sendSdkProxyErrorEmail({
            emails,
            connectionId: connection.id,
            connectionName: connection.name,
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
