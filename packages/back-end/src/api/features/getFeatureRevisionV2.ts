import { getFeatureRevisionV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadRevision } from "./getFeatureRevision";

export const getFeatureRevisionV2 = createApiRequestHandler(
  getFeatureRevisionV2Validator,
)(async (req) => {
  const { revision } = await loadRevision(
    req.context,
    req.organization.id,
    req.params.id,
    req.params.version,
  );
  return { revision: toApiRevisionV2(revision) };
});
