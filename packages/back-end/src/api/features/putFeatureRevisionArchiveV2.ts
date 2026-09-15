import { putFeatureRevisionArchiveV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { archiveRevision } from "./putFeatureRevisionArchive";

export const putFeatureRevisionArchiveV2 = createApiRequestHandler(
  putFeatureRevisionArchiveV2Validator,
)(async (req) => {
  const { revision } = await archiveRevision(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevisionV2(revision) };
});
