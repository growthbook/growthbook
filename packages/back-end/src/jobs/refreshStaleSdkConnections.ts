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

  // Agenda's own job.run() freezes nextRunAt (to null — this job has no
  // repeatInterval) before calling the handler, then unconditionally
  // re-persists that frozen in-memory snapshot once the handler finishes,
  // success or failure. Rescheduling from inside the handler would get
  // silently clobbered by that save every time (verified against a real
  // Agenda instance). This listener fires only after that save has already
  // landed, so a reschedule here actually sticks.
  agenda.on(
    `complete:${REFRESH_STALE_SDK_CONNECTIONS_JOB}`,
    (job: RefreshStaleSdkConnectionsJob) => {
      const organization = job.attrs.data?.organization;
      if (!organization) return;
      hasAnyStaleSdkConnection(organization)
        .then((stale) => (stale ? scheduleOrgRefreshJob(organization) : null))
        .catch((e) => {
          logger.error(
            e,
            `Error re-checking stale SDK connections for org ${organization}`,
          );
        });
    },
  );

  // job.unique() alone isn't atomic: findOneAndUpdate(..., {upsert:true}) can
  // still insert duplicate documents under truly concurrent first-time
  // enqueues for the same org, unless backed by a real index on the matched
  // fields (verified: 20 concurrent upserts against this exact query shape
  // with no index produced up to 5 duplicates in testing). Partial + scoped
  // to this job's name so it doesn't constrain Agenda's other job types.
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

// Enqueues (or, if one is already pending/running, just bumps the schedule
// of) a single unique job for this org, to run as soon as the job server has
// availability. Safe to call unconditionally on every write — Agenda's
// unique() upsert collapses concurrent calls onto the same job document.
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
