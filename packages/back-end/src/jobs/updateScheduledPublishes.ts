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

  // Archived features must not auto-publish. archiveFeature already cancels
  // schedules; this is a belt-and-suspenders guard against a race so we stop
  // retrying instead of resurrecting an archived feature's draft.
  if (feature.archived) {
    await cancelScheduledPublishesForFeature(organization, featureId);
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

  // maybePublishScheduledRevision re-checks the due gate and governance; if the
  // draft can't publish yet it holds and the next 1-minute tick retries.
  await maybePublishScheduledRevision(context, feature, revision);
};
