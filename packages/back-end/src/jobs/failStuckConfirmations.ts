import Agenda from "agenda";
import { ConfirmationModel } from "back-end/src/models/ConfirmationModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import {
  failStuckConfirmation,
  STUCK_AFTER_MS,
} from "back-end/src/services/confirmationDecisions";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "failStuckConfirmations";

const failStuckConfirmations = async () => {
  const stuck = await ConfirmationModel.dangerouslyFindStuckRuns(
    new Date(Date.now() - STUCK_AFTER_MS),
  );
  for (const { organization, id } of stuck) {
    try {
      const context = await getContextForAgendaJobByOrgId(organization);
      await failStuckConfirmation(context, id);
    } catch (err) {
      // One bad confirmation must not stop the sweep for the rest.
      logger.error(
        { err, organization, id },
        "Failed to fail a stuck confirmation",
      );
    }
  }
};

export default async function addFailStuckConfirmationsJob(agenda: Agenda) {
  agenda.define(JOB_NAME, failStuckConfirmations);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 minute");
  await job.save();
}
