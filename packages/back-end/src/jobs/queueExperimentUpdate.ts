import { Job } from "agenda";
import { getAgendaInstance } from "back-end/src/services/queueing";

export const UPDATE_SINGLE_EXP = "updateSingleExperiment";

export type UpdateSingleExpJob = Job<{
  organization: string;
  experimentId: string;
}>;

export async function queueExperimentUpdate(
  organization: string,
  experimentId: string,
) {
  const job = getAgendaInstance().create(UPDATE_SINGLE_EXP, {
    organization,
    experimentId,
  }) as UpdateSingleExpJob;

  job.unique({
    experimentId,
    organization,
  });
  job.schedule(new Date());
  await job.save();
}
