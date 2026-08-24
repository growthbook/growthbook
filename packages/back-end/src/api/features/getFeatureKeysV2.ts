import { getFeatureKeysV2Validator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { listFeatureKeys } from "./getFeatureKeys";

export const getFeatureKeysV2 = createApiRequestHandler(
  getFeatureKeysV2Validator,
)(async (req) => listFeatureKeys(req.context, req.query.projectId));
