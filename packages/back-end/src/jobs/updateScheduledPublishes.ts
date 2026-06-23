import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  cancelScheduledPublishesForFeature,
  dangerouslyFindRevisionsDueToPublish,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { maybePublishScheduledRevision } from "back-end/src/api/features/autoPublishOnApproval";
import { registerScheduledPublishJob } from "back-end/src/jobs/scheduledPublishJob";

type FeaturePublishJobData = {
  organization: string;
  featureId: string;
  version: number;
};

const publishScheduledRevision = async (job: Job<FeaturePublishJobData>) => {
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

export default async function addScheduledPublishJob(agenda: Agenda) {
  await registerScheduledPublishJob<FeaturePublishJobData>(agenda, {
    queueJobName: "queueScheduledPublishes",
    publishJobName: "publishScheduledRevision",
    findDue: dangerouslyFindRevisionsDueToPublish,
    describeItem: ({ organization, featureId, version }) =>
      `feature ${featureId} v${version} (org ${organization})`,
    publish: publishScheduledRevision,
  });
}
