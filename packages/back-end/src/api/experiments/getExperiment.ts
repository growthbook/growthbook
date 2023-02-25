import { z } from "zod";
import { ApiExperimentInterface } from "../../../types/api";
import { getExperimentById } from "../../models/ExperimentModel";
import { toExperimentApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";

export const getExperiment = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
})(
  async (req): Promise<{ experiment: ApiExperimentInterface }> => {
    const experiment = await getExperimentById(
      req.organization.id,
      req.params.id
    );
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }

    return {
      experiment: toExperimentApiInterface(req.organization, experiment),
    };
  }
);
