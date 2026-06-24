import { getConstantValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const getConstant = createApiRequestHandler(getConstantValidator)(async (
  req,
) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant with that key");
  }

  return {
    constant: await resolveOwnerEmail(
      req.context.models.constants.toApiInterface(constant),
      req.context,
    ),
  };
});
