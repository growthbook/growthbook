import { getConstantReferencesValidator } from "shared/validators";
import { loadConstantReferences } from "back-end/src/services/constants";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getConstantReferences = createApiRequestHandler(
  getConstantReferencesValidator,
)(async (req) => {
  const refs = await loadConstantReferences(req.context, req.params.id);
  if (!refs) {
    throw new Error("Could not find constant with that id");
  }
  return { features: refs.features, constants: refs.constants };
});
