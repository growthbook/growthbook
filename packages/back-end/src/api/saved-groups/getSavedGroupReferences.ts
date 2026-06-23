import { getSavedGroupReferencesValidator } from "shared/validators";
import { loadSavedGroupReferences } from "back-end/src/services/savedGroups";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getSavedGroupReferences = createApiRequestHandler(
  getSavedGroupReferencesValidator,
)(async (req) => {
  const refs = await loadSavedGroupReferences(req.context, req.params.id);
  if (!refs) {
    throw new Error("Could not find saved group with that id");
  }
  return {
    features: refs.features,
    experiments: refs.experiments,
    savedGroups: refs.savedGroups,
  };
});
