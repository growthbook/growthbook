import { deleteFeatureRevisionRuleRampScheduleV2Validator } from "shared/validators";
import { toApiRevisionV2 } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { clearRuleRampSchedule } from "./deleteFeatureRevisionRuleRampSchedule";

export const deleteFeatureRevisionRuleRampScheduleV2 = createApiRequestHandler(
  deleteFeatureRevisionRuleRampScheduleV2Validator,
)(async (req) => {
  const { revision } = await clearRuleRampSchedule(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevisionV2(revision) };
});
