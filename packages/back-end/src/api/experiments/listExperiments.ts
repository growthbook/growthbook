import { z } from "zod";
import {
  ApiExperimentInterface,
  ApiPaginationFields,
} from "../../../types/api";
import { getAllExperiments } from "../../models/ExperimentModel";
import { toApiInterface } from "../../services/experiments";
import { applyPagination, createApiRequestHandler } from "../../util/handler";

export const listExperiments = createApiRequestHandler({
  querySchema: z
    .object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    })
    .strict(),
})(
  async (
    req
  ): Promise<
    ApiPaginationFields & { experiments: ApiExperimentInterface[] }
  > => {
    const experiments = await getAllExperiments(req.organization.id);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      experiments.sort(
        (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()
      ),
      req.query
    );

    return {
      experiments: filtered.map((experiment) =>
        toApiInterface(req.organization, experiment)
      ),
      ...returnFields,
    };
  }
);
