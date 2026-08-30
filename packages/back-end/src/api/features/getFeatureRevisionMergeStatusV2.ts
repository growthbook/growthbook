import { getFeatureRevisionMergeStatusV2Validator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { mergeStatusHandler } from "./getFeatureRevisionMergeStatus";

export const getFeatureRevisionMergeStatusV2 = createApiRequestHandler(
  getFeatureRevisionMergeStatusV2Validator,
)(mergeStatusHandler);
