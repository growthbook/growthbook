import { DeleteNamespaceResponse } from "shared/types/openapi";
import { deleteNamespaceValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";

export const deleteNamespace = createApiRequestHandler(
  deleteNamespaceValidator,
)(async (req): Promise<DeleteNamespaceResponse> => {
  const { id } = req.params;

  if (!req.context.permissions.canDeleteNamespace()) {
    req.context.permissions.throwPermissionError();
  }

  const org = req.context.org;
  const namespaces = org.settings?.namespaces || [];

  const updatedNamespaces = namespaces.filter((n) => n.name !== id);

  if (namespaces.length === updatedNamespaces.length) {
    throw new Error("Namespace not found.");
  }

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      namespaces: updatedNamespaces,
    },
  });

  await req.audit({
    event: "organization.update",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(
      { settings: { namespaces } },
      { settings: { namespaces: updatedNamespaces } },
    ),
  });

  return {
    deletedId: id,
  };
});
