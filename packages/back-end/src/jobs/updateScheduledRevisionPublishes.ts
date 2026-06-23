import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { RevisionModel } from "back-end/src/models/RevisionModel";
import { getAdapter } from "back-end/src/revisions";
import { maybePublishScheduledRevision } from "back-end/src/revisions/revisionActions";
import { registerScheduledPublishJob } from "back-end/src/jobs/scheduledPublishJob";

type EntityRevisionPublishJobData = {
  organization: string;
  revisionId: string;
};

const publishScheduledRevision = async (
  job: Job<EntityRevisionPublishJobData>,
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

export default async function addScheduledRevisionPublishJob(agenda: Agenda) {
  await registerScheduledPublishJob<EntityRevisionPublishJobData>(agenda, {
    queueJobName: "queueScheduledRevisionPublishes",
    // Distinct from the feature flow's "publishScheduledRevision" — the factory
    // enforces this, but keep it obviously different here too.
    publishJobName: "publishScheduledEntityRevision",
    findDue: async (now) =>
      (await RevisionModel.dangerouslyFindRevisionsDueToPublish(now)).map(
        (r) => ({ organization: r.organization, revisionId: r.id }),
      ),
    describeItem: ({ organization, revisionId }) =>
      `revision ${revisionId} (org ${organization})`,
    publish: publishScheduledRevision,
  });
}
