import { getAttributeReferencesValidator } from "shared/validators";
import { getAttributeReferences as findAttributeReferences } from "back-end/src/services/attributeReferences";
import { createApiRequestHandler } from "back-end/src/util/handler";

// Works for unregistered keys too, so typo'd conditions can be found.
export const getAttributeReferences = createApiRequestHandler(
  getAttributeReferencesValidator,
)(async (req) => {
  const { property } = req.params;
  const references = await findAttributeReferences(req.context, [property]);
  return references[property];
});
