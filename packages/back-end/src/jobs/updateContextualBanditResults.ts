import Agenda, { Job } from "agenda";
import { dangerousFindContextualBanditsToUpdate } from "back-end/src/enterprise/models/ContextualBanditModel";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";

const QUEUE_CB_RESULTS_UPDATES = "queueContextualBanditUpdates";
const UPDATE_SINGLE_CB = "updateSingleContextualBandit";

type UpdateSingleCBJob = Job<{
  organization: string;
  contextualBanditId: string;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_CB_RESULTS_UPDATES, async () => {
    const cbs = await dangerousFindContextualBanditsToUpdate([]);
    for (const cb of cbs) {
      await queueContextualBanditUpdate(cb.organization, cb.id);
    }
  });

  agenda.define(UPDATE_SINGLE_CB, updateSingleContextualBandit);

  await startUpdateJob();

  async function startUpdateJob() {
    const job = agenda.create(QUEUE_CB_RESULTS_UPDATES, {});
    job.unique({});
    job.repeatEvery("10 minutes");
    await job.save();
  }

  async function queueContextualBanditUpdate(
    organization: string,
    contextualBanditId: string,
  ) {
    const job = agenda.create(UPDATE_SINGLE_CB, {
      organization,
      contextualBanditId,
    }) as UpdateSingleCBJob;
    job.unique({ contextualBanditId, organization });
    job.schedule(new Date());
    await job.save();
  }
}

const updateSingleContextualBandit = async (job: UpdateSingleCBJob) => {
  const cbId = job.attrs.data?.contextualBanditId;
  const orgId = job.attrs.data?.organization;
  if (!cbId || !orgId) return;

  const context = await getContextForAgendaJobByOrgId(orgId);

  const cb = await context.models.contextualBandits.getById(cbId);
  if (!cb) return;

  try {
    logger.info("Refreshing results for contextual bandit " + cbId);
    await runContextualBanditSnapshot(context, cb, {
      triggeredBy: "scheduled",
    });
    logger.info("Successfully refreshed results for contextual bandit " + cbId);
  } catch (e) {
    // CBs manage their own retry lifecycle; log and bail without disabling.
    logger.error(e, "Failed to update contextual bandit: " + cbId);
  }
};
