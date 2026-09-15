import { postFeatureRevisionSchedulePublishV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { schedulePublish } from "./postFeatureRevisionSchedulePublish";

export const postFeatureRevisionSchedulePublishV2 = createApiRequestHandler(
  postFeatureRevisionSchedulePublishV2Validator,
)(async (req) => {
  const { revision } = await schedulePublish(req);
  return { revision: toApiRevisionV2(revision) };
});
