import Agenda, { Job } from "agenda";
import { logger } from "back-end/src/util/logger";
import {
  FeatureModel,
  getAllFeatures,
  recalculateFeatureIsStale,
} from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

const QUEUE_JOB_NAME = "queueStaleFeatureUpdates";
const UPDATE_ORG_JOB_NAME = "updateOrgStaleFeatures";

type UpdateOrgJob = Job<{ orgId: string }>;

let agenda: Agenda;

export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(QUEUE_JOB_NAME, async () => {
    const orgIds: string[] = await FeatureModel.distinct("organization");
    for (const orgId of orgIds) {
      await queueOrgUpdate(orgId);
    }
  });

  agenda.define(UPDATE_ORG_JOB_NAME, updateOrgStaleFeatures);
}

async function queueOrgUpdate(orgId: string) {
  const job = agenda.create(UPDATE_ORG_JOB_NAME, { orgId }) as UpdateOrgJob;
  job.unique({ orgId });
  job.schedule(new Date());
  await job.save();
}

export async function queueUpdateStaleFeatureFlags() {
  const job = agenda.create(QUEUE_JOB_NAME, {});
  job.unique({});
  job.repeatEvery("24 hours");
  await job.save();
}

const updateOrgStaleFeatures = async (job: UpdateOrgJob) => {
  const orgId = job.attrs.data?.orgId;
  if (!orgId) return;

  try {
    const context = await getContextForAgendaJobByOrgId(orgId);

    const [allFeatures, allExperiments] = await Promise.all([
      getAllFeatures(context, {}),
      getAllExperiments(context, {}),
    ]);

    for (const feature of allFeatures) {
      await recalculateFeatureIsStale(context, feature, {
        allFeatures,
        allExperiments,
      });
    }
  } catch (e) {
    logger.error(e, `Error updating stale feature flags for org ${orgId}`);
  }
};
