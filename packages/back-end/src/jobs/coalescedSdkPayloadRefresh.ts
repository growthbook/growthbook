import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import {
  ackPendingSdkPayloadRefreshRequests,
  appendPendingSdkPayloadRefreshRequest,
  getPendingSdkPayloadRefreshAgeMs,
  getPendingSdkPayloadRefreshRequests,
  SdkPayloadRefreshQueueRequest,
} from "back-end/src/services/sdkPayloadRefreshCoalescer";
import { getAgendaInstance } from "back-end/src/services/queueing";
import {
  SDK_PAYLOAD_REFRESH_DEBOUNCE_MS,
  SDK_PAYLOAD_REFRESH_MAX_WAIT_MS,
} from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

export const COALESCED_SDK_PAYLOAD_REFRESH_JOB = "coalescedSdkPayloadRefresh";

type CoalescedSdkPayloadRefreshJob = Job<{
  organization: string;
}>;

export default function addCoalescedSdkPayloadRefreshJob(agenda: Agenda) {
  agenda.define(
    COALESCED_SDK_PAYLOAD_REFRESH_JOB,
    runCoalescedSdkPayloadRefresh,
  );
}

async function scheduleCoalescedSdkPayloadRefreshJob(
  organization: string,
  minDelayMs = 0,
): Promise<void> {
  const agenda = getAgendaInstance();
  const job = agenda.create(COALESCED_SDK_PAYLOAD_REFRESH_JOB, {
    organization,
  }) as CoalescedSdkPayloadRefreshJob;

  job.unique({ "data.organization": organization });

  let delayMs = SDK_PAYLOAD_REFRESH_DEBOUNCE_MS;
  if (SDK_PAYLOAD_REFRESH_MAX_WAIT_MS > 0) {
    const ageMs = await getPendingSdkPayloadRefreshAgeMs(organization);
    if (ageMs !== null) {
      delayMs = Math.min(
        SDK_PAYLOAD_REFRESH_DEBOUNCE_MS,
        Math.max(0, SDK_PAYLOAD_REFRESH_MAX_WAIT_MS - ageMs),
      );
    }
  }
  delayMs = Math.max(minDelayMs, delayMs);

  job.schedule(new Date(Date.now() + delayMs));
  await job.save();
}

export async function enqueueCoalescedSdkPayloadRefresh(
  organization: string,
  request: SdkPayloadRefreshQueueRequest,
): Promise<void> {
  await appendPendingSdkPayloadRefreshRequest(organization, request);
  await scheduleCoalescedSdkPayloadRefreshJob(organization);
}

async function runCoalescedSdkPayloadRefresh(
  job: CoalescedSdkPayloadRefreshJob,
) {
  const organization = job.attrs.data?.organization;
  if (!organization) return;

  // Lazy import avoids a circular dependency with services/features.ts
  const { refreshSDKPayloadCache } = await import(
    "back-end/src/services/features"
  );

  try {
    const pending = await getPendingSdkPayloadRefreshRequests(organization);
    if (!pending) return;

    const context = await getContextForAgendaJobByOrgId(organization);
    await refreshSDKPayloadCache({
      context,
      payloadKeys: pending.merged.payloadKeys,
      sdkConnections: pending.merged.sdkConnections ?? [],
      skipRefreshForProject: pending.merged.skipRefreshForProject,
      treatEmptyProjectAsGlobal:
        pending.merged.treatEmptyProjectAsGlobal ?? false,
      auditContext: pending.merged.auditContext,
      stackTrace: pending.merged.stackTrace,
    });
    await ackPendingSdkPayloadRefreshRequests(
      organization,
      pending.requestCount,
    );
  } catch (e) {
    logger.error(
      e,
      `Error running coalesced SDK payload refresh for org ${organization}`,
    );
    await scheduleCoalescedSdkPayloadRefreshJob(
      organization,
      SDK_PAYLOAD_REFRESH_DEBOUNCE_MS,
    );
    throw e;
  }
}
