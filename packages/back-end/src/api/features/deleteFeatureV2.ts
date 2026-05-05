import { deleteFeatureV2Validator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteFeatureHandler } from "./deleteFeature";

export const deleteFeatureByIdV2 = createApiRequestHandler(
  deleteFeatureV2Validator,
)(deleteFeatureHandler);
