import { getConstantReferencesValidator } from "shared/validators";
import { loadConstantReferences } from "back-end/src/services/constants";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const getConstantReferences = createApiRequestHandler(
  getConstantReferencesValidator,
)(async (req) => {
  // Public API addresses constants by key; resolve to the internal id the
  // references lookup uses.
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant with that key");
  }
  const refs = await loadConstantReferences(req.context, constant.id);
  if (!refs) {
    throw new NotFoundError("Could not find constant with that key");
  }
  return { features: refs.features, constants: refs.constants };
});
