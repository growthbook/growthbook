import Agenda, { Job } from "agenda";
import {
  getFeature,
  getScheduledFeaturesToUpdate,
  updateNextScheduledDate,
} from "back-end/src/models/FeatureModel";
import {
  getNextScheduledUpdate,
  refreshSDKPayloadCache,
} from "back-end/src/services/features";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getSDKPayloadKeysByDiff } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { logger } from "back-end/src/util/logger";

type UpdateSingleFeatureJob = Job<{
  featureId: string;
  organization: string;
}>;

const QUEUE_FEATURE_UPDATES = "queueScheduledFeatureUpdates";
const UPDATE_SINGLE_FEATURE = "updateSingleFeature";

async function fireUpdateWebhook(agenda: Agenda) {
  const updateFeatureJob = agenda.create(QUEUE_FEATURE_UPDATES, {});
  updateFeatureJob.unique({});
  updateFeatureJob.repeatEvery("1 minute");
  await updateFeatureJob.save();
}

async function queueFeatureUpdate(
  agenda: Agenda,
  feature: { id: string; organization: string },
) {
  const job = agenda.create(UPDATE_SINGLE_FEATURE, {
    featureId: feature.id,
    organization: feature.organization,
  }) as UpdateSingleFeatureJob;

  job.unique({ featureId: feature.id, organization: feature.organization });
  job.schedule(new Date());
  await job.save();
}

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_FEATURE_UPDATES, async () => {
    const featureIds = (await getScheduledFeaturesToUpdate()).map((f) => {
      return { id: f.id, organization: f.organization };
    });

    for (let i = 0; i < featureIds.length; i++) {
      await queueFeatureUpdate(agenda, featureIds[i]);
    }
  });

  agenda.define(UPDATE_SINGLE_FEATURE, updateSingleFeature);

  await fireUpdateWebhook(agenda);
}

export const updateSingleFeature = async (job: UpdateSingleFeatureJob) => {
  const featureId = job.attrs.data?.featureId;
  const organization = job.attrs.data?.organization;
  if (!featureId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);
  const feature = await getFeature(context, featureId);
  if (!feature) return;

  const nextScheduledUpdate = getNextScheduledUpdate(
    feature.environmentSettings || {},
    context.environments,
  );

  const payloadKeys = getSDKPayloadKeysByDiff(
    feature,
    { ...feature, nextScheduledUpdate: nextScheduledUpdate ?? undefined },
    getEnvironmentIdsFromOrg(context.org),
  );

  // Intentionally fire-and-forget: releasing the Agenda job quickly lets a
  // replacement worker pick this feature up on the next 1-minute queue tick if
  // this pod dies mid-refresh. We only advance nextScheduledUpdate after a
  // successful refresh so failures remain eligible for retry.
  refreshSDKPayloadCache({
    context,
    payloadKeys,
    auditContext: { event: "updated", model: "feature", id: feature.id },
  })
    .then(() => updateNextScheduledDate(feature, nextScheduledUpdate))
    .catch((e) =>
      logger.error(e, "Failed updating scheduled feature " + featureId),
    );
};
