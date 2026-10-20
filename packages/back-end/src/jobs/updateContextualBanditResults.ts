import Agenda, { Job } from "agenda";
import { dangerousFindContextualBanditsToUpdate } from "back-end/src/enterprise/models/ContextualBanditModel";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";
import { determineNextContextualBanditSchedule } from "back-end/src/services/contextualBanditSchedule";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";

const QUEUE_CB_RESULTS_UPDATES = "queueContextualBanditUpdates";
const UPDATE_SINGLE_CB = "updateSingleContextualBandit";

type UpdateSingleCBJobData = {
  organization: string;
  contextualBanditId: string;
};
type UpdateSingleCBJob = Job<UpdateSingleCBJobData>;

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
    job.repeatEvery("5 minutes");
    await job.save();
  }

  async function queueContextualBanditUpdate(
    organization: string,
    contextualBanditId: string,
  ) {
    const job = agenda.create<UpdateSingleCBJobData>(UPDATE_SINGLE_CB, {
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
    // Advance nextSnapshotAttempt to the next scheduled window BEFORE starting
    // the run (mirrors createSafeRolloutSnapshot) so a failed or long-running
    // snapshot isn't re-queued on every cron tick. If the run reaches
    // runContextualBanditSnapshot, the schedule (and any explore -> exploit
    // stage transition) gets re-derived and persisted again there; this is
    // just a safety net for failures that happen before that point (e.g. a
    // missing datasource/query).
    await context.models.contextualBandits.update(cb, {
      nextSnapshotAttempt: determineNextContextualBanditSchedule(cb),
      lastSnapshotAttempt: new Date(),
    });

    logger.info("Refreshing results for contextual bandit " + cbId);
    await runContextualBanditSnapshot(context, cb, {
      triggeredBy: "scheduled",
      wait: true,
    });
    logger.info("Successfully refreshed results for contextual bandit " + cbId);
  } catch (e) {
    logger.error(e, "Failed to update contextual bandit: " + cbId);
  }
};
