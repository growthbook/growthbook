import Agenda, { Job } from "agenda";
import { FULL_ACCESS_PERMISSIONS } from "shared/permissions";
import {
  getFeature,
  getScheduledFeaturesToUpdate,
  updateFeature,
} from "../models/FeatureModel";
import { getNextScheduledUpdate } from "../services/features";
import { getEnvironmentIdsFromOrg } from "../services/organizations";
import { logger } from "../util/logger";
import { ReqContext } from "../../types/organization";

type UpdateSingleFeatureJob = Job<{
  featureId: string;
  context: ReqContext;
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
    context: {
      org: feature.organization,
      userId: "",
      email: "",
      environments: [],
      userName: "",
      readAccessFilter: FULL_ACCESS_PERMISSIONS,
    },
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
  const context = job.attrs.data?.context;
  if (!featureId || !context) return;

  const org = context.org;

  const feature = await getFeature(org.id, featureId);
  if (!feature) return;

  try {
    // Recalculate the feature's new nextScheduledUpdate
    const nextScheduledUpdate = getNextScheduledUpdate(
      feature.environmentSettings || {},
      getEnvironmentIdsFromOrg(org)
    );

    // Update the feature in Mongo
    await updateFeature(context, null, feature, {
      nextScheduledUpdate: nextScheduledUpdate,
    });
  } catch (e) {
    logger.error(e, "Failed updating feature " + featureId);
  }
}
