import { getFeatureStaleV2Validator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { computeFeatureStale } from "./getFeatureStale";

export const getFeatureStaleV2 = createApiRequestHandler(
  getFeatureStaleV2Validator,
)(async (req) => computeFeatureStale(req.context, req.query));
