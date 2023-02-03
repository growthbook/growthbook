import { z } from "zod";
import { FeatureInterface } from "../../../types/feature";
import { getFeature } from "../../models/FeatureModel";
import { createApiRequestHandler } from "../../util/handler";

export const getFeatureById = createApiRequestHandler({
  paramsSchema: z
    .object({
      key: z.string(),
    })
    .strict(),
})(
  async (req): Promise<FeatureInterface> => {
    const feature = await getFeature(req.organization.id, req.params.key);
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }
    return feature;
  }
);
