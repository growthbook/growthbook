import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  cancelScheduledPublishesForFeature,
  dangerouslyFindRevisionsDueToPublish,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { maybePublishScheduledRevision } from "back-end/src/api/features/autoPublishOnApproval";

type PublishScheduledRevisionJob = Job<{
  organization: string;
  featureId: string;
  version: number;
}>;

const QUEUE_SCHEDULED_PUBLISHES = "queueScheduledPublishes";
const PUBLISH_SCHEDULED_REVISION = "publishScheduledRevision";

const POLL_INTERVAL_MINUTES = 1;

async function queueScheduledPublish(
  agenda: Agenda,
  item: { organization: string; featureId: string; version: number },
) {
  const job = agenda.create(
    PUBLISH_SCHEDULED_REVISION,
    item,
  ) as PublishScheduledRevisionJob;
  // Dedup per revision: overlapping poll ticks (and multiple back-end instances)
  // can't queue two concurrent publishes for the same revision. The publish also
  // re-fetches and re-checks status, so a stale re-run after a success no-ops.
  job.unique({
    organization: item.organization,
    featureId: item.featureId,
    version: item.version,
  });
  job.schedule(new Date());
  await job.save();
}

export default async function addScheduledPublishJob(agenda: Agenda) {
  agenda.define(QUEUE_SCHEDULED_PUBLISHES, async () => {
    const due = await dangerouslyFindRevisionsDueToPublish(new Date());
    for (const item of due) {
      try {
        await queueScheduledPublish(agenda, item);
      } catch (e) {
        logger.error(
          e,
          `Error queuing scheduled publish for feature ${item.featureId} v${item.version} (org ${item.organization})`,
        );
      }
    }
  });

  agenda.define(PUBLISH_SCHEDULED_REVISION, publishScheduledRevision);

  const job = agenda.create(QUEUE_SCHEDULED_PUBLISHES, {});
  job.unique({});
  job.repeatEvery(`${POLL_INTERVAL_MINUTES} minutes`);
  await job.save();
}

export const publishScheduledRevision = async (
  job: PublishScheduledRevisionJob,
) => {
  const organization = job.attrs.data?.organization;
  const featureId = job.attrs.data?.featureId;
  const version = job.attrs.data?.version;
  if (
    !organization ||
    !featureId ||
    version === undefined ||
    version === null
  ) {
    return;
  }

  const context = await getContextForAgendaJobByOrgId(organization);
  const feature = await getFeature(context, featureId);
  if (!feature) return;

  // archiveFeature already cancels schedules; this guards against a race so we
  // don't resurrect an archived feature's draft.
  if (feature.archived) {
    await cancelScheduledPublishesForFeature(context, organization, featureId);
    return;
  }

  const revision = await getRevision({
    context,
    organization,
    featureId,
    feature,
    version,
  });
  if (!revision) return;

  // Re-checks the due gate and governance; holds and retries next tick if not ready.
  await maybePublishScheduledRevision(context, feature, revision);
};
