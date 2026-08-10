import { revertCustomHookValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { revertCustomHookToVersion } from "back-end/src/services/customHookHistory";
import { assertCustomHooksAvailable } from "./validations";

export const revertCustomHook = createApiRequestHandler(
  revertCustomHookValidator,
)(async (req) => {
  assertCustomHooksAvailable(req.context);

  const updated = await revertCustomHookToVersion(
    req.context,
    req.params.id,
    req.body.auditId,
  );

  return {
    customHook: req.context.models.customHooks.toApiInterface(updated),
  };
});
