import { postFeatureRevisionRebasePreviewV2Validator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { computeRebaseMerge } from "./postFeatureRevisionRebase";

// Dry-run of the rebase: same load/permission/guard/merge pipeline as the
// rebase endpoint, but stops before writing anything. Lets clients iterate on
// conflictResolutions and inspect the would-be merged result safely.
export const postFeatureRevisionRebasePreviewV2 = createApiRequestHandler(
  postFeatureRevisionRebasePreviewV2Validator,
)(async (req) => {
  const { revision, live, mergeResult } = await computeRebaseMerge(
    req.context,
    req.organization,
    req.params,
    req.body,
  );

  return {
    success: mergeResult.success,
    liveVersion: live.version,
    draftDateUpdated: revision.dateUpdated.toISOString(),
    conflicts: mergeResult.conflicts,
    ...(mergeResult.success ? { result: mergeResult.result } : {}),
  };
});
