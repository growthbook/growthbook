import { deleteNamespaceValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ConflictError, NotFoundError } from "back-end/src/util/errors";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { filterActiveNamespaceExperiments } from "./namespaceApiUtils";

export const deleteNamespace = createApiRequestHandler(
  deleteNamespaceValidator,
)(async (req) => {
  const { id } = req.params;
  const { org } = req.context;
  const namespaces = org.settings?.namespaces ?? [];

  if (!namespaces.some((n) => n.name === id)) {
    throw new NotFoundError("Namespace not found.");
  }

  if (!req.context.permissions.canDeleteNamespace()) {
    req.context.permissions.throwPermissionError();
  }

  const allExperiments = await getAllExperiments(req.context);
  if (filterActiveNamespaceExperiments(allExperiments, id).length > 0) {
    throw new ConflictError(
      "Cannot delete a namespace that is actively used by experiments.",
    );
  }

  const updatedList = namespaces.filter((n) => n.name !== id);

  await updateOrganization(org.id, {
    settings: { ...org.settings, namespaces: updatedList },
  });

  await req.audit({
    event: "organization.update",
    entity: { object: "organization", id: org.id },
    details: auditDetailsUpdate(
      { settings: { namespaces } },
      { settings: { namespaces: updatedList } },
    ),
  });

  return { deletedId: id };
});
