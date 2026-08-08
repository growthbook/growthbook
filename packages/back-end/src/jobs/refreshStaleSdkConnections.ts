import Agenda, { Job } from "agenda";
import { hasAnyStaleSdkConnection } from "back-end/src/models/SdkConnectionModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { logger } from "back-end/src/util/logger";

export const REFRESH_STALE_SDK_CONNECTIONS_JOB = "refreshStaleSdkConnections";

type RefreshStaleSdkConnectionsJob = Job<{ organization: string }>;

export default function addRefreshStaleSdkConnectionsJob(agenda: Agenda) {
  agenda.define(
    REFRESH_STALE_SDK_CONNECTIONS_JOB,
    runRefreshStaleSdkConnections,
  );

  // Agenda freezes nextRunAt before the handler and re-persists that snapshot
  // afterward, so rescheduling inside the handler is clobbered. Reschedule
  // from `complete` after that save has landed.
  agenda.on(
    `complete:${REFRESH_STALE_SDK_CONNECTIONS_JOB}`,
    (job: RefreshStaleSdkConnectionsJob) => {
      const organization = job.attrs.data?.organization;
      if (!organization) return;
      hasAnyStaleSdkConnection(organization)
        .then((stale) => {
          // A write came in and marked the org as stale while the job was running,
          // so we need to kick off a new job to procress the new stale connections.
          if (stale) return scheduleOrgRefreshJob(organization);
        })
        .catch((e) => {
          // The check itself failed (e.g. a transient DB error) — we can't tell
          // if the org is actually stale, so reschedule anyway. A no-op pass is
          // cheap; skipping it could leave a real stale mark with no job to clear it.
          logger.error(
            e,
            `Error re-checking stale SDK connections for org ${organization}; scheduling a follow-up pass to be safe`,
          );
          return scheduleOrgRefreshJob(organization).catch((e2) => {
            logger.error(
              e2,
              `Failed to schedule follow-up refresh for org ${organization}`,
            );
          });
        });
    },
  );

  // job.unique() upserts are not atomic without a real unique index; concurrent
  // first-time enqueues for the same org can otherwise insert duplicates.
  // Partial + scoped to this job name so other Agenda jobs are unaffected.
  agenda._collection
    .createIndex(
      { name: 1, "data.organization": 1 },
      {
        unique: true,
        partialFilterExpression: { name: REFRESH_STALE_SDK_CONNECTIONS_JOB },
      },
    )
    .catch((e) => {
      logger.error(
        e,
        "Failed to create unique index for refreshStaleSdkConnections jobs; " +
          "concurrent enqueues for the same org may create duplicate, concurrently-running jobs",
      );
    });
}

// Unique per-org job; concurrent calls collapse onto one document.
export async function scheduleOrgRefreshJob(
  organization: string,
): Promise<void> {
  const agenda = getAgendaInstance();
  const job = agenda.create(REFRESH_STALE_SDK_CONNECTIONS_JOB, {
    organization,
  }) as RefreshStaleSdkConnectionsJob;

  job.unique({ "data.organization": organization });
  job.schedule(new Date());
  await job.save();
}

async function runRefreshStaleSdkConnections(
  job: RefreshStaleSdkConnectionsJob,
) {
  const organization = job.attrs.data?.organization;
  if (!organization) return;

  // Lazy import avoids a circular dependency with services/features.ts
  const { refreshStaleSdkConnectionsForOrg } = await import(
    "back-end/src/services/features"
  );
  const context = await getContextForAgendaJobByOrgId(organization);
  await refreshStaleSdkConnectionsForOrg(context);
}
