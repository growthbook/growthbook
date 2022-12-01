import Agenda, { Job } from "agenda";
import { FeatureModel } from "../models/FeatureModel";
import {
  featureUpdated,
  getEnabledEnvironments,
  getNextScheduledUpdate,
} from "../services/features";
import { logger } from "../util/logger";

type UpdateSingleFeatureJob = Job<{
  featureId: string;
}>;

const QUEUE_FEATURE_UPDATES = "queueScheduledFeatureUpdates";

const UPDATE_SINGLE_FEATURE = "updateSingleFeature";

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_FEATURE_UPDATES, async () => {
    const featureIds = (
      await FeatureModel.find({
        nextScheduledUpdate: {
          $exists: true,
          $lt: new Date(),
        },
      })
    ).map((f) => f.id);

    for (let i = 0; i < featureIds.length; i++) {
      await queueFeatureUpdate(featureIds[i]);
    }
  });

  agenda.define(
    "updateSingleFeature",
    { lockLifetime: 30 * 60 * 1000 },
    updateSingleFeature
  );

  await fireUpdateWebhook();

  async function fireUpdateWebhook() {
    const updateFeatureJob = agenda.create(QUEUE_FEATURE_UPDATES, {});
    updateFeatureJob.unique({});
    updateFeatureJob.repeatEvery("1 minute");
    await updateFeatureJob.save();
  }

  async function queueFeatureUpdate(featureId: string) {
    const job = agenda.create(UPDATE_SINGLE_FEATURE, {
      featureId,
    }) as UpdateSingleFeatureJob;

    job.unique({
      featureId,
    });
    job.schedule(new Date());
    await job.save();
  }
}

async function updateSingleFeature(job: UpdateSingleFeatureJob) {
  // Get the feature from the DB
  const featureId = job.attrs.data?.featureId;
  if (!featureId) return;

  const log = logger.child({
    cron: "updateSingleFeature",
    featureId,
  });

  const feature = await FeatureModel.findOne({
    id: featureId,
  });
  if (!feature) return;

  try {
    // Fire the webhook for this particular feature via the featureUpdated() method
    featureUpdated(
      feature,
      getEnabledEnvironments(feature),
      feature.project || ""
    );

    // Then, we'll need to recalculate the feature's new nextScheduledUpdate and set it
    const nextScheduledUpdate = getNextScheduledUpdate(
      feature.environmentSettings || {}
    );

    // And finally, we'll need to update the feature with the new nextScheduledUpdate
    await FeatureModel.updateOne(
      {
        id: featureId,
      },
      {
        $set: { nextScheduledUpdate },
      }
    );
  } catch (e) {
    log.error("Failure - " + e.message);
  }
}
