import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { WEBHOOK_CONSECUTIVE_FAILURES_THRESHOLD } from "shared/constants";
import { getFeatureDefinitionsWithCache } from "back-end/src/controllers/features";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  clearProxyError,
  findSDKConnectionById,
  setProxyError,
  setProxyFailureAlertedAt,
} from "back-end/src/models/SdkConnectionModel";
import {
  describeProxyError,
  describeProxyRequestError,
  getNextProxyCheck,
  isProxyFailureAlertDue,
  sendSdkProxyAlert,
} from "back-end/src/services/sdkProxyErrors";
import {
  cancellableFetch,
  getWebhookTimeoutMs,
} from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

const PROXY_UPDATE_JOB_NAME = "proxyUpdate";
const MAX_RETRIES = 1;
type ProxyUpdateJob = Job<{
  orgId: string;
  connectionId: string;
  useCloudProxy: boolean;
  retryCount: number;
  // Set when a push fails for good: when to push again so an alert can fire
  // even if nothing else changes in the meantime
  nextCheckAt?: number;
  // A run scheduled from nextCheckAt. Its failures don't count toward
  // disabling, so the disabling rules stay the same as before checks existed.
  scheduledCheck?: boolean;
}>;

const proxyUpdate = async (job: ProxyUpdateJob) => {
  const connectionId = job.attrs.data?.connectionId;
  const orgId = job.attrs.data?.orgId;
  const useCloudProxy = job.attrs.data?.useCloudProxy;
  if (!connectionId) {
    logger.error(
      {
        connectionId,
        useCloudProxy,
      },
      "proxyUpdate: No connectionId provided for proxy update job",
    );
    return;
  }

  if (!orgId) {
    logger.error(
      {
        connectionId,
        useCloudProxy,
      },
      "proxyUpdate: No orgId provided for proxy update job",
    );
    return;
  }

  const context = await getContextForAgendaJobByOrgId(orgId);

  const connection = await findSDKConnectionById(context, connectionId);
  if (!connection) {
    logger.error(
      {
        connectionId,
        useCloudProxy,
      },
      "proxyUpdate: Could not find sdk connection",
    );
    return;
  }
  // Queued before it was archived: an archived connection serves nothing.
  if (connection.archived) return;

  // The failure count belongs to the connection's own proxy, not ours.
  // A scheduled check can run hours later, after the proxy was turned off.
  if (
    !useCloudProxy &&
    (!connection.proxy.enabled ||
      (connection.proxy.consecutiveFailures || 0) >=
        WEBHOOK_CONSECUTIVE_FAILURES_THRESHOLD)
  ) {
    return;
  }

  if (!useCloudProxy && !connection.proxy.host) {
    logger.error(
      {
        connectionId,
        useCloudProxy,
      },
      "proxyUpdate: Proxy host is missing",
    );
    return;
  }

  const payload = JSON.stringify(
    await getFeatureDefinitionsWithCache({
      context,
      params: connection,
    }),
  );

  // note: Cloud users will typically have proxy.enabled === false (unless using a local proxy), but will still have a valid proxy.signingKey
  const signature = createHmac("sha256", connection.proxy.signingKey)
    .update(payload)
    .digest("hex");

  const url = useCloudProxy
    ? `https://proxy.growthbook.io/proxy/features`
    : `${connection.proxy.host.replace(/\/$/, "")}/proxy/features`;

  const payloadBytes = Buffer.byteLength(payload);
  const logContext = {
    orgId,
    connectionId,
    useCloudProxy,
    host: new URL(url).host,
    payloadBytes,
  };

  const recordFailure = async (
    status: number | null,
    error: string,
    countFailure: boolean,
  ) => {
    // Customers can't fix our proxy, so its failures stay off their connection
    if (useCloudProxy) return;
    const result = await setProxyError(context, connection, error, {
      countFailure: countFailure && !job.attrs.data?.scheduledCheck,
    });
    if (result.disabled || !isLastAttempt(job)) {
      if (result.disabled) {
        const sent = await sendSdkProxyAlert(context, connection, {
          state: "disabled",
          status,
          error,
          failingSince: result.failingSince,
          email: true,
        });
        if (sent)
          await setProxyFailureAlertedAt(context, connection, new Date());
      }
      return;
    }
    const now = new Date();
    // An alert from before this run of failures doesn't count. It's kept
    // through re-enabling and host changes so a later success sends `recovered`
    const lastAlertedAt = connection.proxy.failureAlertedAt ?? null;
    let failureAlertedAt =
      lastAlertedAt && lastAlertedAt >= result.failingSince
        ? lastAlertedAt
        : null;
    if (isProxyFailureAlertDue(result.failingSince, failureAlertedAt, now)) {
      const sent = await sendSdkProxyAlert(context, connection, {
        state: "failing",
        status,
        error,
        failingSince: result.failingSince,
        // Reminders go only to event subscribers, who can turn them off
        email: !failureAlertedAt,
      });
      if (sent) {
        failureAlertedAt = now;
        await setProxyFailureAlertedAt(context, connection, now);
      }
    }
    const nextCheck = getNextProxyCheck(
      result.failingSince,
      failureAlertedAt,
      now,
    );
    if (job.attrs.data && nextCheck) {
      job.attrs.data.nextCheckAt = nextCheck.getTime();
    }
  };

  let res: Awaited<ReturnType<typeof fireProxyWebhook>>;
  try {
    res = await fireProxyWebhook({
      url,
      signature,
      key: connection.key,
      payload,
    });
  } catch (e) {
    const error = describeProxyRequestError(e);
    logger.warn({ ...logContext, error }, "proxyUpdate: Push failed");
    // No response, so a slow proxy can't be told apart from a dead one:
    // shown and alerted on, but not counted toward disabling
    await recordFailure(null, error, false);
    throw new Error(error);
  }

  if (!res.ok) {
    const error = describeProxyError(res.status, payloadBytes);
    logger.warn(
      { ...logContext, status: res.status },
      "proxyUpdate: Push returned an error status",
    );
    // A 413 means the proxy is up but its size limit is too low, so
    // disabling it would only stop updates
    await recordFailure(res.status, error, res.status !== 413);
    throw new Error(error);
  }

  if (!useCloudProxy) {
    // Sent first, so a failed send keeps the alert time and the next
    // successful push tries again
    const recoveredSent = connection.proxy.failureAlertedAt
      ? await sendSdkProxyAlert(context, connection, {
          state: "recovered",
          status: null,
          error: "",
          failingSince: connection.proxy.failingSince,
        })
      : true;
    await clearProxyError(context, connection, {
      clearFailureAlert: recoveredSent,
    });
  }
};

