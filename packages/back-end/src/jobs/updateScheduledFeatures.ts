import Agenda, { Job } from "agenda";
import {
  getFeature,
  getScheduledFeaturesToUpdate,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import { getNextScheduledUpdate } from "back-end/src/services/features";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
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

  job.unique({
    featureId: feature.id,
    organization: feature.organization,
  });
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

const updateSingleFeature = async (job: UpdateSingleFeatureJob) => {
  const featureId = job.attrs.data?.featureId;
  const organization = job.attrs.data?.organization;
  if (!featureId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  const feature = await getFeature(context, featureId);
  if (!feature) return;

  try {
    // Recalculate the feature's new nextScheduledUpdate
    const nextScheduledUpdate = getNextScheduledUpdate(
      feature.environmentSettings || {},
      context.environments,
    );

    // Update the feature in Mongo
    await updateFeature(context, feature, {
      nextScheduledUpdate: nextScheduledUpdate,
    });
  } catch (e) {
    logger.error(e, "Failed updating feature " + featureId);
  }
};
