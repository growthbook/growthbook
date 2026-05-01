import { putFeatureRevisionDefaultValueV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { setRevisionDefaultValue } from "./putFeatureRevisionDefaultValue";

export const putFeatureRevisionDefaultValueV2 = createApiRequestHandler(
  putFeatureRevisionDefaultValueV2Validator,
)(async (req) => {
  const { revision } = await setRevisionDefaultValue(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevisionV2(revision) };
});
