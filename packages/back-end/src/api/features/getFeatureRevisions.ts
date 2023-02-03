import { z } from "zod";
import { FeatureRevisionInterface } from "../../../types/feature-revision";
import { getRevisions } from "../../models/FeatureRevisionModel";
import { createApiRequestHandler } from "../../util/handler";

export const getFeatureRevisions = createApiRequestHandler({
  paramsSchema: z
    .object({
      key: z.string(),
    })
    .strict(),
})(
  async (req): Promise<FeatureRevisionInterface[]> => {
    return getRevisions(req.organization.id, req.params.key);
  }
);
