import { deleteCustomHookValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { assertCustomHooksAvailable } from "./validations";

export const deleteCustomHook = createApiRequestHandler(
  deleteCustomHookValidator,
)(async (req) => {
  assertCustomHooksAvailable(req.context);

  const customHook = await req.context.models.customHooks.getById(
    req.params.id,
  );
  if (!customHook) {
    throw new NotFoundError(
      `Unable to delete - could not find custom hook with id ${req.params.id}`,
    );
  }

  await req.context.models.customHooks.delete(customHook);

  return { deletedId: customHook.id };
});
