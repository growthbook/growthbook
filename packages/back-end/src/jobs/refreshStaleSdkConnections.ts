import Agenda, { Job } from "agenda";
import {
  findOrganizationsWithStaleSdkConnections,
  hasAnyStaleSdkConnection,
} from "back-end/src/models/SdkConnectionModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { logger } from "back-end/src/util/logger";

export const REFRESH_STALE_SDK_CONNECTIONS_JOB = "refreshStaleSdkConnections";
export const SWEEP_STALE_SDK_CONNECTIONS_JOB = "sweepStaleSdkConnections";

// A failed run keeps its marks, so retries are self-driven; back off so a
// persistently failing org can't rebuild in a tight loop forever. A new write
// still re-enqueues immediately.
const FAIL_RETRY_BASE_MS = 10_000;
const FAIL_RETRY_MAX_MS = 10 * 60 * 1000;

// Marks normally clear within seconds; anything this old was stranded (e.g. a
// job-runner restart between the run and its reschedule) and gets swept back in.
const SWEEP_MIN_AGE_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL = "10 minutes";

type RefreshStaleSdkConnectionsJob = Job<{ organization: string }>;

export default function addRefreshStaleSdkConnectionsJob(agenda: Agenda) {
  agenda.define(
    REFRESH_STALE_SDK_CONNECTIONS_JOB,
    runRefreshStaleSdkConnections,
  );
  agenda.define(SWEEP_STALE_SDK_CONNECTIONS_JOB, runSweepStaleSdkConnections);

  // Agenda freezes nextRunAt before the handler and re-persists that snapshot
  // afterward, so rescheduling inside the handler is clobbered. success/fail
  // fire only after that save has landed.
  agenda.on(
    `success:${REFRESH_STALE_SDK_CONNECTIONS_JOB}`,
    (job: RefreshStaleSdkConnectionsJob) => {
      const organization = job.attrs.data?.organization;
      if (!organization) return;
      hasAnyStaleSdkConnection(organization)
        .then((stale) => {
          // A write landing mid-run marked new staleness; run again for it.
          if (stale) return scheduleOrgRefreshJob(organization);
        })
        .catch((e) => {
          // Either the re-check or the reschedule failed — reschedule (again)
          // to be safe: a no-op pass is cheap, a stranded stale mark isn't.
          logger.error(
            e,
            `Error rescheduling stale SDK connection refresh for org ${organization}; retrying the reschedule`,
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

  agenda.on(
    `fail:${REFRESH_STALE_SDK_CONNECTIONS_JOB}`,
    (error: Error, job: RefreshStaleSdkConnectionsJob) => {
      const organization = job.attrs.data?.organization;
      if (!organization) return;
      const failCount = job.attrs.failCount || 1;
      const delayMs = Math.min(
        FAIL_RETRY_BASE_MS * 2 ** Math.min(failCount - 1, 10),
        FAIL_RETRY_MAX_MS,
      );
      logger.error(
        error,
        `Stale SDK connection refresh failed for org ${organization} (failure #${failCount}); retrying in ${delayMs}ms`,
      );
      scheduleOrgRefreshJob(organization, new Date(Date.now() + delayMs)).catch(
        (e2) => {
          logger.error(
            e2,
            `Failed to schedule retry refresh for org ${organization}`,
          );
        },
      );
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

  agenda.every(SWEEP_INTERVAL, SWEEP_STALE_SDK_CONNECTIONS_JOB).catch((e) => {
    logger.error(e, "Failed to schedule stale SDK connection sweep job");
  });
}

// Unique per-org job; concurrent calls collapse onto one document.
export async function scheduleOrgRefreshJob(
  organization: string,
  runAt: Date = new Date(),
): Promise<void> {
  const agenda = getAgendaInstance();
  const job = agenda.create(REFRESH_STALE_SDK_CONNECTIONS_JOB, {
    organization,
  }) as RefreshStaleSdkConnectionsJob;

  job.unique({ "data.organization": organization });
  job.schedule(runAt);
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

// Safety net for staleness stranded by a crashed/restarted job runner or a
// lost reschedule: re-enqueue any org whose marks have sat unprocessed.
async function runSweepStaleSdkConnections() {
  const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MS);
  const organizations = await findOrganizationsWithStaleSdkConnections(cutoff);
  for (const organization of organizations) {
    try {
      await scheduleOrgRefreshJob(organization);
    } catch (e) {
      logger.error(
        e,
        `Failed to schedule swept stale SDK connection refresh for org ${organization}`,
      );
    }
  }
}
