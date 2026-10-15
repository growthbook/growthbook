import Agenda from "agenda";
import { ConfirmationModel } from "back-end/src/models/ConfirmationModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import {
  retryStuckConfirmation,
  STUCK_AFTER_MS,
} from "back-end/src/services/confirmationDecisions";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "retryStuckConfirmations";

const retryStuckConfirmations = async () => {
  const stuck = await ConfirmationModel.dangerouslyFindStuckRuns(
    new Date(Date.now() - STUCK_AFTER_MS),
  );
  for (const { organization, id } of stuck) {
    try {
      const context = await getContextForAgendaJobByOrgId(organization);
      await retryStuckConfirmation(context, id);
    } catch (err) {
      // One bad confirmation must not stop the sweep for the rest.
      logger.error({ err, organization, id }, "Failed to retry a confirmation");
    }
  }
};

export default async function addRetryStuckConfirmationsJob(agenda: Agenda) {
  agenda.define(JOB_NAME, retryStuckConfirmations);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 minute");
  await job.save();
}
