import Agenda from "agenda";
import { findOrgsWithStaleSdkConnections } from "back-end/src/models/SdkConnectionModel";
import { refreshStaleSdkConnectionsForOrg } from "back-end/src/services/features";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { SDK_PAYLOAD_REFRESH_STALE_SWEEP_SECONDS } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "refreshStaleSdkConnections";

// Backstop for the immediate-refresh path in queueSDKPayloadRefresh: catches
// any org whose stale SDK connections weren't picked up right away (a write
// landing while another org write was already pending, or a failed immediate
// attempt). Most ticks should find nothing — this isn't the primary driver,
// just what guarantees eventual consistency. Runs orgs sequentially since
// there should rarely be more than a handful with pending work at once.
const refreshStaleSdkConnections = async () => {
  const orgIds = await findOrgsWithStaleSdkConnections();
  for (const orgId of orgIds) {
    try {
      const context = await getContextForAgendaJobByOrgId(orgId);
      await refreshStaleSdkConnectionsForOrg(context);
    } catch (e) {
      logger.error(
        e,
        `Error refreshing stale SDK connections for org ${orgId}`,
      );
    }
  }
};

export default async function (agenda: Agenda) {
  if (SDK_PAYLOAD_REFRESH_STALE_SWEEP_SECONDS <= 0) return;

  agenda.define(JOB_NAME, refreshStaleSdkConnections);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery(`${SDK_PAYLOAD_REFRESH_STALE_SWEEP_SECONDS} seconds`);
  await job.save();
}
