import { z } from "zod";
import { GetExperimentResultsResponse } from "../../../types/openapi";
import { getExperimentById } from "../../models/ExperimentModel";
import {
  getLatestSnapshot,
  toSnapshotApiInterface,
} from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";

export const getExperimentResults = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
  querySchema: z
    .object({
      phase: z.string().optional(),
      dimension: z.string().optional(),
    })
    .strict(),
})(
  async (req): Promise<GetExperimentResultsResponse> => {
    const experiment = await getExperimentById(
      req.organization.id,
      req.params.id
    );
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }

    const phase = parseInt(
      req.query.phase ?? experiment.phases.length - 1 + ""
    );

    const snapshot = await getLatestSnapshot(
      experiment.id,
      phase,
      req.query.dimension,
      true
    );
    if (!snapshot) {
      throw new Error("No results found for that experiment");
    }

    const result = toSnapshotApiInterface(experiment, snapshot);

    return {
      result: result,
    };
  }
);
