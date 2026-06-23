import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { RevisionModel } from "back-end/src/models/RevisionModel";
import { getAdapter } from "back-end/src/revisions";
import { maybePublishScheduledRevision } from "back-end/src/revisions/revisionActions";

type PublishScheduledRevisionJob = Job<{
  organization: string;
  revisionId: string;
}>;

const QUEUE_SCHEDULED_REVISION_PUBLISHES = "queueScheduledRevisionPublishes";
// Must stay distinct from the feature flow's per-revision job name in
// updateScheduledPublishes.ts. Agenda keys handlers by name, so a shared name
// makes the second agenda.define() overwrite the first — whichever registers
// last wins and silently swallows the other flow's jobs at its entry guard.
const PUBLISH_SCHEDULED_REVISION = "publishScheduledEntityRevision";

const POLL_INTERVAL_MINUTES = 1;

async function queueScheduledRevisionPublish(
  agenda: Agenda,
  item: { organization: string; revisionId: string },
) {
  const job = agenda.create(
    PUBLISH_SCHEDULED_REVISION,
    item,
  ) as PublishScheduledRevisionJob;
  // Dedup per revision: overlapping poll ticks (and multiple back-end instances)
  // can't queue two concurrent publishes for the same revision. The publish also
  // re-fetches and re-checks, so a stale re-run after a success no-ops. The
  // revision id is globally unique, so org+id is a sufficient key.
  job.unique({
    organization: item.organization,
    revisionId: item.revisionId,
  });
  job.schedule(new Date());
  await job.save();
}

export default async function addScheduledRevisionPublishJob(agenda: Agenda) {
  agenda.define(QUEUE_SCHEDULED_REVISION_PUBLISHES, async () => {
    const due = await RevisionModel.dangerouslyFindRevisionsDueToPublish(
      new Date(),
    );
    for (const item of due) {
      try {
        await queueScheduledRevisionPublish(agenda, {
          organization: item.organization,
          revisionId: item.id,
        });
      } catch (e) {
        logger.error(
          e,
          `Error queuing scheduled revision publish ${item.id} (org ${item.organization})`,
        );
      }
    }
  });

  agenda.define(PUBLISH_SCHEDULED_REVISION, publishScheduledRevision);

  const job = agenda.create(QUEUE_SCHEDULED_REVISION_PUBLISHES, {});
  job.unique({});
  job.repeatEvery(`${POLL_INTERVAL_MINUTES} minutes`);
  await job.save();
}

export const publishScheduledRevision = async (
  job: PublishScheduledRevisionJob,
) => {
  const organization = job.attrs.data?.organization;
  const revisionId = job.attrs.data?.revisionId;
  if (!organization || !revisionId) return;

  const context = await getContextForAgendaJobByOrgId(organization);
  const revision = await context.models.revisions.getById(revisionId);
  if (!revision) return;

  const entityModel = getAdapter(revision.target.type).getModel(context);
  if (!entityModel) return;

  const entity = await entityModel.getById(revision.target.id);
  if (!entity) {
    // The underlying entity was deleted — cancel the stale schedule so the
    // poller stops finding and re-queuing it every tick.
    await context.models.revisions
      .setScheduledPublish(revisionId, null, { scheduledPublishAt: null })
      .catch((e) =>
        logger.error(
          e,
          `Error canceling schedule for deleted entity (revision ${revisionId})`,
        ),
      );
    return;
  }

  // Re-checks the due gate and governance; holds and retries next tick if not
  // ready (records the failure for the "stuck" indicator).
  await maybePublishScheduledRevision(
    context,
    revision,
    entity as Record<string, unknown>,
  );
};
