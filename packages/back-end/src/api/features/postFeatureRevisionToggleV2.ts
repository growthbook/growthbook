import { postFeatureRevisionToggleV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toggleRevisionEnvironment } from "./postFeatureRevisionToggle";

export const postFeatureRevisionToggleV2 = createApiRequestHandler(
  postFeatureRevisionToggleV2Validator,
)(async (req) => {
  const { revision } = await toggleRevisionEnvironment(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevisionV2(revision) };
});