function isLastAttempt(job: ProxyUpdateJob) {
  return (job.attrs.data?.retryCount ?? 0) >= MAX_RETRIES;
}

let agenda: Agenda;
export default function addProxyUpdateJob(ag: Agenda) {
  agenda = ag;

  // Fire webhooks
  agenda.define(PROXY_UPDATE_JOB_NAME, proxyUpdate);
  agenda.on(
    "fail:" + PROXY_UPDATE_JOB_NAME,
    async (error: Error, job: ProxyUpdateJob) => {
      if (!job.attrs.data) return;

      if (!isLastAttempt(job)) {
        job.attrs.data.retryCount++;
        job.attrs.nextRunAt = new Date(Date.now() + 5000);
      } else if (job.attrs.data.nextCheckAt) {
        // A new push replaces this, since the job is unique per connection
        job.attrs.nextRunAt = new Date(job.attrs.data.nextCheckAt);
        job.attrs.data.nextCheckAt = undefined;
        job.attrs.data.scheduledCheck = true;
      } else {
        return;
      }
      await job.save();
    },
  );
}

export async function queueSingleProxyUpdate(
  orgId: string,
  connection: SDKConnectionInterface,
  useCloudProxy: boolean = false,
) {
  if (!connectionSupportsProxyUpdate(connection, useCloudProxy)) return;

  const job = agenda.create(PROXY_UPDATE_JOB_NAME, {
    orgId,
    connectionId: connection.id,
    retryCount: 0,
    useCloudProxy,
  }) as ProxyUpdateJob;
  job.unique({
    "data.connectionId": connection.id,
    "data.useCloudProxy": useCloudProxy,
  });
  job.schedule(new Date());
  await job.save();
}

export async function queueProxyUpdate(
  context: ReqContext | ApiReqContext,
  connections: SDKConnectionInterface[],
) {
  if (!connections.length) return;

  for (let i = 0; i < connections.length; i++) {
    const connection = connections[i];

    if (IS_CLOUD) {
      // Always fire webhook to GB Cloud Proxy for cloud users
      await queueSingleProxyUpdate(context.org.id, connection, true);
    }
    // If connection (cloud or self-hosted) specifies an (additional) proxy host, fire webhook
    await queueSingleProxyUpdate(context.org.id, connection, false);
  }
}

function connectionSupportsProxyUpdate(
  connection: SDKConnectionInterface,
  useCloudProxy: boolean,
) {
  if (useCloudProxy) {
    return IS_CLOUD;
  }
  return !!(connection.proxy.enabled && connection.proxy.host);
}

async function fireProxyWebhook({
  url,
  signature,
  key,
  payload,
}: {
  url: string;
  signature: string;
  key: string;
  payload: string;
}) {
  const { responseWithoutBody: res } = await cancellableFetch(
    url,
    {
      headers: {
        "Content-Type": "application/json",
        "X-GrowthBook-Signature": signature,
        "X-GrowthBook-Api-Key": key,
      },
      method: "POST",
      body: payload,
    },
    {
      maxContentSize: 500,
      // Same as SDK webhooks: the proxy replies only after storing and
      // broadcasting the payload, which takes longer as it grows
      maxTimeMs: getWebhookTimeoutMs(),
    },
  );

  return res;
}
