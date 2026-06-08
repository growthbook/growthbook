import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import {
  appendPendingSdkPayloadRefreshRequest,
  drainPendingSdkPayloadRefreshRequests,
  getPendingSdkPayloadRefreshAgeMs,
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

  const merged = await drainPendingSdkPayloadRefreshRequests(organization);
  if (!merged) return;

  // Lazy import avoids a circular dependency with services/features.ts
  const { refreshSDKPayloadCache } = await import(
    "back-end/src/services/features"
  );

  const context = await getContextForAgendaJobByOrgId(organization);
  try {
    await refreshSDKPayloadCache({
      context,
      payloadKeys: merged.payloadKeys,
      sdkConnections: merged.sdkConnections ?? [],
      skipRefreshForProject: merged.skipRefreshForProject,
      treatEmptyProjectAsGlobal: merged.treatEmptyProjectAsGlobal ?? false,
      auditContext: merged.auditContext,
      stackTrace: merged.stackTrace,
    });
  } catch (e) {
    logger.error(
      e,
      `Error running coalesced SDK payload refresh for org ${organization}`,
    );
    throw e;
  }
}
