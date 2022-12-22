import Agenda, { Job } from "agenda";
import {
  getFeature,
  getScheduledFeaturesToUpdate,
  updateFeature,
} from "../models/FeatureModel";
import {
  featureUpdated,
  getEnabledEnvironments,
  getNextScheduledUpdate,
} from "../services/features";
import { logger } from "../util/logger";

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
  feature: { id: string; organization: string }
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

  agenda.define(
    UPDATE_SINGLE_FEATURE,
    { lockLifetime: 30 * 60 * 1000 },
    updateSingleFeature
  );

  await fireUpdateWebhook(agenda);
}

async function updateSingleFeature(job: UpdateSingleFeatureJob) {
  const featureId = job.attrs.data?.featureId;
  const organization = job.attrs.data?.organization;
  if (!featureId) return;

  const log = logger.child({
    cron: "updateSingleFeature",
    featureId,
  });

  const feature = await getFeature(organization, featureId);

  if (!feature) return;

  try {
    // Fire the webhook
    featureUpdated(
      feature,
      getEnabledEnvironments(feature),
      feature.project || ""
    );

    // Then, we'll need to recalculate the feature's new nextScheduledUpdate
    const nextScheduledUpdate = getNextScheduledUpdate(
      feature.environmentSettings || {}
    );

    // And finally, we'll need to update the feature with the new nextScheduledUpdate
    await updateFeature(organization, featureId, {
      nextScheduledUpdate: nextScheduledUpdate,
    });
  } catch (e) {
    log.error("Failure - " + e.message);
  }
}
