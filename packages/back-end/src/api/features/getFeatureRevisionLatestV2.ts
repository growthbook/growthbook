import { getFeatureRevisionLatestV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadLatestDraft } from "./getFeatureRevisionLatest";

export const getFeatureRevisionLatestV2 = createApiRequestHandler(
  getFeatureRevisionLatestV2Validator,
)(async (req) => {
  const { revision } = await loadLatestDraft(
    req.context,
    req.organization.id,
    req.params.id,
    req.query,
  );
  return { revision: toApiRevisionV2(revision) };
});
