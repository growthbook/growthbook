import { putFeatureRevisionHoldoutV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { setRevisionHoldout } from "./putFeatureRevisionHoldout";

export const putFeatureRevisionHoldoutV2 = createApiRequestHandler(
  putFeatureRevisionHoldoutV2Validator,
)(async (req) => {
  const { revision } = await setRevisionHoldout(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevisionV2(revision) };
});
