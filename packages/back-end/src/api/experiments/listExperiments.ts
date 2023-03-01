import { ListExperimentsResponse } from "../../../types/openapi";
import { getAllExperiments } from "../../models/ExperimentModel";
import { toExperimentApiInterface } from "../../services/experiments";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listExperimentsValidator } from "../../validators/openapi";

export const listExperiments = createApiRequestHandler(
  listExperimentsValidator
)(
  async (req): Promise<ListExperimentsResponse> => {
    const experiments = await getAllExperiments(req.organization.id);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      experiments
        .filter((exp) => {
          return (
            !req.query.experimentId ||
            exp.trackingKey === req.query.experimentId
          );
        })
        .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()),
      req.query
    );

    return {
      experiments: filtered.map((experiment) =>
        toExperimentApiInterface(req.organization, experiment)
      ),
      ...returnFields,
    };
  }
);
