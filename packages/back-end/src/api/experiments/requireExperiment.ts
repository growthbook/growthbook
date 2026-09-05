import { ExperimentInterface } from "shared/types/experiment";
import { ApiReqContext } from "back-end/types/api";
import { NotFoundError } from "back-end/src/util/errors";
import { getExperimentById } from "back-end/src/models/ExperimentModel";

export async function requireExperiment(
  context: ApiReqContext,
  id: string,
): Promise<ExperimentInterface> {
  const experiment = await getExperimentById(context, id);
  if (!experiment) throw new NotFoundError("Experiment not found");
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }
  return experiment;
}
