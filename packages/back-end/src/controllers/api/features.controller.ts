import { ApiFeatureInterface } from "../../../types/api";
import { createApiRequestHandler } from "../../util/handler";

export const listFeatures = createApiRequestHandler<{
  features: Record<string, ApiFeatureInterface>;
}>({
  handler: async (req, res) => {
    res.json({
      status: 200,
      features: {},
    });
  },
});
