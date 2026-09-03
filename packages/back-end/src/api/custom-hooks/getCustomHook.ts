import { getCustomHookValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { assertCustomHooksAvailable } from "./validations";

export const getCustomHook = createApiRequestHandler(getCustomHookValidator)(
  async (req) => {
    assertCustomHooksAvailable(req.context);

    const customHook = await req.context.models.customHooks.getById(
      req.params.id,
    );
    if (!customHook) {
      throw new NotFoundError(
        `Could not find custom hook with id ${req.params.id}`,
      );
    }

    return {
      customHook: req.context.models.customHooks.toApiInterface(customHook),
    };
  },
);
