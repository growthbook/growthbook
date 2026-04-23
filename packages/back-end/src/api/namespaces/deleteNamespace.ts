import { deleteNamespaceValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";

export const deleteNamespace = createApiRequestHandler(
  deleteNamespaceValidator,
)(async (req) => {
  if (!req.context.permissions.canDeleteNamespace()) {
    req.context.permissions.throwPermissionError();
  }

  const { id } = req.params;
  const { org } = req.context;
  const existing = org.settings?.namespaces ?? [];

  const updated = existing.filter((n) => n.name !== id);
  if (updated.length === existing.length) {
    throw new Error("Namespace not found.");
  }

  await updateOrganization(org.id, {
    settings: { ...org.settings, namespaces: updated },
  });

  await req.audit({
    event: "organization.update",
    entity: { object: "organization", id: org.id },
    details: auditDetailsUpdate(
      { settings: { namespaces: existing } },
      { settings: { namespaces: updated } },
    ),
  });

  return { deletedId: id };
});
