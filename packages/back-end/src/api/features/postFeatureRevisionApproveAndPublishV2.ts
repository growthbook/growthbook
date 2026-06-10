import { postFeatureRevisionApproveAndPublishV2Validator } from "shared/validators";
import type { ApiRequestLocals } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { approveFeatureRevision } from "./postFeatureRevisionSubmitReview";
import { publishFeatureRevision } from "./postFeatureRevisionPublish";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export async function approveAndPublishFeatureRevision(
  req: Pick<ApiRequestLocals, "context" | "organization" | "audit"> & {
    params: { id: string; version: number };
    body: { comment?: string };
  },
  canUseRestApiBypass: boolean,
) {
  await approveFeatureRevision(req);
  return publishFeatureRevision(req, canUseRestApiBypass);
}

export const postFeatureRevisionApproveAndPublishV2 = createApiRequestHandler(
  postFeatureRevisionApproveAndPublishV2Validator,
)(async (req) => {
  const { revision } = await approveAndPublishFeatureRevision(
    req,
    canUseRestApiBypassSetting(req),
  );
  return { revision: toApiRevisionV2(revision) };
});
