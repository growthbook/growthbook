import { putFeatureRevisionPrerequisitesV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { setRevisionPrerequisites } from "./putFeatureRevisionPrerequisites";

export const putFeatureRevisionPrerequisitesV2 = createApiRequestHandler(
  putFeatureRevisionPrerequisitesV2Validator,
)(async (req) => {
  const { revision } = await setRevisionPrerequisites(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevisionV2(revision) };
});
