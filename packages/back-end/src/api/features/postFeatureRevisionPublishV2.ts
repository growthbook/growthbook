import { postFeatureRevisionPublishV2Validator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { publishFeatureRevision } from "./postFeatureRevisionPublish";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export const postFeatureRevisionPublishV2 = createApiRequestHandler(
  postFeatureRevisionPublishV2Validator,
)(async (req) => {
  const { revision, bypassedGates } = await publishFeatureRevision(
    req,
    canUseRestApiBypassSetting(req),
    true,
  );
  return {
    revision: toApiRevisionV2(revision),
    ...(bypassedGates?.length ? { bypassedGates } : {}),
  };
});
